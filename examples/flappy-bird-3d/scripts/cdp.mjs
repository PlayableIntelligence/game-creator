// A headless Chrome driven over the DevTools protocol, with no npm dependency: the browser the repository's checks, the
// microgame kit and the texture pass render with. It launches the Chrome already on the machine ($BOOP_CHROME, else
// Google Chrome in /Applications on macOS, else google-chrome or chromium on the PATH) with a throwaway profile that is
// deleted on close, and talks to it over the runtime's built-in WebSocket. It runs under Bun and under Node 22.18+ (plain
// type stripping: no enums, no parameter properties, Node built-ins only), since the creator image runs the texture pass's
// render.mjs with node.
//
// The API is the small part of Playwright's that the callers used (chromium.launch, newContext, newPage, goto,
// setContent, evaluate, waitForFunction, screenshot, mouse and touch input, route, exposeFunction, page events), with the
// same names and argument shapes, so a caller moved here by changing its import. It is not Playwright: selectors are CSS
// only, nothing auto-waits except click, and arguments and results cross the boundary as JSON.
//
// This copy is a plain-JavaScript port of subgames-pic's tooling/browser/cdp.ts (its types stripped), for packages with
// no TypeScript runtime. It runs under Node 22+ and Bun. Its additions are marked "Extension in this .mjs port": role,
// text, label and test-id locators, nested locators, locator tap/fill/waitFor, page.keyboard, waitForSelector, and a
// context `baseURL` that relative goto URLs resolve against.
import {spawn} from 'node:child_process';
import {accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter, dirname, join, resolve as resolvePath} from 'node:path';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** The Chrome this machine has, or a thrown error that says how to name one. */
export function findChrome() {
  const named = process.env.BOOP_CHROME;
  if (named) { if (existsSync(named)) return named; throw new Error(`BOOP_CHROME is ${named}, which does not exist`); }
  if (process.platform === 'darwin' && existsSync(MAC_CHROME)) return MAC_CHROME;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      const found = dir && join(dir, name);
      try { if (found) { accessSync(found, constants.X_OK); return found; } } catch {}
    }
  }
  throw new Error('no Chrome found: install Google Chrome, or set BOOP_CHROME to a Chrome or Chromium executable');
}

// Playwright's own headless switches, less the ones only its patched builds read.
const DEFAULT_ARGS = [
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-back-forward-cache',
  '--disable-breakpad', '--disable-client-side-phishing-detection', '--disable-component-update', '--disable-default-apps',
  '--disable-dev-shm-usage', '--disable-extensions', '--disable-hang-monitor', '--disable-ipc-flooding-protection',
  '--disable-popup-blocking', '--disable-prompt-on-repost', '--disable-sync', '--disable-search-engine-choice-screen',
  '--disable-features=Translate,MediaRouter,OptimizationHints,DialMediaRouteProvider', '--force-color-profile=srgb',
  '--metrics-recording-only', '--password-store=basic', '--use-mock-keychain', '--enable-automation',
  // WebGL on SwiftShader when there is no GPU (Chrome no longer falls back to it by itself).
  '--enable-unsafe-swiftshader',
];
const HEADLESS_ARGS = ['--headless=new', '--hide-scrollbars', '--mute-audio'];

const live = new Set();
process.on('exit', () => { for (const b of live) { try { b.proc.kill('SIGKILL'); } catch {} try { rmSync(b.dir, {recursive: true, force: true}); } catch {} } });

const serialize = (v) => v === undefined ? 'undefined' : JSON.stringify(v);
const source = (fn, arg) => typeof fn === 'function' ? `(${fn.toString()})(${serialize(arg)})` : fn;
const deadline = (p, ms, what) => ms > 0 ? Promise.race([p,
  new Promise((_, reject) => setTimeout(() => reject(new TimeoutError(`${what}: Timeout ${ms}ms exceeded.`)), ms).unref?.())]) : p;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class TimeoutError extends Error { name = 'TimeoutError'; }

/** A Playwright-style URL glob (`**` any characters, `*` any but `/`), a RegExp or a predicate, as a test of a URL. */
function urlMatcher(pattern) {
  if (typeof pattern === 'function') return url => pattern(new URL(url));
  if (pattern instanceof RegExp) return url => pattern.test(url);
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') { re += '.*'; i++; } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  const compiled = new RegExp(`^${re}$`);
  return url => compiled.test(url);
}

class Connection {
  ws;
  next = 1;
  pending = new Map();
  listeners = new Map();
  waiters = new Set();
  closed = false;
  constructor(ws) {
    this.ws = ws;
    ws.onmessage = event => this.receive(JSON.parse(String(event.data)));
    ws.onclose = () => { this.closed = true; for (const p of this.pending.values()) p.reject(new Error(`${p.method}: the browser closed`)); this.pending.clear(); };
  }
  static open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new Connection(ws));
      ws.onerror = () => reject(new Error(`could not connect to ${url}`));
    });
  }
  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error(`${method}: the browser closed`));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject, method});
      this.ws.send(JSON.stringify(sessionId ? {id, method, params, sessionId} : {id, method, params}));
    });
  }
  on(method, fn) {
    let set = this.listeners.get(method);
    if (!set) this.listeners.set(method, set = new Set());
    set.add(fn);
    return () => set .delete(fn);
  }
  /** The next `method` event of the session that passes `test`; register it before the command that causes it. */
  wait(method, sessionId, test = () => true) {
    let waiter;
    const promise = new Promise(resolve => { waiter = {method, sessionId, test, resolve}; this.waiters.add(waiter); });
    return {promise, cancel: () => this.waiters.delete(waiter)};
  }
  receive(msg) {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}${msg.error.data ? ` (${msg.error.data})` : ''}`));
      else p.resolve(msg.result);
      return;
    }
    for (const w of this.waiters) if (w.method === msg.method && w.sessionId === msg.sessionId && w.test(msg.params)) { this.waiters.delete(w); w.resolve(msg.params); }
    for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params, msg.sessionId);
  }
  close() { this.closed = true; try { this.ws.close(); } catch {} }
}

/** A raw DevTools session (Playwright's CDPSession): a page's, or the browser's. */
export class CDPSession {
  conn;
  sessionId;
  constructor(conn, sessionId) { this.conn = conn; this.sessionId = sessionId; }
  send(method, params) { return this.conn.send(method, params, this.sessionId); }
  on(event, fn) { this.conn.on(event, (p, s) => { if (s === this.sessionId) fn(p); }); return this; }
  async detach() {}
}

export class Browser {
  contextList = new Set();
  conn;
  proc;
  exited;
  dir;
  product;
  constructor(conn, proc, exited, dir, product) {
    this.conn = conn; this.proc = proc; this.exited = exited; this.dir = dir; this.product = product;
  }

  static async launch(options = {}) {
    const executable = options.executablePath ?? findChrome();
    const dir = mkdtempSync(join(tmpdir(), 'boop-chrome-'));
    const args = [...(options.headless === false ? [] : HEADLESS_ARGS), ...DEFAULT_ARGS, '--remote-debugging-port=0', `--user-data-dir=${dir}`];
    // Linux: always unsandboxed, as Playwright ran it. The creator image runs renders as an unprivileged user in a job jail
    // with no user namespaces and no setuid helper, where Chrome's own sandbox cannot start.
    if (process.platform === 'linux') args.push('--no-sandbox');
    args.push(...(options.args ?? []), 'about:blank');
    const proc = spawn(executable, args, {stdio: ['ignore', 'ignore', 'pipe']});
    const exited = new Promise(resolve => { proc.once('exit', () => resolve()); proc.once('error', () => resolve()); });
    const handle = {proc, dir};
    live.add(handle);
    try {
      const url = await deadline(devtoolsUrl(proc, exited, dir), options.timeout ?? 30000, `chromium.launch (${executable})`);
      const conn = await Connection.open(url);
      const {product} = await conn.send('Browser.getVersion');
      const browser = new Browser(conn, proc, exited, dir, product);
      exited.then(() => { live.delete(handle); conn.close(); });
      return browser;
    } catch (e) {
      proc.kill('SIGKILL'); live.delete(handle); rmSync(dir, {recursive: true, force: true});
      throw e;
    }
  }
  version() { return this.product.replace(/^[^/]*\//, ''); }
  browserType() { return {name: () => 'chromium'}; }
  isConnected() { return !this.conn.closed; }
  contexts() { return [...this.contextList]; }
  async newContext(options = {}) {
    const context = new BrowserContext(this, options);
    this.contextList.add(context);
    return context;
  }
  /** A page in a context of its own (as Playwright's does), closed with it. */
  async newPage(options = {}) {
    const context = await this.newContext(options);
    const page = await context.newPage();
    page.ownsContext = true;
    return page;
  }
  async newBrowserCDPSession() { return new CDPSession(this.conn); }
  forget(context) { this.contextList.delete(context); }
  async close() {
    if (!this.conn.closed) await deadline(this.conn.send('Browser.close'), 5000, 'browser.close').catch(() => {});
    if (await deadline(this.exited, 5000, 'chrome exit').then(() => false, () => true)) { this.proc.kill('SIGKILL'); await this.exited; }
    this.conn.close();
    for (let i = 0; i < 5; i++) { try { rmSync(this.dir, {recursive: true, force: true}); break; } catch { await sleep(100); } }
  }
}

// The DevTools endpoint: Chrome prints it on stderr and writes it to <profile>/DevToolsActivePort (port, then path); some
// headless-shell builds only print it. Whichever comes first; the rest of stderr is drained and dropped.
function devtoolsUrl(proc, exited, dir) {
  return new Promise((resolve, reject) => {
    let text = '', done = false;
    const finish = (url, error) => { if (done) return; done = true; clearInterval(poll); url ? resolve(url) : reject(error); };
    proc.stderr .on('data', (chunk) => {
      if (done) return;
      text += chunk.toString();
      const m = text.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) finish(m[1]);
    });
    const poll = setInterval(() => {
      try {
        const [port, path] = readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split('\n');
        if (port && path) finish(`ws://127.0.0.1:${port.trim()}${path.trim()}`);
      } catch {}
    }, 50);
    proc.once('error', e => finish(undefined, e));
    exited.then(() => finish(undefined, new Error(`Chrome exited before it was ready:\n${text.slice(-2000)}`)));
  });
}

// A context here is the pages, routes, init scripts and viewport that go together, in Chrome's default profile: Chrome
// (156, macOS, headless) crashes when the last page of a separate browser context closes. What isolation it gives is
// that closing it clears the storage (cookies, local storage, IndexedDB, caches) of every origin its pages visited.
export class BrowserContext {
  pageList = new Set();
  routes = [];
  initScripts = [];
  origins = new Set();
  browser;
  options;
  constructor(browser, options) { this.browser = browser; this.options = options; }
  pages() { return [...this.pageList]; }
  async newPage() {
    const conn = this.browser.conn;
    const {targetId} = await conn.send('Target.createTarget', {url: 'about:blank'});
    const {sessionId} = await conn.send('Target.attachToTarget', {targetId, flatten: true});
    const page = new Page(this, conn, targetId, sessionId);
    this.pageList.add(page);
    await page.init();
    return page;
  }
  async route(pattern, handler) {
    this.routes.unshift({matches: urlMatcher(pattern), handler});
    await Promise.all(this.pages().map(p => p.intercept()));
  }
  async addInitScript(script, arg) {
    const text = typeof script === 'object' ? script.content : source(script, arg);
    this.initScripts.push(text);
    await Promise.all(this.pages().map(p => p.addInitScript(text)));
  }
  async newCDPSession(page) { return page.cdp(); }
  forget(page) { this.pageList.delete(page); }
  /** Extension in this .mjs port: 'page' (a popup one of this context's pages opened), as Playwright's context event. */
  async waitForEvent(event, options = {}) {
    if (event !== 'page') throw new Error(`context.waitForEvent: only 'page' is supported, not ${event}`);
    const conn = this.browser.conn;
    await conn.send('Target.setDiscoverTargets', {discover: true});
    let off = () => {};
    const popup = new Promise((resolve, reject) => {
      off = conn.on('Target.targetCreated', async ({targetInfo}) => {
        if (targetInfo.type !== 'page' || !this.pages().some(p => p.targetId === targetInfo.openerId)) return;
        off();
        try {
          const {sessionId} = await conn.send('Target.attachToTarget', {targetId: targetInfo.targetId, flatten: true});
          const page = new Page(this, conn, targetInfo.targetId, sessionId);
          this.pageList.add(page);
          await page.init();
          resolve(page);
        } catch (e) { reject(e); }
      });
    });
    try { return await deadline(popup, options.timeout ?? 30000, 'context.waitForEvent(page)'); } finally { off(); }
  }
  async close() {
    for (const page of this.pages()) await page.close({context: false});
    this.browser.forget(this);
    for (const origin of this.origins) await this.browser.conn.send('Storage.clearDataForOrigin', {origin, storageTypes: 'all'}).catch(() => {});
    this.origins.clear();
  }
}

// Extension in this .mjs port: locators are chains of steps (CSS, role, text, label, test id) resolved in the page, so
// getByRole/getByText/getByLabel/getByTestId and nested locators work as in Playwright (role names: aria-label, then
// aria-labelledby, alt or label text, then the element's text; hidden elements are skipped as Playwright does).
const RESOLVE = `((steps) => {
  const norm = s => String(s ?? '').replace(/\\s+/g, ' ').trim();
  const test = (got, want, exact) => {
    got = norm(got);
    if (want && typeof want === 'object' && 'source' in want) return new RegExp(want.source, want.flags).test(got);
    return exact ? got === norm(want) : got.toLowerCase().includes(norm(want).toLowerCase());
  };
  const hidden = el => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hidden || e.getAttribute('aria-hidden') === 'true' || getComputedStyle(e).display === 'none') return true;
    }
    return getComputedStyle(el).visibility === 'hidden';
  };
  const IMPLICIT = {
    button: 'button,input[type=button],input[type=submit],input[type=reset],input[type=image],summary',
    heading: 'h1,h2,h3,h4,h5,h6', link: 'a[href],area[href]', checkbox: 'input[type=checkbox]', radio: 'input[type=radio]',
    textbox: 'input:not([type]),input[type=text],input[type=email],input[type=search],input[type=tel],input[type=url],input[type=password],textarea',
    img: 'img:not([alt=""])', image: 'img:not([alt=""])', dialog: 'dialog', list: 'ul,ol', listitem: 'li', navigation: 'nav', main: 'main',
    slider: 'input[type=range]', combobox: 'select', progressbar: 'progress', paragraph: 'p', status: 'output', banner: 'header',
  };
  const labelText = el => {
    const lab = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]') || el.closest('label');
    return lab ? lab.textContent : '';
  };
  const name = el => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria;
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
    if (el.tagName === 'IMG') return el.getAttribute('alt') ?? '';
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/.test(el.type)) return el.value;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return labelText(el) || el.getAttribute('placeholder') || el.title || '';
    return (el.innerText ?? el.textContent ?? '') || el.title || '';
  };
  const text = el => el.tagName === 'INPUT' && /^(button|submit|reset)$/.test(el.type) ? el.value : (el.innerText ?? el.textContent ?? '');
  const resolve = (steps, roots) => {
  let scope = roots;
  for (const step of steps) {
    if (step.nth !== undefined) { const i = step.nth < 0 ? scope.length + step.nth : step.nth; scope = scope[i] ? [scope[i]] : []; continue; }
    if (step.filter) {
      const f = step.filter;
      scope = scope.filter(el => (!f.has || resolve(f.has, [el]).length > 0) && (!f.hasNot || resolve(f.hasNot, [el]).length === 0)
        && (f.hasText === undefined || test(text(el), f.hasText, false)) && (f.hasNotText === undefined || !test(text(el), f.hasNotText, false))
        && (f.visible === undefined || f.visible === !hidden(el) && el.getClientRects().length > 0));
      continue;
    }
    const found = new Set();
    for (const root of scope) {
      let list;
      if (step.css !== undefined) list = [...root.querySelectorAll(step.css)];
      else if (step.role !== undefined) {
        const implicit = IMPLICIT[step.role];
        list = [...root.querySelectorAll('[role]' + (implicit ? ',' + implicit : ''))].filter(el => {
          const explicit = el.getAttribute('role');
          return (explicit ? explicit.split(/\\s+/)[0] === step.role : true) && !hidden(el)
            && (step.name === undefined || test(name(el), step.name, step.exact));
        });
        if (step.role === 'heading' && step.level) list = list.filter(el => (el.getAttribute('aria-level') ?? el.tagName.slice(1)) == step.level);
      } else if (step.text !== undefined) {
        // The innermost elements whose text matches (Playwright's getByText).
        const all = [...root.querySelectorAll('*')].filter(el => !/^(SCRIPT|STYLE|HEAD|TITLE|NOSCRIPT)$/.test(el.tagName) && test(text(el), step.text, step.exact));
        list = all.filter(el => !all.some(other => other !== el && el.contains(other)));
      } else if (step.label !== undefined) {
        list = [...root.querySelectorAll('input,textarea,select,[aria-label],[aria-labelledby]')].filter(el => test(el.getAttribute('aria-label') || labelText(el), step.label, step.exact));
      } else if (step.attr !== undefined) {
        list = [...root.querySelectorAll('[' + step.attr + ']')].filter(el => test(el.getAttribute(step.attr), step.value, step.exact));
      } else if (step.testId !== undefined) list = [...root.querySelectorAll('[data-testid="' + CSS.escape(step.testId) + '"]')];
      else list = [];
      for (const el of list) found.add(el);
    }
    scope = [...found];
  }
  return scope.filter(el => el !== document);
  };
  return resolve(steps, [document]);
})`;

const regexArg = v => v instanceof RegExp ? {source: v.source, flags: v.flags} : v;

/** A Playwright-style locator: a chain of CSS, role or text steps, and the first match unless nth picks another. */
export class Locator {
  page;
  steps;
  constructor(page, steps) { this.page = page; this.steps = typeof steps === 'string' ? [{css: steps}] : steps; }
  get selector() { return this.steps.map(s => JSON.stringify(s)).join(' >> '); }
  with(step) { return new Locator(this.page, [...this.steps, step]); }
  locator(selector) { return this.with({css: selector}); }
  getByRole(role, options = {}) { return this.with({role, name: regexArg(options.name), exact: !!options.exact, level: options.level}); }
  getByText(text, options = {}) { return this.with({text: regexArg(text), exact: !!options.exact}); }
  getByLabel(label, options = {}) { return this.with({label: regexArg(label), exact: !!options.exact}); }
  getByTestId(testId) { return this.with({testId}); }
  getByTitle(title, options = {}) { return this.with({attr: 'title', value: regexArg(title), exact: !!options.exact}); }
  getByPlaceholder(text, options = {}) { return this.with({attr: 'placeholder', value: regexArg(text), exact: !!options.exact}); }
  getByAltText(text, options = {}) { return this.with({attr: 'alt', value: regexArg(text), exact: !!options.exact}); }
  /** Keeps the matches that contain a `has` locator (or not), or whose text includes `hasText` (or not). */
  filter(options = {}) {
    return this.with({filter: {has: options.has?.steps, hasNot: options.hasNot?.steps, hasText: regexArg(options.hasText), hasNotText: regexArg(options.hasNotText), visible: options.visible}});
  }
  first() { return this.with({nth: 0}); }
  last() { return this.with({nth: -1}); }
  nth(index) { return this.with({nth: index}); }
  /** Runs fn(element, arg) on the element (the first match, as Playwright's strict locators would demand only one). */
  run(fn, arg) { return this.page.evaluate(`(${RESOLVE})(${JSON.stringify(this.steps)}).slice(0, 1).map(el => (${fn.toString()})(el, ${JSON.stringify(arg)}))[0] ?? null`); }
  count() { return this.page.evaluate(`(${RESOLVE})(${JSON.stringify(this.steps)}).length`); }
  async all() { return Array.from({length: await this.count()}, (_, i) => this.nth(i)); }
  allTextContents() { return this.page.evaluate(`(${RESOLVE})(${JSON.stringify(this.steps)}).map(el => el.textContent ?? '')`); }
  allInnerTexts() { return this.page.evaluate(`(${RESOLVE})(${JSON.stringify(this.steps)}).map(el => el.innerText ?? '')`); }
  boundingBox() { return this.run(el => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }); }
  async screenshot(options = {}) {
    const box = await this.boundingBox();
    if (!box) throw new Error(`locator.screenshot: no element matches ${this.selector}`);
    return this.page.screenshot({...options, clip: box});
  }
  textContent() { return this.run(el => el.textContent); }
  innerText() { return this.run(el => el.innerText); }
  innerHTML() { return this.run(el => el.innerHTML); }
  inputValue() { return this.run(el => el.value); }
  getAttribute(name) { return this.run((el, n) => el.getAttribute(n), name); }
  isChecked() { return this.run(el => !!el.checked); }
  isEnabled() { return this.run(el => !el.disabled).then(v => v === true); }
  isDisabled() { return this.run(el => !!el.disabled).then(v => v === true); }
  async isVisible() {
    return (await this.run(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; })) === true;
  }
  async isHidden() { return !(await this.isVisible()); }
  evaluate(fn, arg) { return this.run(fn, arg); }
  evaluateAll(fn, arg) { return this.page.evaluate(`((els, a) => (${fn.toString()})(els, a))((${RESOLVE})(${JSON.stringify(this.steps)}), ${JSON.stringify(arg)})`); }
  async setInputFiles(files) {
    const {result} = await this.page.send('Runtime.evaluate', {expression: `(${RESOLVE})(${JSON.stringify(this.steps)})[0]`});
    if (!result?.objectId) throw new Error(`locator.setInputFiles: no element matches ${this.selector}`);
    await this.page.send('DOM.setFileInputFiles', {files: [].concat(files).map(f => resolvePath(f)), objectId: result.objectId});
  }
  /** Waits for the element to be attached, detached, visible (the default) or hidden. */
  async waitFor(options = {}) {
    const state = options.state ?? 'visible', end = Date.now() + (options.timeout ?? 30000);
    for (;;) {
      const n = await this.count(), visible = n > 0 && await this.isVisible();
      if (state === 'attached' ? n > 0 : state === 'detached' ? n === 0 : state === 'visible' ? visible : !visible) return;
      if (Date.now() > end) throw new TimeoutError(`locator.waitFor(${this.selector}, ${state}): Timeout ${options.timeout ?? 30000}ms exceeded.`);
      await sleep(50);
    }
  }
  /** Waits (up to `timeout`) for the element to be visible and enabled, scrolls it into view and returns a point on it. */
  async point(options = {}) {
    const end = Date.now() + (options.timeout ?? 30000);
    for (;;) {
      const at = await this.run((el, position) => {
        el.scrollIntoView({block: 'center', inline: 'center'});
        const r = el.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0) || getComputedStyle(el).visibility === 'hidden' || el.disabled) return null;
        return position ? {x: r.x + position.x, y: r.y + position.y} : {x: r.x + r.width / 2, y: r.y + r.height / 2};
      }, options.position ?? null);
      if (at) return at;
      if (Date.now() > end) throw new TimeoutError(`locator(${this.selector}): Timeout ${options.timeout ?? 30000}ms exceeded waiting for a visible, enabled element.`);
      await sleep(50);
    }
  }
  /** Waits for the element to be visible, then clicks it with the mouse (its centre, or `position` from its top left). */
  async click(options = {}) {
    const {x, y} = await this.point(options);
    await this.page.mouse.click(x, y, {delay: options.delay});
  }
  async dblclick(options = {}) { await this.click(options); await this.click(options); }
  async hover(options = {}) { const {x, y} = await this.point(options); await this.page.mouse.move(x, y); }
  /** Waits for the element to be visible, then taps it on the touchscreen. */
  async tap(options = {}) { const {x, y} = await this.point(options); await this.page.touchscreen.tap(x, y); }
  async focus() { await this.run(el => el.focus()); }
  async fill(value) {
    await this.point();
    await this.run((el, v) => {
      el.focus();
      if ('value' in el) el.value = v; else el.textContent = v;
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
    }, value);
  }
  async press(key) { await this.focus(); await this.page.keyboard.press(key); }
  async check() { if (!(await this.isChecked())) await this.click(); }
  async uncheck() { if (await this.isChecked()) await this.click(); }
  /** Selects the option whose value or label is `value` (or each of an array, for a multiple select). */
  async selectOption(value) {
    await this.run((el, want) => {
      const wanted = [].concat(want).map(w => typeof w === 'object' && w ? w.value ?? w.label : w);
      for (const o of el.options) o.selected = wanted.some(w => o.value === w || o.label === w || o.textContent.trim() === w);
      el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }, value);
  }
  async dispatchEvent(type) { await this.run((el, t) => el.dispatchEvent(new Event(t, {bubbles: true})), type); }
}

// Extension in this .mjs port: key names Playwright's keyboard takes, as DevTools key events.
const KEYS = {
  Enter: [13, '\r'], Tab: [9, ''], Backspace: [8, ''], Escape: [27, ''], Space: [32, ' '], ' ': [32, ' '], Delete: [46, ''],
  ArrowLeft: [37, ''], ArrowUp: [38, ''], ArrowRight: [39, ''], ArrowDown: [40, ''], Home: [36, ''], End: [35, ''],
  PageUp: [33, ''], PageDown: [34, ''], Shift: [16, ''], Control: [17, ''], Alt: [18, ''], Meta: [91, ''],
};
function keyEvent(key) {
  if (KEYS[key]) {
    const [code, text] = KEYS[key];
    return {key: key === 'Space' ? ' ' : key, code: key === ' ' || key === 'Space' ? 'Space' : key, windowsVirtualKeyCode: code, text};
  }
  if (/^F\d+$/.test(key)) return {key, code: key, windowsVirtualKeyCode: 111 + Number(key.slice(1)), text: ''};
  const upper = key.toUpperCase();
  const code = /^[A-Z]$/.test(upper) ? 'Key' + upper : /^\d$/.test(key) ? 'Digit' + key : '';
  return {key, code, windowsVirtualKeyCode: upper.charCodeAt(0), text: key};
}

// Extension in this .mjs port: fake timers for page.clock. After install, Date, performance.now, setTimeout,
// setInterval and requestAnimationFrame (a frame every 16 ms) run on a clock that follows real time until pauseAt, then
// moves only by runFor/fastForward, firing what falls due in time order.
const CLOCK = `(() => {
  if (globalThis.__cdpClock) return;
  const real = {Date, now: performance.now.bind(performance), setTimeout: setTimeout.bind(globalThis), clearTimeout: clearTimeout.bind(globalThis), raf: requestAnimationFrame.bind(globalThis)};
  let fake = real.now(), anchor = fake, wall = real.Date.now() - fake, paused = false, seq = 1, firing = false;
  const timers = new Map();
  const now = () => paused ? fake : fake + (real.now() - anchor);
  const add = (fn, delay, args, interval, frame) => {
    const id = seq++, at = now() + (frame ? 16 : Math.max(0, Number(delay) || 0));
    timers.set(id, {id, fn, args, at, interval: interval ? Math.max(1, Number(delay) || 0) : undefined, frame});
    return id;
  };
  const advance = until => {
    if (firing) return;
    firing = true;
    try {
      for (let guard = 0; guard < 1e6; guard++) {
        let next = null;
        for (const t of timers.values()) if (t.at <= until && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
        if (!next) break;
        fake = Math.max(fake, next.at);
        if (next.interval !== undefined) next.at += next.interval; else timers.delete(next.id);
        try { typeof next.fn === 'function' ? next.fn.apply(globalThis, next.frame ? [fake] : next.args) : (0, eval)(String(next.fn)); }
        catch (e) { real.setTimeout(() => { throw e; }); }
      }
      fake = Math.max(fake, until);
    } finally { firing = false; }
  };
  // While running, fire what has fallen due every few real milliseconds (the clock holds still while it does).
  const pump = () => { if (!paused) { const t = now(); paused = true; advance(t); paused = false; anchor = real.now(); } real.setTimeout(pump, 4); };
  pump();
  function FakeDate(...a) {
    if (!new.target) return new real.Date(wall + now()).toString();
    return a.length ? new real.Date(...a) : new real.Date(wall + now());
  }
  FakeDate.prototype = real.Date.prototype;
  FakeDate.now = () => Math.floor(wall + now());
  FakeDate.parse = real.Date.parse;
  FakeDate.UTC = real.Date.UTC;
  globalThis.Date = FakeDate;
  performance.now = () => now();
  globalThis.setTimeout = (fn, delay, ...args) => add(fn, delay, args, false, false);
  globalThis.setInterval = (fn, delay, ...args) => add(fn, delay, args, true, false);
  globalThis.clearTimeout = globalThis.clearInterval = id => { timers.delete(id); };
  globalThis.requestAnimationFrame = fn => add(fn, 16, [], false, true);
  globalThis.cancelAnimationFrame = id => { timers.delete(id); };
  globalThis.__cdpClock = {
    pauseAt: time => { const target = time - wall, t = now(); fake = t; paused = true; if (target > t) advance(target); },
    runFor: ms => { const was = paused, t = now(); fake = t; paused = true; advance(t + ms); paused = was; anchor = real.now(); },
    resume: () => { anchor = real.now(); paused = false; },
    setSystemTime: time => { wall = time - now(); },
    real,
  };
})()`;

export class Page {
  ownsContext = false;
  listeners = new Map();
  unsubscribe = [];
  requests = new Map();
  bindings = new Map();
  intercepting = false;
  children = new Set();
  closed = false;
  currentUrl = 'about:blank';
  frameId = '';
  viewport;
  scale;
  mouse;
  touchscreen;
  request = {
    get: async (url) => {
      const r = await fetch(url);
      const body = Buffer.from(await r.arrayBuffer());
      return {status: () => r.status, ok: () => r.ok, body: async () => body, text: async () => body.toString(), json: async () => JSON.parse(body.toString())};
    },
  };

  ctx;
  conn;
  targetId;
  sessionId;
  constructor(ctx, conn, targetId, sessionId) {
    this.ctx = ctx; this.conn = conn; this.targetId = targetId; this.sessionId = sessionId;
    this.viewport = ctx.options.viewport === null ? null : ctx.options.viewport ?? {width: 1280, height: 720};
    this.scale = ctx.options.deviceScaleFactor ?? 1;
    let mx = 0, my = 0, buttons = 0;
    const bit = {left: 1, right: 2, middle: 4};
    const mouse = (type, extra = {}) => this.send('Input.dispatchMouseEvent', {type, x: mx, y: my, buttons, pointerType: 'mouse', ...extra});
    this.mouse = {
      move: async (x, y, o = {}) => {
        const steps = Math.max(1, o.steps ?? 1), fx = mx, fy = my;
        for (let i = 1; i <= steps; i++) { mx = fx + (x - fx) * i / steps; my = fy + (y - fy) * i / steps; await mouse('mouseMoved', {button: buttons ? 'left' : 'none'}); }
      },
      down: async (o = {}) => { const b = o.button ?? 'left'; buttons |= bit[b]; await mouse('mousePressed', {button: b, clickCount: 1}); },
      up: async (o = {}) => { const b = o.button ?? 'left'; buttons &= ~bit[b]; await mouse('mouseReleased', {button: b, clickCount: 1}); },
      click: async (x, y, o = {}) => { await this.mouse.move(x, y); await this.mouse.down(); if (o.delay) await sleep(o.delay); await this.mouse.up(); },
      wheel: async (dx, dy) => { await mouse('mouseWheel', {deltaX: dx, deltaY: dy}); },
    };
    this.touchscreen = {
      tap: async (x, y) => {
        await this.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
        await this.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      },
    };
  }

  send(method, params) { return this.conn.send(method, params, this.sessionId); }
  subscribe(method, fn) { this.unsubscribe.push(this.conn.on(method, (p, s) => { if (s === this.sessionId) fn(p); })); }
  emit(event, value) { for (const fn of this.listeners.get(event) ?? []) fn(value); }

  async init() {
    const request = (p) => ({url: () => p.request.url + (p.request.urlFragment ?? ''), method: () => p.request.method, resourceType: () => String(p.type ?? 'other').toLowerCase(), failure: () => null});
    this.subscribe('Runtime.exceptionThrown', ({exceptionDetails: d}) => {
      const description = d.exception?.description ?? d.text ?? 'Error';
      const first = description.split('\n')[0] , m = first.match(/^(\w*Error|Error): (.*)$/);
      const e = new Error(m ? m[2] : (d.exception?.value !== undefined ? String(d.exception.value) : first));
      e.name = m ? m[1] : 'Error';
      e.stack = description;
      this.emit('pageerror', e);
    });
    this.subscribe('Runtime.consoleAPICalled', p => {
      const text = (p.args).map(a => a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : a.unserializableValue ?? a.description ?? a.type).join(' ');
      const type = p.type === 'warning' ? 'warning' : p.type;
      this.emit('console', {type: () => type, text: () => text, args: () => p.args});
    });
    this.subscribe('Runtime.bindingCalled', async ({name, payload, executionContextId}) => {
      const fn = this.bindings.get(name.replace(/^__boopBinding_/, ''));
      if (!fn) return;
      const {id, args} = JSON.parse(payload);
      let ok = true, value;
      try { value = await fn(...args); } catch (e) { ok = false; value = String((e)?.message ?? e); }
      await this.send('Runtime.evaluate', {expression: `globalThis.__boopBindingResult(${serialize(name)}, ${id}, ${ok}, ${serialize(value)})`, contextId: executionContextId}).catch(() => {});
    });
    this.subscribe('Network.requestWillBeSent', p => {
      // Extension in this .mjs port: Chrome's own favicon fetch is not the page's request (Playwright hides it too).
      if ((p.type ?? 'Other') === 'Other' && /\/favicon\.ico$/.test(p.request.url)) return;
      const prior = this.requests.get(p.requestId);
      if (prior && p.redirectResponse) this.emit('requestfinished', prior);
      const r = request(p);
      this.requests.set(p.requestId, r);
      this.emit('request', r);
    });
    this.subscribe('Network.responseReceived', p => {
      const r = this.requests.get(p.requestId);
      if (r) this.emit('response', {url: () => p.response.url, status: () => p.response.status, ok: () => p.response.status >= 200 && p.response.status < 300, request: () => r});
    });
    this.subscribe('Network.loadingFinished', p => { const r = this.requests.get(p.requestId); if (r) { this.requests.delete(p.requestId); this.emit('requestfinished', r); } });
    this.subscribe('Network.loadingFailed', p => {
      const r = this.requests.get(p.requestId);
      if (r) { this.requests.delete(p.requestId); r.failure = () => ({errorText: p.errorText}); this.emit('requestfailed', r); }
    });
    this.subscribe('Page.frameNavigated', ({frame}) => { if (/^https?:/.test(frame.url)) this.ctx.origins.add(new URL(frame.url).origin); if (!frame.parentId) { this.frameId = frame.id; this.currentUrl = frame.url + (frame.urlFragment ?? ''); } });
    this.subscribe('Page.navigatedWithinDocument', p => { if (p.frameId === this.frameId) this.currentUrl = p.url; });
    this.subscribe('Fetch.requestPaused', p => this.paused(p, this.sessionId));
    // Workers and out-of-process frames are targets of their own: attach to them (paused at start) so routes reach
    // their requests too, then let them run.
    this.subscribe('Target.attachedToTarget', p => this.attachChild(p.sessionId));
    this.unsubscribe.push(this.conn.on('Fetch.requestPaused', (p, s) => { if (s && this.children.has(s)) this.paused(p, s); }));
    this.unsubscribe.push(this.conn.on('Target.attachedToTarget', (p, s) => { if (s && this.children.has(s)) this.attachChild(p.sessionId); }));
    this.subscribe('Inspector.detached', () => this.markClosed());
    await Promise.all([this.send('Page.enable'), this.send('Runtime.enable'), this.send('Network.enable'),
      this.send('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: true, flatten: true})]);
    const top = (await this.send('Page.getFrameTree')).frameTree.frame;
    this.frameId = top.id;
    if (top.url && top.url !== 'about:blank') this.currentUrl = top.url + (top.urlFragment ?? '');
    await this.applyViewport();
    const media = [['prefers-reduced-motion', this.ctx.options.reducedMotion], ['prefers-color-scheme', this.ctx.options.colorScheme]].filter(([, v]) => v);
    if (media.length) await this.send('Emulation.setEmulatedMedia', {features: media.map(([name, value]) => ({name, value}))});
    // Extension in this .mjs port: the context's timezoneId, locale and userAgent, as Playwright's context options.
    const o = this.ctx.options;
    if (o.timezoneId) await this.send('Emulation.setTimezoneOverride', {timezoneId: o.timezoneId});
    if (o.locale) await this.send('Emulation.setLocaleOverride', {locale: o.locale});
    if (o.userAgent) await this.send('Emulation.setUserAgentOverride', {userAgent: o.userAgent, ...(o.locale ? {acceptLanguage: o.locale} : {})});
    if (this.ctx.options.hasTouch) {
      await this.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
      // Extension in this .mjs port: seen with Chrome 156 headless and a Phaser game, raw Input.dispatchTouchEvent drags
      // never reached the page until any listener was added after load; a passive no-op touchstart listener on window
      // from the start makes them arrive. It handles nothing.
      await this.addInitScript(() => addEventListener('touchstart', () => {}, {passive: true}));
    }
    for (const s of this.ctx.initScripts) await this.addInitScript(s);
    if (this.ctx.routes.length) await this.intercept();
    if (this.ctx.options.recordVideo) await this.startVideo(this.ctx.options.recordVideo);
  }
  markClosed() {
    if (this.closed) return;
    this.closed = true;
    for (const u of this.unsubscribe) u();
    this.ctx.forget(this);
    this.emit('close', this);
  }

  on(event, fn) {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, set = new Set());
    set.add(fn);
    return this;
  }
  off(event, fn) { this.listeners.get(event)?.delete(fn); return this; }
  once(event, fn) { const wrap = (v) => { this.off(event, wrap); fn(v); }; return this.on(event, wrap); }

  context() { return this.ctx; }
  url() { return this.currentUrl; }
  isClosed() { return this.closed; }
  viewportSize() { return this.viewport; }
  async cdp() { return new CDPSession(this.conn, this.sessionId); }

  async applyViewport() {
    if (!this.viewport) return;
    const {width, height} = this.viewport;
    await this.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: this.scale, mobile: !!this.ctx.options.isMobile, screenWidth: width, screenHeight: height});
  }
  async setViewportSize(viewport) { this.viewport = {...viewport}; await this.applyViewport(); }

  /** Navigates and waits for the load event (or DOMContentLoaded, or nothing for 'commit'). */
  async goto(url, options = {}) {
    if (this.ctx.options.baseURL) url = new URL(url, this.ctx.options.baseURL).href;
    const waitUntil = options.waitUntil ?? 'load';
    const event = waitUntil === 'domcontentloaded' ? 'Page.domContentEventFired' : 'Page.loadEventFired';
    const loaded = this.conn.wait(event, this.sessionId);
    let status;
    const off = this.conn.on('Network.responseReceived', (p, s) => { if (s === this.sessionId && p.type === 'Document' && status === undefined) status = p.response.status; });
    try {
      const nav = await this.send('Page.navigate', {url, frameId: this.frameId});
      if (nav.errorText) throw new Error(`page.goto: ${nav.errorText} at ${url}`);
      if (nav.loaderId && waitUntil !== 'commit') await deadline(loaded.promise, options.timeout ?? 30000, `page.goto(${url})`);
      if (waitUntil === 'networkidle') await this.networkIdle(options.timeout ?? 30000);
    } finally { loaded.cancel(); off(); }
    return {status: () => status ?? 0, ok: () => status === undefined || (status >= 200 && status < 300), url: () => this.currentUrl};
  }
  async networkIdle(timeout) {
    const end = Date.now() + timeout;
    let quietSince = Date.now();
    while (Date.now() < end) {
      if (this.requests.size) quietSince = Date.now(); else if (Date.now() - quietSince >= 500) return;
      await sleep(50);
    }
    throw new TimeoutError(`networkidle: Timeout ${timeout}ms exceeded.`);
  }
  /** Extension in this .mjs port: a real reload (Page.reload), which adds no history entry, as Playwright's does. */
  async reload(options = {}) {
    const loaded = this.conn.wait(options.waitUntil === 'domcontentloaded' ? 'Page.domContentEventFired' : 'Page.loadEventFired', this.sessionId);
    try { await this.send('Page.reload'); await deadline(loaded.promise, options.timeout ?? 30000, 'page.reload'); } finally { loaded.cancel(); }
  }

  /** Replaces the document with `html` and waits for it (and what it loads) to finish loading. */
  async setContent(html, options = {}) {
    await this.send('Page.setDocumentContent', {frameId: this.frameId, html});
    await this.waitForFunction(() => document.readyState === 'complete', undefined, {timeout: options.timeout ?? 30000});
  }
  async content() { return this.evaluate(() => (document.doctype ? new XMLSerializer().serializeToString(document.doctype) : '') + document.documentElement.outerHTML); }
  async title() { return this.evaluate(() => document.title); }

  /** Runs `fn(arg)` in the page and returns its (awaited) result; `arg` and the result cross as JSON. */
  async evaluate(fn, arg) {
    const r = await this.send('Runtime.evaluate', {expression: source(fn, arg), awaitPromise: true, returnByValue: true, userGesture: true});
    if (r.exceptionDetails) {
      const d = r.exceptionDetails, description = d.exception?.description ?? d.text;
      const e = new Error(`page.evaluate: ${description}`);
      throw e;
    }
    const v = r.result;
    if (v.unserializableValue !== undefined) {
      const u = v.unserializableValue;
      return (u.endsWith('n') ? BigInt(u.slice(0, -1)) : u === '-0' ? -0 : Number(u));
    }
    return v.value;
  }

  /** Polls `fn(arg)` in the page until it returns something truthy, and returns that (as a handle, Playwright-style). */
  // Extension in this .mjs port: a truthy value that cannot cross as JSON (a game object, a cycle) comes back as true.
  async waitForFunction(fn, arg, options = {}) {
    const timeout = options.timeout ?? 30000, end = Date.now() + timeout;
    const interval = typeof options.polling === 'number' ? options.polling : 16;
    const test = typeof fn === 'function' ? fn.toString() : `() => (${fn})`;
    for (;;) {
      const left = end - Date.now();
      if (timeout > 0 && left <= 0) throw new TimeoutError(`page.waitForFunction: Timeout ${timeout}ms exceeded.`);
      const poll = `(async () => { const f = (${test}), a = ${serialize(arg)}, end = Date.now() + ${timeout > 0 ? left : 2 ** 31};
        for (;;) { const v = await f(a); if (v) return {v: typeof v === 'function' ? true : typeof v === 'object' ? (() => { try { return JSON.parse(JSON.stringify(v)); } catch { return true; } })() : v}; if (Date.now() >= end) return null; await new Promise(r => (globalThis.__cdpClock?.real.setTimeout ?? setTimeout)(r, ${interval})); } })()`;
      let got;
      try {
        got = await deadline(this.evaluate(poll), timeout > 0 ? left + 1000 : 0, 'page.waitForFunction');
      } catch (e) {
        // A navigation destroys the context the poll ran in: poll again in the new document.
        if (/context was destroyed|Cannot find context|Inspected target navigated|Execution context/i.test(String(e))) { await sleep(interval); continue; }
        throw e;
      }
      if (got) return {jsonValue: async () => got .v, dispose: async () => {}};
    }
  }
  waitForTimeout(ms) { return sleep(ms); }

  /** A PNG (or JPEG) of the viewport, a clip of it, or the full page; written to `path` when one is given. */
  async screenshot(options = {}) {
    const format = options.type ?? (options.path?.match(/\.jpe?g$/i) ? 'jpeg' : 'png');
    let clip = options.clip ? {...options.clip, scale: 1} : undefined;
    if (options.fullPage) {
      const {cssContentSize: s} = await this.send('Page.getLayoutMetrics');
      clip = {x: 0, y: 0, width: Math.ceil(s.width), height: Math.ceil(s.height), scale: 1};
    }
    // Two animation frames (or 100 ms, if the page holds its frames) so what was just changed has been drawn.
    // (The page's own timers, when page.clock has replaced them.)
    await this.evaluate(() => { const t = globalThis.__cdpClock?.real ?? {raf: requestAnimationFrame, setTimeout}; return Promise.race([new Promise(r => t.raf(() => t.raf(r))), new Promise(r => t.setTimeout(r, 100))]); }).catch(() => {});
    if (options.omitBackground) await this.send('Emulation.setDefaultBackgroundColorOverride', {color: {r: 0, g: 0, b: 0, a: 0}});
    try {
      const {data} = await this.send('Page.captureScreenshot', {format, ...(format === 'jpeg' && options.quality ? {quality: options.quality} : {}), ...(clip ? {clip, captureBeyondViewport: !!options.fullPage} : {})});
      const bytes = Buffer.from(data, 'base64');
      if (options.path) { mkdirSync(dirname(options.path), {recursive: true}); writeFileSync(options.path, bytes); }
      return bytes;
    } finally {
      if (options.omitBackground) await this.send('Emulation.setDefaultBackgroundColorOverride', {});
    }
  }

  async addInitScript(script, arg) {
    const text = typeof script === 'object' ? script.content : source(script, arg);
    await this.send('Page.addScriptToEvaluateOnNewDocument', {source: text});
  }
  async addScriptTag(options) {
    await this.evaluate(({content, url, type}) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      if (type) s.type = type;
      if (url) { s.src = url; s.onload = () => resolve(); s.onerror = () => reject(new Error(`could not load ${url}`)); } else s.textContent = content ?? '';
      document.head.appendChild(s);
      if (!url) resolve();
    }), options);
  }
  async addStyleTag(options) {
    await this.evaluate(css => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }, options.content);
  }

  /** `window[name](...args)` in this page (and every later document of it) calls `fn` here and resolves to its result. */
  async exposeFunction(name, fn) {
    this.bindings.set(name, fn);
    const binding = `__boopBinding_${name}`;
    await this.send('Runtime.addBinding', {name: binding});
    const install = `(() => {
      const send = globalThis[${serialize(binding)}], calls = new Map(); let seq = 0;
      globalThis.__boopBindingCalls = globalThis.__boopBindingCalls || {};
      globalThis.__boopBindingCalls[${serialize(binding)}] = calls;
      globalThis.__boopBindingResult = globalThis.__boopBindingResult || ((b, id, ok, v) => { const m = globalThis.__boopBindingCalls[b], c = m.get(id); m.delete(id); ok ? c.resolve(v) : c.reject(new Error(v)); });
      globalThis[${serialize(name)}] = (...args) => new Promise((resolve, reject) => { const id = ++seq; calls.set(id, {resolve, reject}); send(JSON.stringify({id, args})); });
    })()`;
    await this.addInitScript(install);
    await this.evaluate(install);
  }

  async route(pattern, handler) {
    this.pageRoutes.unshift({matches: urlMatcher(pattern), handler});
    await this.intercept();
  }
  pageRoutes = [];
  async intercept() {
    if (this.intercepting) return;
    this.intercepting = true;
    await this.send('Fetch.enable', {patterns: [{urlPattern: '*'}]});
    await Promise.all([...this.children].map(s => this.conn.send('Fetch.enable', {patterns: [{urlPattern: '*'}]}, s).catch(() => {})));
  }
  async attachChild(session) {
    this.children.add(session);
    const send = (method, params = {}) => this.conn.send(method, params, session).catch(() => {});
    await send('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: true, flatten: true});
    if (this.intercepting) await send('Fetch.enable', {patterns: [{urlPattern: '*'}]});
    await send('Runtime.runIfWaitingForDebugger');
  }
  async paused(p, session) {
    const url = p.request.url + (p.request.urlFragment ?? '');
    const entries = [...this.pageRoutes, ...this.ctx.routes].filter(r => r.matches(url));
    const reply = (method, params) => this.conn.send(method, {requestId: p.requestId, ...params}, session).catch(() => {});
    const resume = () => reply('Fetch.continueRequest', {});
    for (const entry of entries) {
      let decided = false, fellBack = false;
      const route = {
        request: () => ({url: () => url, method: () => p.request.method, headers: () => p.request.headers, resourceType: () => String(p.resourceType ?? 'other').toLowerCase()}),
        // Extension in this .mjs port: route.fetch() (the request made from Node) and fulfill({response, body}).
        fetch: async () => {
          const r = await fetch(url, {method: p.request.method, headers: p.request.headers, body: p.request.postData});
          const bytes = Buffer.from(await r.arrayBuffer());
          const headers = Object.fromEntries(r.headers);
          delete headers['content-encoding']; delete headers['content-length'];
          return {status: () => r.status, ok: () => r.ok, headers: () => headers, url: () => url, body: async () => bytes, text: async () => bytes.toString(), json: async () => JSON.parse(bytes.toString())};
        },
        fulfill: async r => {
          decided = true;
          const headers = {...(r.response ? r.response.headers() : {}), ...(r.headers ?? {})};
          let body = r.body ?? (r.response && r.json === undefined ? await r.response.body() : undefined);
          if (r.response && r.status === undefined) r = {...r, status: r.response.status()};
          if (r.json !== undefined) { body = JSON.stringify(r.json); headers['content-type'] ??= 'application/json'; }
          if (r.contentType) headers['content-type'] = r.contentType;
          const bytes = body === undefined ? Buffer.alloc(0) : typeof body === 'string' ? Buffer.from(body) : Buffer.from(body);
          await reply('Fetch.fulfillRequest', {responseCode: r.status ?? 200, responseHeaders: Object.entries(headers).map(([name, value]) => ({name, value: String(value)})), body: bytes.toString('base64')});
        },
        abort: async () => { decided = true; await reply('Fetch.failRequest', {errorReason: 'Failed'}); },
        continue: async () => { decided = true; await resume(); },
        fallback: async () => { fellBack = true; },
      };
      await entry.handler(route);
      if (decided) return;
      if (!fellBack) return; // the handler will decide later, as Playwright allows
    }
    await resume();
  }

  /** Clicks the centre of the first element matching the CSS selector, once it is visible. */
  click(selector, options) { return this.locator(selector).click(options); }
  locator(selector) { return new Locator(this, selector); }
  // Extensions in this .mjs port: role, text, label and test-id locators, selector shortcuts and the keyboard.
  getByRole(role, options) { return new Locator(this, []).getByRole(role, options); }
  getByText(text, options) { return new Locator(this, []).getByText(text, options); }
  getByLabel(label, options) { return new Locator(this, []).getByLabel(label, options); }
  getByTestId(testId) { return new Locator(this, []).getByTestId(testId); }
  getByTitle(title, options) { return new Locator(this, []).getByTitle(title, options); }
  getByPlaceholder(text, options) { return new Locator(this, []).getByPlaceholder(text, options); }
  getByAltText(text, options) { return new Locator(this, []).getByAltText(text, options); }
  /** Emulated media features ({reducedMotion, colorScheme, media}), as Playwright's emulateMedia. */
  async emulateMedia(options = {}) {
    const features = [['prefers-reduced-motion', options.reducedMotion], ['prefers-color-scheme', options.colorScheme], ['forced-colors', options.forcedColors]].filter(([, v]) => v).map(([name, value]) => ({name, value}));
    await this.send('Emulation.setEmulatedMedia', {media: options.media ?? '', features});
  }
  /** Accepted for Playwright compatibility; each call here takes its own timeout (30 s by default). */
  setDefaultTimeout() {}
  setDefaultNavigationTimeout() {}
  async goBack(options = {}) { return this.history(-1, options); }
  async goForward(options = {}) { return this.history(1, options); }
  async history(delta, options) {
    const {currentIndex, entries} = await this.send('Page.getNavigationHistory');
    const entry = entries[currentIndex + delta];
    if (!entry) return null;
    // A load, or a same-document (hash or pushState) navigation, whichever the entry is.
    const loaded = this.conn.wait('Page.loadEventFired', this.sessionId), within = this.conn.wait('Page.navigatedWithinDocument', this.sessionId);
    try {
      await this.send('Page.navigateToHistoryEntry', {entryId: entry.id});
      await deadline(Promise.race([loaded.promise, within.promise]), options.timeout ?? 30000, 'page.goBack/goForward');
    } finally { loaded.cancel(); within.cancel(); }
    this.currentUrl = entry.url;
    return {url: () => entry.url, status: () => 0, ok: () => true};
  }
  tap(selector, options) { return this.locator(selector).tap(options); }
  fill(selector, value) { return this.locator(selector).fill(value); }
  selectOption(selector, value) { return this.locator(selector).selectOption(value); }
  check(selector) { return this.locator(selector).check(); }
  uncheck(selector) { return this.locator(selector).uncheck(); }
  hover(selector) { return this.locator(selector).hover(); }
  dblclick(selector) { return this.locator(selector).dblclick(); }
  focus(selector) { return this.locator(selector).focus(); }
  press(selector, key) { return this.locator(selector).press(key); }
  innerText(selector) { return this.locator(selector).innerText(); }
  inputValue(selector) { return this.locator(selector).inputValue(); }
  isEnabled(selector) { return this.locator(selector).isEnabled(); }
  isChecked(selector) { return this.locator(selector).isChecked(); }
  textContent(selector) { return this.locator(selector).textContent(); }
  getAttribute(selector, name) { return this.locator(selector).getAttribute(name); }
  isVisible(selector) { return this.locator(selector).isVisible(); }
  /** Waits for the CSS selector to be visible (or attached, detached, hidden) and returns its locator. */
  async waitForSelector(selector, options = {}) { const l = this.locator(selector); await l.waitFor(options); return l; }
  async waitForLoadState(state = 'load', options = {}) {
    if (state === 'networkidle') return this.networkIdle(options.timeout ?? 30000);
    await this.waitForFunction(s => s === 'domcontentloaded' ? document.readyState !== 'loading' : document.readyState === 'complete', state, options);
  }
  /** Extension in this .mjs port: the next `event` (download and filechooser included), as Playwright's waitForEvent. */
  async waitForEvent(event, options = {}) {
    const predicate = typeof options === 'function' ? options : options.predicate;
    if (event === 'download') await this.enableDownloads();
    if (event === 'filechooser') await this.enableFileChooser();
    let fn;
    const next = new Promise(resolve => { fn = v => { if (!predicate || predicate(v)) resolve(v); }; this.on(event, fn); });
    try { return await deadline(next, options.timeout ?? 30000, `page.waitForEvent(${event})`); } finally { this.off(event, fn); }
  }
  async enableDownloads() {
    if (this.downloads) return;
    const browser = this.ctx.browser, dir = join(browser.dir, 'downloads');
    if (!browser.downloadsOn) {
      browser.downloadsOn = true;
      mkdirSync(dir, {recursive: true});
      await this.conn.send('Browser.setDownloadBehavior', {behavior: 'allowAndName', downloadPath: dir, eventsEnabled: true});
    }
    this.downloads = true;
    this.unsubscribe.push(this.conn.on('Browser.downloadWillBegin', (p, s) => {
      if (s !== undefined || p.frameId !== this.frameId) return;
      const done = this.conn.wait('Browser.downloadProgress', undefined, q => q.guid === p.guid && q.state !== 'inProgress').promise;
      const file = join(dir, p.guid);
      const path = async () => { const q = await done; if (q.state !== 'completed') throw new Error(`download ${p.url} was ${q.state}`); return file; };
      this.emit('download', {url: () => p.url, suggestedFilename: () => p.suggestedFilename, page: () => this, path,
        failure: async () => { const q = await done; return q.state === 'completed' ? null : q.state; },
        saveAs: async target => { const from = await path(); mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, readFileSync(from)); }});
    }));
  }
  async enableFileChooser() {
    if (this.fileChooser) return;
    this.fileChooser = true;
    await this.send('Page.setInterceptFileChooserDialog', {enabled: true});
    this.subscribe('Page.fileChooserOpened', p => this.emit('filechooser', {page: () => this, isMultiple: () => p.mode === 'selectMultiple',
      setFiles: files => this.send('DOM.setFileInputFiles', {files: [].concat(files).map(f => resolvePath(f)), backendNodeId: p.backendNodeId})}));
  }
  /** Polls the page's address until it matches (a string or glob, a RegExp, or a predicate of a URL). */
  async waitForURL(url, options = {}) {
    const matches = typeof url === 'string' && !url.includes('*') ? (u => u === url) : urlMatcher(url);
    const end = Date.now() + (options.timeout ?? 30000);
    for (;;) {
      const href = await this.evaluate(() => location.href).catch(() => '');
      if (href && matches(href)) { this.currentUrl = href; return; }
      if (Date.now() > end) throw new TimeoutError(`page.waitForURL: Timeout ${options.timeout ?? 30000}ms exceeded (at ${href}).`);
      await sleep(50);
    }
  }
  async bringToFront() { await this.send('Page.bringToFront'); }
  async setInputFiles(selector, files) { await this.locator(selector).setInputFiles(files); }
  /** Fake timers, as Playwright's page.clock: install(), then pauseAt(time), runFor(ms), fastForward(ms), resume(). */
  get clock() {
    const ms = t => t instanceof Date ? t.getTime() : typeof t === 'string' ? Date.parse(t) : t;
    // Chrome hands touch and mouse moves to the page just before its next real frame: wait for one, so input sent
    // before a runFor reaches the page before the clock moves.
    const call = (method, arg) => this.evaluate(`new Promise(r => globalThis.__cdpClock.real.raf(() => r())).then(() => globalThis.__cdpClock.${method}(${arg === undefined ? '' : JSON.stringify(arg)}))`);
    return {
      install: async (o = {}) => { await this.addInitScript(CLOCK); await this.evaluate(CLOCK); if (o.time !== undefined) await call('setSystemTime', ms(o.time)); },
      pauseAt: t => call('pauseAt', ms(t)),
      runFor: t => call('runFor', ms(t)),
      fastForward: t => call('runFor', ms(t)),
      resume: () => call('resume'),
      setSystemTime: t => call('setSystemTime', ms(t)),
      setFixedTime: async t => { await call('pauseAt', ms(t)); },
    };
  }
  get keyboard() {
    // Keys that type nothing go down as rawKeyDown, as Chrome's own input does; keyDown with text also types it.
    const send = (type, e) => this.send('Input.dispatchKeyEvent', {type: type === 'keyDown' && !e.text ? 'rawKeyDown' : type, key: e.key, code: e.code, windowsVirtualKeyCode: e.windowsVirtualKeyCode,
      ...(type === 'keyDown' && e.text ? {text: e.text, unmodifiedText: e.text} : {})});
    const keyboard = {
      down: async key => { await send('keyDown', keyEvent(key)); },
      up: async key => { await send('keyUp', keyEvent(key)); },
      press: async (key, o = {}) => { await keyboard.down(key); if (o.delay) await sleep(o.delay); await keyboard.up(key); },
      type: async (text, o = {}) => { for (const ch of text) await keyboard.press(ch, o); },
      insertText: async text => { await this.send('Input.insertText', {text}); },
    };
    return keyboard;
  }

  // Extension in this .mjs port: the context's recordVideo ({dir, size}) as a WebM per page, as Playwright's. Chrome's
  // screencast frames are written at a steady 25 fps (the last frame repeats while the page is still) into ffmpeg
  // (libvpx), which must be on the PATH. The file is complete once the page (or its context) is closed.
  private_video = null;
  async startVideo(options) {
    const size = options.size ?? this.viewport ?? {width: 800, height: 600}, fps = 25;
    mkdirSync(options.dir, {recursive: true});
    const path = join(options.dir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.webm`);
    const {width: w, height: h} = size;
    const ffmpeg = spawn(process.env.FFMPEG ?? 'ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0',
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`, '-c:v', 'libvpx', '-b:v', '4M', '-crf', '8',
      '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', path], {stdio: ['pipe', 'ignore', 'pipe']});
    let stderr = '';
    ffmpeg.stderr.on('data', b => { stderr += b; });
    ffmpeg.stdin.on('error', () => {});
    const done = new Promise((resolve, reject) => {
      ffmpeg.once('error', e => reject(new Error(`recordVideo needs ffmpeg on the PATH (or FFMPEG): ${e.message}`)));
      ffmpeg.once('exit', code => code === 0 ? resolve(path) : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1000)}`)));
    });
    done.catch(() => {});
    const video = {path, done, ffmpeg, fps, start: 0, written: 0, last: null, stopped: false};
    const fill = until => { while (video.last && video.written < until) { ffmpeg.stdin.write(video.last); video.written++; } };
    this.subscribe('Page.screencastFrame', ({data, metadata, sessionId}) => {
      this.send('Page.screencastFrameAck', {sessionId}).catch(() => {});
      if (video.stopped) return;
      const at = metadata?.timestamp ?? Date.now() / 1000;
      if (!video.start) video.start = at;
      fill(Math.floor((at - video.start) * fps));
      video.last = Buffer.from(data, 'base64');
    });
    video.finish = async () => {
      if (video.stopped) return video.done;
      video.stopped = true;
      await this.send('Page.stopScreencast').catch(() => {});
      if (video.start) fill(Math.max(video.written + 1, Math.floor((Date.now() / 1000 - video.start) * fps)));
      ffmpeg.stdin.end();
      return video.done;
    };
    this.private_video = video;
    await this.send('Page.startScreencast', {format: 'jpeg', quality: 90, maxWidth: w, maxHeight: h, everyNthFrame: 1});
  }
  /** The page's recording (recordVideo), as Playwright's page.video(): path(), saveAs(path), delete(). */
  video() {
    const v = this.private_video;
    if (!v) return null;
    return {
      path: async () => v.path,
      saveAs: async target => { await v.done; mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, readFileSync(v.path)); },
      delete: async () => { await v.done.catch(() => {}); rmSync(v.path, {force: true}); },
    };
  }

  async close(options = {}) {
    if (this.private_video) await this.private_video.finish();
    if (!this.closed) {
      await this.conn.send('Target.closeTarget', {targetId: this.targetId}).catch(() => {});
      this.markClosed();
    }
    if (this.ownsContext && options.context !== false) await this.ctx.close();
  }
}

/** Playwright's `chromium` export, as far as the callers used it. */
export const chromium = {launch: (options) => Browser.launch(options), executablePath: () => findChrome()};
