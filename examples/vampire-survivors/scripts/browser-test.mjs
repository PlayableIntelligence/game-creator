// Browser tests on `node --test` (or `bun test`) with the Chrome on this machine, driven by ./cdp.mjs. It is the small part
// of @playwright/test that these checks used, with the same names, so a spec moved here by changing its import:
// `test(title, async ({page, context, browser}) => ...)`, `test.extend({page: async ({page}, use, testInfo) => ...})`,
// test.describe/beforeEach/afterEach/skip, test.setTimeout and test.info(); `expect(value)` matchers, `expect.poll(fn)`
// and auto-retrying locator and page matchers (toBeVisible, toHaveText, toHaveAttribute, ...).
//
// Settings come from browser.config.mjs (the file BROWSER_TEST_CONFIG names, else the one in the working directory), in
// Playwright's config shape: timeout, expect.timeout, outputDir, use ({baseURL, viewport, isMobile, hasTouch,
// deviceScaleFactor, headless, screenshot: 'only-on-failure'}), projects ([{name, use}]; BROWSER_TEST_PROJECTS picks
// some by name) and webServer ({command, url, reuseExistingServer}). Each test runs once per project, named
// "[project] title", in a fresh context of a browser launched once per spec file. BROWSER_TEST_HEADED=1 shows the browser.
// It is not Playwright: selectors are CSS (plus getByRole/getByText), there are no traces or retries, and
// toHaveScreenshot uses pixelmatch's colour distance without its anti-aliasing allowance.
import nodeTest from 'node:test';
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {isDeepStrictEqual, inspect} from 'node:util';
import {chromium, Locator, Page, TimeoutError} from './cdp.mjs';

const configFile = resolve(process.env.BROWSER_TEST_CONFIG || 'browser.config.mjs');
export const config = existsSync(configFile) ? (await import(pathToFileURL(configFile).href)).default ?? {} : {};
const configDir = existsSync(configFile) ? dirname(configFile) : process.cwd();
const wanted = process.env.BROWSER_TEST_PROJECTS?.split(',').map(s => s.trim()).filter(Boolean);
const allProjects = config.projects?.length ? config.projects : [{name: 'chromium', use: {}}];
const projects = wanted?.length ? allProjects.filter(p => wanted.includes(p.name)) : allProjects;
if (wanted?.length && !projects.length) throw new Error(`no project named ${wanted.join(', ')} in ${configFile}`);
const outputDir = resolve(configDir, config.outputDir ?? 'test-results');
const expectTimeout = config.expect?.timeout ?? 5000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- the browser (one per spec file) and the web server -------------------------------------------------------------

const browsers = new Map();
function launch(use) {
  const headless = process.env.BROWSER_TEST_HEADED ? false : use.headless ?? true;
  const key = String(headless) + (use.launchOptions?.args ?? []).join(' ');
  if (!browsers.has(key)) browsers.set(key, chromium.launch({headless, ...(use.launchOptions ?? {})}));
  return browsers.get(key);
}
let server;
async function reachable(url) {
  try { await fetch(url, {signal: AbortSignal.timeout(2000)}); return true; } catch { return false; }
}
async function startServer() {
  const web = config.webServer;
  if (!web || server) return server;
  server = (async () => {
    const url = web.url ?? `http://localhost:${web.port}`;
    if (web.reuseExistingServer !== false && await reachable(url)) return null;
    const child = spawn(web.command, {shell: true, cwd: web.cwd ? resolve(configDir, web.cwd) : configDir, stdio: ['ignore', 'ignore', 'inherit'], detached: process.platform !== 'win32', env: {...process.env, ...(web.env ?? {})}});
    const end = Date.now() + (web.timeout ?? 60000);
    while (!(await reachable(url))) {
      if (child.exitCode !== null) throw new Error(`webServer command exited (${child.exitCode}): ${web.command}`);
      if (Date.now() > end) throw new Error(`webServer ${url} did not answer within ${web.timeout ?? 60000}ms: ${web.command}`);
      await sleep(200);
    }
    return child;
  })();
  return server;
}
// Registered with the first test, so a plain script can import just `expect` without starting node's test harness.
let cleanupRegistered = false;
function registerCleanup() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  nodeTest.after(async () => {
    for (const b of browsers.values()) await (await b.catch(() => null))?.close();
    const child = await server?.catch(() => null);
    if (child) { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
  });
}

// ---- tests ---------------------------------------------------------------------------------------------------------

let current = null; // the running test's info
let fileTimeout = null;
const prefixes = [];
let skipAll = 0;
const hooks = {beforeEach: [], afterEach: []};

function makeInfo(project, title) {
  const slug = (title + '-' + project.name).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80);
  const info = {
    title, project: {name: project.name, use: project.use ?? {}}, started: Date.now(),
    timeout: fileTimeout ?? config.timeout ?? 30000, outputDir: join(outputDir, slug), annotations: [], attachments: [],
    outputPath: (...parts) => { const p = join(info.outputDir, ...parts); mkdirSync(dirname(p), {recursive: true}); return p; },
    snapshotPath: (...parts) => join(configDir, '__screenshots__', ...parts),
    setTimeout: ms => { info.timeout = ms; info.rearm?.(); },
    skip: (condition = true, reason = '') => { if (condition) { const e = new Error(reason || 'skipped'); e.skip = true; throw e; } },
  };
  return info;
}

/** Runs the fixture overrides (Playwright's test.extend), innermost last, then the test body. */
async function runChain(chain, fixtures, info, body) {
  if (!chain.length) return body(fixtures, info);
  const [layer, ...rest] = chain;
  const names = Object.keys(layer);
  const apply = async (i, fx) => {
    if (i === names.length) return runChain(rest, fx, info, body);
    let def = layer[names[i]];
    if (Array.isArray(def)) def = def[0];
    if (typeof def !== 'function') return apply(i + 1, {...fx, [names[i]]: def});
    let failure, used = false;
    try {
      await def(fx, async value => { used = true; try { await apply(i + 1, {...fx, [names[i]]: value}); } catch (e) { failure = e; } }, info);
    } catch (e) { throw failure ?? e; }
    if (failure) throw failure;
    if (!used) throw new Error(`fixture ${names[i]} did not call use()`);
  };
  return apply(0, fixtures);
}

function withTimeout(info, run) {
  return new Promise((resolve, reject) => {
    let timer;
    info.rearm = () => {
      clearTimeout(timer);
      if (info.timeout > 0) timer = setTimeout(() => reject(new TimeoutError(`Test timeout of ${info.timeout}ms exceeded.`)), Math.max(0, info.started + info.timeout - Date.now()));
    };
    info.rearm();
    run().then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function runTest(project, title, fn, chain, specFile) {
  const use = {...(config.use ?? {}), ...(project.use ?? {})};
  const info = makeInfo(project, title);
  if (specFile) info.file = fileURLToPath(specFile);
  current = info;
  const contexts = [];
  const options = o => ({viewport: use.viewport === undefined ? {width: 1280, height: 720} : use.viewport, deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile, hasTouch: use.hasTouch, baseURL: use.baseURL ?? process.env.GAME_URL, ...o});
  let failure, page;
  try {
    await withTimeout(info, async () => {
      await startServer();
      const real = await launch(use);
      const newContext = async (o = {}) => { const c = await real.newContext(options(o)); contexts.push(c); return c; };
      const browser = {
        newContext, newPage: async o => (await newContext(o)).newPage(), version: () => real.version(), browserType: () => real.browserType(),
        isConnected: () => real.isConnected(), contexts: () => contexts, close: async () => {}, newBrowserCDPSession: () => real.newBrowserCDPSession(),
      };
      const context = await newContext();
      page = await context.newPage();
      const fixtures = {page, context, browser, baseURL: options().baseURL, headless: use.headless ?? true, channel: use.channel,
        viewport: options().viewport, isMobile: !!use.isMobile, hasTouch: !!use.hasTouch, request: page.request};
      await runChain(chain, fixtures, info, async fx => {
        for (const h of hooks.beforeEach) await h(fx, info);
        let bodyFailure;
        try { await fn(fx, info); } catch (e) { bodyFailure = e; }
        for (const h of hooks.afterEach) await h(fx, info);
        if (bodyFailure) throw bodyFailure;
      });
    });
  } catch (e) { failure = e; }
  if (failure && !failure.skip && use.screenshot && use.screenshot !== 'off' && page && !page.isClosed()) {
    await page.screenshot({path: info.outputPath('test-failed-1.png')}).catch(() => {});
  }
  for (const c of contexts) await c.close().catch(() => {});
  current = null;
  return failure;
}

function make(chain) {
  const register = (title, a, b) => {
    const self = import.meta.url, specFile = new Error().stack.split('\n').map(l => /(file:\/\/[^\s)]+?):\d+:\d+/.exec(l)?.[1]).find(u => u && u !== self);
    const fn = typeof a === 'function' ? a : b;
    const full = [...prefixes, title].join(' › ');
    registerCleanup();
    const skipped = skipAll > 0 || (typeof a === 'object' && a?.skip);
    for (const project of projects) {
      nodeTest(`[${project.name}] ${full}`, {skip: skipped || undefined, timeout: Infinity}, async t => {
        const failure = await runTest(project, full, fn, chain, specFile);
        if (failure?.skip) return t.skip(failure.message);
        if (failure) throw failure;
      });
    }
  };
  const test = (title, a, b) => register(title, a, b);
  test.extend = layer => make([...chain, layer]);
  test.info = () => { if (!current) throw new Error('test.info() is only available while a test runs'); return current; };
  test.setTimeout = ms => { if (current) current.setTimeout(ms); else fileTimeout = ms; };
  test.slow = () => { if (current) current.setTimeout(current.timeout * 3); else fileTimeout = (fileTimeout ?? config.timeout ?? 30000) * 3; };
  test.describe = (title, fn) => { prefixes.push(title); try { fn(); } finally { prefixes.pop(); } };
  test.describe.serial = test.describe;
  test.describe.configure = () => {};
  test.describe.skip = (title, fn) => { prefixes.push(title); skipAll++; try { fn(); } finally { prefixes.pop(); skipAll--; } };
  test.only = (title, a, b) => register(title, a, b);
  test.fixme = (title, a, b) => typeof title === 'string' ? register(title, {skip: true}, a ?? b) : test.skip(title, a);
  test.skip = (title, a, b) => {
    if (typeof title === 'string') return register(title, {skip: true}, typeof a === 'function' ? a : b);
    if (current) current.skip(title === undefined ? true : title, a);
  };
  test.beforeEach = fn => hooks.beforeEach.push(fn);
  test.afterEach = fn => hooks.afterEach.push(fn);
  test.beforeAll = fn => nodeTest.before(fn);
  test.afterAll = fn => nodeTest.after(fn);
  test.step = async (title, fn) => fn();
  test.use = () => { throw new Error('test.use is not supported: put options in browser.config.mjs or call browser.newContext()'); };
  return test;
}
export const test = make([]);

// ---- expect --------------------------------------------------------------------------------------------------------

const show = v => inspect(v, {depth: 6, breakLength: 120});
const dropUndefined = v => Array.isArray(v) ? v.map(dropUndefined) : v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype
  ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, dropUndefined(x)])) : v;
const matchObject = (a, e) => e && typeof e === 'object' ? a && typeof a === 'object' && Object.entries(e).every(([k, v]) => matchObject(a[k], v)) : Object.is(a, e) || isDeepStrictEqual(a, e);
const VALUE = {
  toBe: (a, e) => [Object.is(a, e), `to be ${show(e)}`],
  toEqual: (a, e) => [isDeepStrictEqual(dropUndefined(a), dropUndefined(e)), `to equal ${show(e)}`],
  toStrictEqual: (a, e) => [isDeepStrictEqual(a, e), `to strictly equal ${show(e)}`],
  toMatchObject: (a, e) => [matchObject(a, e), `to match ${show(e)}`],
  toHaveLength: (a, n) => [a?.length === n, `to have length ${n}`],
  toHaveProperty: (a, path, ...v) => {
    let o = a;
    for (const k of Array.isArray(path) ? path : String(path).split('.')) { if (o == null || !(k in Object(o))) return [false, `to have property ${path}`]; o = o[k]; }
    return [v.length ? isDeepStrictEqual(o, v[0]) : true, `to have property ${path}${v.length ? ' = ' + show(v[0]) : ''}`];
  },
  toBeGreaterThan: (a, e) => [a > e, `to be > ${e}`],
  toBeGreaterThanOrEqual: (a, e) => [a >= e, `to be >= ${e}`],
  toBeLessThan: (a, e) => [a < e, `to be < ${e}`],
  toBeLessThanOrEqual: (a, e) => [a <= e, `to be <= ${e}`],
  toBeCloseTo: (a, e, digits = 2) => [Math.abs(a - e) < 10 ** -digits / 2, `to be close to ${e}`],
  toBeTruthy: a => [!!a, 'to be truthy'],
  toBeFalsy: a => [!a, 'to be falsy'],
  toBeNull: a => [a === null, 'to be null'],
  toBeUndefined: a => [a === undefined, 'to be undefined'],
  toBeDefined: a => [a !== undefined, 'to be defined'],
  toBeNaN: a => [Number.isNaN(a), 'to be NaN'],
  toBeInstanceOf: (a, C) => [a instanceof C, `to be an instance of ${C?.name}`],
  toContain: (a, e) => [typeof a === 'string' ? a.includes(e) : [...(a ?? [])].includes(e), `to contain ${show(e)}`],
  toContainEqual: (a, e) => [[...(a ?? [])].some(x => isDeepStrictEqual(dropUndefined(x), dropUndefined(e))), `to contain an item equal to ${show(e)}`],
  toMatch: (a, re) => [typeof re === 'string' ? String(a).includes(re) : re.test(String(a)), `to match ${re}`],
  toThrow: (a, e) => {
    let thrown;
    try { a(); } catch (x) { thrown = x ?? true; }
    const ok = thrown !== undefined && (e === undefined || (e instanceof RegExp ? e.test(thrown?.message) : typeof e === 'string' ? String(thrown?.message).includes(e) : typeof e === 'function' ? thrown instanceof e : true));
    return [ok, `to throw${e === undefined ? '' : ' ' + show(e)}`];
  },
};
function fail(message, label) { const e = new Error(label ? `${label}: ${message}` : message); e.name = 'AssertionError'; Error.captureStackTrace?.(e, fail); throw e; }

function valueMatchers(actual, negate, label) {
  const m = {};
  for (const [name, check] of Object.entries(VALUE)) {
    m[name] = (...args) => {
      const [pass, what] = check(actual, ...args);
      if (pass === negate) fail(`expected ${show(actual)} ${negate ? 'not ' : ''}${what}`, label);
    };
  }
  m.resolves = new Proxy({}, {get: (_, name) => async (...args) => valueMatchers(await actual, negate, label)[name](...args)});
  m.rejects = new Proxy({}, {get: (_, name) => async (...args) => {
    let error; try { await actual; } catch (e) { error = e; }
    if (error === undefined) fail('expected the promise to reject', label);
    return name === 'toThrow' ? valueMatchers(() => { throw error; }, negate, label).toThrow(...args) : valueMatchers(error, negate, label)[name](...args);
  }});
  return m;
}

/** Retries `probe` until `check` passes (or, negated, fails) within the timeout. */
async function retry(probe, check, negate, timeout, describe, label) {
  const end = Date.now() + timeout;
  const intervals = [100, 250, 500, 1000];
  let last;
  for (let i = 0; ; i++) {
    let value, pass, what, got, error;
    try { value = await probe(); [pass, what, got] = await check(value); } catch (e) { error = e; pass = negate; }
    last = {value: got === undefined ? value : got, what, error};
    if (pass !== negate) return;
    if (Date.now() >= end) break;
    await sleep(Math.min(intervals[Math.min(i, intervals.length - 1)], Math.max(0, end - Date.now())));
  }
  const value = last.value instanceof Locator || last.value instanceof Page ? '' : `; last value ${show(last.value)}`;
  fail(`${describe} ${negate ? 'not ' : ''}${last.what ?? ''} (timed out after ${timeout}ms)${last.error ? `: ${last.error.message}` : value}`, label);
}

const textOf = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const textMatches = (got, want, full) => want instanceof RegExp ? want.test(got) : full ? textOf(got) === textOf(want) : textOf(got).includes(textOf(want));
const LOCATOR = {
  toBeVisible: async (l, o = {}) => [(await l.isVisible()) === (o.visible ?? true), o.visible === false ? 'to be hidden' : 'to be visible'],
  toBeHidden: async l => [!(await l.isVisible()), 'to be hidden'],
  toBeAttached: async (l, o = {}) => [((await l.count()) > 0) === (o.attached ?? true), 'to be attached'],
  toBeEnabled: async l => [(await l.isEnabled()), 'to be enabled'],
  toBeDisabled: async l => [(await l.isDisabled()), 'to be disabled'],
  toBeChecked: async (l, o = {}) => [(await l.isChecked()) === (o.checked ?? true), 'to be checked'],
  toBeFocused: async l => [(await l.run(el => el === document.activeElement)) === true, 'to be focused'],
  toBeEmpty: async l => [(await l.run(el => 'value' in el && el.tagName !== 'BUTTON' ? !el.value : !el.textContent.trim())) === true, 'to be empty'],
  toHaveCount: async (l, n) => { const got = await l.count(); return [got === n, `to have count ${n}`, got]; },
  toHaveText: async (l, e, o = {}) => {
    if (Array.isArray(e)) { const all = await l.allInnerTexts(); return [all.length === e.length && all.every((t, i) => textMatches(t, e[i], true)), `to have texts ${show(e)}`]; }
    const got = o.useInnerText ? await l.innerText() : await l.textContent();
    return [got !== null && textMatches(got, e, true), `to have text ${show(e)}`, got];
  },
  toContainText: async (l, e, o = {}) => { const got = o.useInnerText ? await l.innerText() : await l.textContent(); return [got !== null && textMatches(got, e, false), `to contain text ${show(e)}`, got]; },
  toHaveAttribute: async (l, name, value) => {
    const got = await l.getAttribute(name);
    return [value === undefined ? got !== null : got !== null && (value instanceof RegExp ? value.test(got) : got === String(value)), `to have attribute ${name}${value === undefined ? '' : '=' + show(value)}`, got];
  },
  toHaveClass: async (l, e) => { const got = (await l.getAttribute('class')) ?? ''; return [e instanceof RegExp ? e.test(got) : textOf(got) === textOf(e), `to have class ${show(e)}`]; },
  toHaveId: async (l, id) => [(await l.getAttribute('id')) === id, `to have id ${id}`],
  toHaveValue: async (l, e) => { const got = await l.inputValue(); return [e instanceof RegExp ? e.test(got) : got === String(e), `to have value ${show(e)}`]; },
  toHaveCSS: async (l, prop, e) => { const got = await l.run((el, p) => getComputedStyle(el).getPropertyValue(p), prop); return [e instanceof RegExp ? e.test(got) : got === e, `to have CSS ${prop}: ${e}`]; },
};
const PAGE = {
  toHaveTitle: async (p, e) => { const t = await p.title(); return [e instanceof RegExp ? e.test(t) : textOf(t) === textOf(e), `to have title ${show(e)}`]; },
  toHaveURL: async (p, e) => { const u = p.url(); return [e instanceof RegExp ? e.test(u) : u === new URL(e, p.context().options.baseURL ?? u).href, `to have URL ${show(e)}`]; },
};

function retryingMatchers(target, table, negate, label, describe) {
  const m = {};
  for (const [name, check] of Object.entries(table)) {
    m[name] = (...args) => {
      const options = args.length && args[args.length - 1] && typeof args[args.length - 1] === 'object' && !(args[args.length - 1] instanceof RegExp) && !Array.isArray(args[args.length - 1]) ? args[args.length - 1] : {};
      return retry(() => target, () => check(target, ...args), negate, options.timeout ?? expectTimeout, describe, label);
    };
  }
  m.toHaveScreenshot = async (...args) => {
    const name = typeof args[0] === 'string' || Array.isArray(args[0]) ? args.shift() : undefined;
    return screenshotMatches(target, name, args[0] ?? {}, negate, label);
  };
  return m;
}

/**
 * Screenshot comparison as Playwright's toHaveScreenshot: the baseline is `<spec file>-snapshots/<name>-<project>-<platform>.png`;
 * a missing one is written and the check fails (BROWSER_TEST_UPDATE_SNAPSHOTS=1 writes and passes). Pixels are compared in
 * the browser itself with pixelmatch's YIQ colour distance and `threshold` (0..1, default 0.2), and the check
 * passes with at most `maxDiffPixels` / `maxDiffPixelRatio` different pixels (options, then config expect.toHaveScreenshot).
 */
async function screenshotMatches(target, name, options, negate, label) {
  const info = test.info();
  const defaults = config.expect?.toHaveScreenshot ?? {};
  const o = {...defaults, ...options};
  const base = (name ? [].concat(name).join('-') : info.title.replace(/[^a-z0-9]+/gi, '-') + '-1').replace(/\.png$/i, '');
  const file = info.file ? `${info.file}-snapshots/${base}-${info.project.name}-${process.platform}.png` : info.snapshotPath(`${base}-${info.project.name}-${process.platform}.png`);
  const page = target instanceof Page ? target : target.page;
  const shot = () => target.screenshot({fullPage: o.fullPage, clip: o.clip, omitBackground: o.omitBackground});
  if (o.animations !== 'allow') await sleep(100);
  if (process.env.BROWSER_TEST_UPDATE_SNAPSHOTS || !existsSync(file)) {
    mkdirSync(dirname(file), {recursive: true});
    writeFileSync(file, await shot());
    if (process.env.BROWSER_TEST_UPDATE_SNAPSHOTS) return;
    fail(`A snapshot doesn't exist at ${file}, writing actual.`, label);
  }
  const baseline = readFileSync(file).toString('base64');
  const threshold = o.threshold ?? 0.2;
  let actual;
  await retry(async () => (actual = await shot()), async got => {
    const r = await page.evaluate(async ([a, b, t]) => {
      const load = b64 => createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], {type: 'image/png'}));
      const [x, y] = await Promise.all([load(a), load(b)]);
      if (x.width !== y.width || x.height !== y.height) return {size: `${x.width}x${x.height} vs ${y.width}x${y.height}`};
      const read = bmp => { const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, bmp.width, bmp.height).data; };
      // pixelmatch's YIQ colour distance (alpha blended over white), without its anti-aliasing detection.
      const p = read(x), q = read(y), limit = 35215 * t * t;
      const blend = (c, a) => 255 + (c - 255) * a;
      let diff = 0;
      for (let i = 0; i < p.length; i += 4) {
        const a1 = p[i + 3] / 255, a2 = q[i + 3] / 255;
        const r1 = blend(p[i], a1), g1 = blend(p[i + 1], a1), b1 = blend(p[i + 2], a1), r2 = blend(q[i], a2), g2 = blend(q[i + 1], a2), b2 = blend(q[i + 2], a2);
        const y = (r1 - r2) * 0.29889531 + (g1 - g2) * 0.58662247 + (b1 - b2) * 0.11448223;
        const u = (r1 - r2) * 0.59597799 - (g1 - g2) * 0.2741761 - (b1 - b2) * 0.32180189;
        const v = (r1 - r2) * 0.21147017 - (g1 - g2) * 0.52261711 + (b1 - b2) * 0.31114694;
        if (0.5053 * y * y + 0.299 * u * u + 0.1957 * v * v > limit) diff++;
      }
      return {diff, total: x.width * x.height};
    }, [got.toString('base64'), baseline, threshold]);
    if (r.size) return [false, `to match ${file} (size ${r.size})`, r.size];
    const allowed = Math.max(o.maxDiffPixels ?? 0, o.maxDiffPixelRatio !== undefined ? Math.floor(o.maxDiffPixelRatio * r.total) : 0);
    return [r.diff <= allowed, `to match ${file} (at most ${allowed} different pixels)`, `${r.diff} different pixels`];
  }, negate, o.timeout ?? expectTimeout, 'screenshot', label).catch(e => {
    if (actual) writeFileSync(info.outputPath(base + '-actual.png'), actual);
    throw e;
  });
}

export function expect(actual, label) {
  const build = negate => {
    if (actual instanceof Locator) return retryingMatchers(actual, LOCATOR, negate, label, `locator ${actual.selector}`);
    if (actual instanceof Page) return retryingMatchers(actual, PAGE, negate, label, 'page');
    return valueMatchers(actual, negate, label);
  };
  const m = build(false);
  m.not = build(true);
  return m;
}
expect.soft = expect;
/** `await expect.poll(fn, {timeout}).toBe(x)`: calls fn until its value passes the matcher. */
expect.poll = (fn, options = {}) => {
  const build = negate => {
    const m = {};
    for (const [name, check] of Object.entries(VALUE)) m[name] = (...args) => retry(fn, v => check(v, ...args), negate, options.timeout ?? expectTimeout, 'polled value', options.message);
    return m;
  };
  const m = build(false);
  m.not = build(true);
  return m;
};
expect.configure = () => expect;
