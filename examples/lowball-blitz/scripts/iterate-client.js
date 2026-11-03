#!/usr/bin/env node
// =============================================================================
// iterate-client.js — Tight implement→test loop for browser game development
//
// A standalone browser script (Chrome over the DevTools protocol, ./cdp.mjs) that launches a browser, performs choreographed
// actions on a game, captures screenshots + text state, and tracks console errors.
// Designed for AI agents to verify changes after each small code edit.
//
// Usage:
//   node scripts/iterate-client.js --url http://localhost:3000 \
//     --actions-json '[{"buttons":["space"],"frames":4}]' \
//     --iterations 3 --pause-ms 250
//
// Or with an actions file:
//   node scripts/iterate-client.js --url http://localhost:3000 \
//     --actions-file scripts/example-actions.json --iterations 5
//
// Or a simple click:
//   node scripts/iterate-client.js --url http://localhost:3000 \
//     --click 480,270 --iterations 2
//
// Multi-restart testing:
//   node scripts/iterate-client.js --url http://localhost:3000 \
//     --restart-cycles 3 --restart-key Space
//
// Outputs:
//   <screenshot-dir>/shot-<i>.png     — canvas screenshot per iteration
//   <screenshot-dir>/state-<i>.json   — render_game_to_text() output per iteration
//   <screenshot-dir>/errors-<i>.json  — console errors (breaks on first new error)
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from './cdp.mjs';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    url: null,
    iterations: 3,
    pauseMs: 250,
    headless: true,
    screenshotDir: 'output/iterate',
    actionsFile: null,
    actionsJson: null,
    click: null,
    clickSelector: null,
    waitForGame: true,        // Wait for window.__GAME__ to be ready
    timeoutMs: 10000,         // Max wait for game boot
    restartCycles: 0,         // Number of restart cycles (0 = disabled)
    restartKey: 'Space',      // Key to press to restart the game
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--url' && next) { args.url = next; i++; }
    else if (arg === '--iterations' && next) { args.iterations = parseInt(next, 10); i++; }
    else if (arg === '--pause-ms' && next) { args.pauseMs = parseInt(next, 10); i++; }
    else if (arg === '--headless' && next) { args.headless = next !== '0' && next !== 'false'; i++; }
    else if (arg === '--screenshot-dir' && next) { args.screenshotDir = next; i++; }
    else if (arg === '--actions-file' && next) { args.actionsFile = next; i++; }
    else if (arg === '--actions-json' && next) { args.actionsJson = next; i++; }
    else if (arg === '--click' && next) {
      const parts = next.split(',').map(v => parseFloat(v.trim()));
      if (parts.length === 2 && parts.every(v => Number.isFinite(v))) {
        args.click = { x: parts[0], y: parts[1] };
      }
      i++;
    }
    else if (arg === '--click-selector' && next) { args.clickSelector = next; i++; }
    else if (arg === '--no-wait') { args.waitForGame = false; }
    else if (arg === '--timeout' && next) { args.timeoutMs = parseInt(next, 10); i++; }
    else if (arg === '--restart-cycles' && next) { args.restartCycles = parseInt(next, 10); i++; }
    else if (arg === '--restart-key' && next) { args.restartKey = next; i++; }
  }

  if (!args.url) {
    console.error(`Usage: node iterate-client.js --url <game-url> [--actions-json <json> | --actions-file <path> | --click x,y]

Required:
  --url <url>                  Game URL (e.g., http://localhost:3000)

Actions (at least one required):
  --actions-json <json>        Inline JSON array of action steps
  --actions-file <path>        Path to JSON file with action steps
  --click <x,y>               Single click at canvas-relative coordinates

Options:
  --iterations <n>             Number of action→capture cycles (default: 3)
  --pause-ms <ms>              Pause between iterations (default: 250)
  --headless <bool>            Run headless (default: true, use 'false' for debugging)
  --screenshot-dir <dir>       Output directory (default: output/iterate)
  --click-selector <sel>       CSS selector to click before starting actions
  --no-wait                    Don't wait for window.__GAME__ to be ready
  --timeout <ms>               Max wait for game boot (default: 10000)

Restart testing:
  --restart-cycles <n>         Number of restart cycles to test (default: 0 = disabled)
  --restart-key <key>          Key to press to restart (default: Space)`);
    process.exit(1);
  }

  return args;
}

// ---------------------------------------------------------------------------
// Key mapping
// ---------------------------------------------------------------------------

const KEY_MAP = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  enter: 'Enter',
  space: 'Space',
  escape: 'Escape',
  tab: 'Tab',
  w: 'KeyW',
  a: 'KeyA',
  s: 'KeyS',
  d: 'KeyD',
  f: 'KeyF',
  m: 'KeyM',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

// ---------------------------------------------------------------------------
// Virtual time shim — injected before page load via addInitScript.
// Overrides RAF/setTimeout/setInterval to provide advanceTime() even for
// games that don't expose it natively. If the game already has advanceTime,
// this shim's version takes precedence (injected earlier).
// ---------------------------------------------------------------------------

function makeVirtualTimeShim() {
  return `(() => {
    const origRAF = window.requestAnimationFrame.bind(window);
    const origSetTimeout = window.setTimeout.bind(window);
    const origSetInterval = window.setInterval.bind(window);

    const pending = new Set();
    window.__vt_pending = pending;

    window.setTimeout = (fn, t, ...rest) => {
      const task = {};
      pending.add(task);
      return origSetTimeout(() => { pending.delete(task); fn(...rest); }, t);
    };

    window.setInterval = (fn, t, ...rest) => {
      const task = {};
      pending.add(task);
      return origSetInterval(() => { fn(...rest); }, t);
    };

    window.requestAnimationFrame = (fn) => {
      const task = {};
      pending.add(task);
      return origRAF((ts) => { pending.delete(task); fn(ts); });
    };

    // Wait for real time to elapse (game loop runs normally via patched RAF)
    window.advanceTime = (ms) => {
      return new Promise((resolve) => {
        const start = performance.now();
        function step(now) {
          if (now - start >= ms) return resolve();
          origRAF(step);
        }
        origRAF(step);
      });
    };

    window.__drainVirtualTimePending = () => pending.size;
  })();`;
}

// ---------------------------------------------------------------------------
// Canvas detection and screenshot capture
// ---------------------------------------------------------------------------

async function getCanvasHandle(page) {
  // The CDP helper has no element handles: mark the largest canvas and return a locator for it.
  const found = await page.evaluate(() => {
    let best = null;
    let bestArea = 0;
    for (const canvas of document.querySelectorAll('canvas')) {
      const area = (canvas.width || canvas.clientWidth || 0) * (canvas.height || canvas.clientHeight || 0);
      if (area > bestArea) {
        bestArea = area;
        best = canvas;
      }
    }
    for (const c of document.querySelectorAll('canvas[data-iterate-canvas]')) c.removeAttribute('data-iterate-canvas');
    if (best) best.setAttribute('data-iterate-canvas', '');
    return !!best;
  });
  return found ? page.locator('canvas[data-iterate-canvas]') : null;
}

async function captureCanvasPngBase64(canvas) {
  return canvas.evaluate(c => {
    if (!c || typeof c.toDataURL !== 'function') return '';
    try {
      const data = c.toDataURL('image/png');
      const idx = data.indexOf(',');
      return idx === -1 ? '' : data.slice(idx + 1);
    } catch {
      return ''; // Security: tainted canvas
    }
  });
}

async function isCanvasTransparent(canvas) {
  if (!canvas) return true;
  return canvas.evaluate(c => {
    try {
      const w = c.width || c.clientWidth || 0;
      const h = c.height || c.clientHeight || 0;
      if (!w || !h) return true;
      const size = Math.max(1, Math.min(16, w, h));
      const probe = document.createElement('canvas');
      probe.width = size;
      probe.height = size;
      const ctx = probe.getContext('2d');
      if (!ctx) return true;
      ctx.drawImage(c, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) return false;
      }
      return true;
    } catch {
      return false; // Can't probe → assume not transparent
    }
  });
}

async function captureScreenshot(page, canvas, outPath) {
  let buffer = null;

  // Strategy 1: canvas.toDataURL (highest fidelity for WebGL)
  if (canvas) {
    const base64 = await captureCanvasPngBase64(canvas);
    if (base64) {
      buffer = Buffer.from(base64, 'base64');
      const transparent = await isCanvasTransparent(canvas);
      if (transparent) buffer = null; // Probably failed, try next strategy
    }
  }

  // Strategy 2: element screenshot
  if (!buffer && canvas) {
    try {
      buffer = await canvas.screenshot({ type: 'png' });
    } catch {
      buffer = null;
    }
  }

  // Strategy 3: Page screenshot with canvas clip
  if (!buffer) {
    const bbox = canvas ? await canvas.boundingBox() : null;
    if (bbox) {
      buffer = await page.screenshot({ type: 'png', omitBackground: false, clip: bbox });
    } else {
      buffer = await page.screenshot({ type: 'png', omitBackground: false });
    }
  }

  fs.writeFileSync(outPath, buffer);
}

// ---------------------------------------------------------------------------
// Console error tracking (deduplicated)
// ---------------------------------------------------------------------------

class ConsoleErrorTracker {
  constructor() {
    this._seen = new Set();
    this._errors = [];
  }

  ingest(err) {
    const key = JSON.stringify(err);
    if (this._seen.has(key)) return;
    this._seen.add(key);
    this._errors.push(err);
  }

  drain() {
    const out = [...this._errors];
    this._errors = [];
    return out;
  }

  get count() {
    return this._errors.length;
  }
}

// ---------------------------------------------------------------------------
// Action choreography
// ---------------------------------------------------------------------------

async function runActions(page, canvas, steps) {
  for (const step of steps) {
    const buttons = new Set(step.buttons || []);

    // Press down all buttons
    for (const button of buttons) {
      if (button === 'left_mouse_button' || button === 'right_mouse_button') {
        const bbox = canvas ? await canvas.boundingBox() : null;
        if (!bbox) continue;
        const x = typeof step.mouse_x === 'number' ? step.mouse_x : bbox.width / 2;
        const y = typeof step.mouse_y === 'number' ? step.mouse_y : bbox.height / 2;
        await page.mouse.move(bbox.x + x, bbox.y + y);
        await page.mouse.down({ button: button === 'left_mouse_button' ? 'left' : 'right' });
      } else {
        const key = KEY_MAP[button] || button;
        await page.keyboard.down(key);
      }
    }

    // Advance frame-by-frame (each evaluate round-trip lets the browser process
    // events, so input state is properly registered per-frame)
    const frames = step.frames || 1;
    for (let f = 0; f < frames; f++) {
      await page.evaluate(async () => {
        if (typeof window.advanceTime === 'function') {
          await window.advanceTime(1000 / 60);
        }
      });
    }

    // Release all buttons
    for (const button of buttons) {
      if (button === 'left_mouse_button' || button === 'right_mouse_button') {
        await page.mouse.up({ button: button === 'left_mouse_button' ? 'left' : 'right' });
      } else {
        const key = KEY_MAP[button] || button;
        await page.keyboard.up(key);
      }
    }

    // Optional wait between steps
    if (step.wait_ms) {
      await sleep(step.wait_ms);
    }
  }
}

// ---------------------------------------------------------------------------
// Parse action steps from CLI args
// ---------------------------------------------------------------------------

function loadActions(args) {
  if (args.actionsFile) {
    const raw = fs.readFileSync(args.actionsFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed.steps || [];
  }
  if (args.actionsJson) {
    const parsed = JSON.parse(args.actionsJson);
    return Array.isArray(parsed) ? parsed : parsed.steps || [];
  }
  if (args.click) {
    return [{
      buttons: ['left_mouse_button'],
      frames: 2,
      mouse_x: args.click.x,
      mouse_y: args.click.y,
    }];
  }
  // Default: single space press (works for most menu→game transitions)
  return [{ buttons: ['space'], frames: 4 }];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const steps = loadActions(args);
  ensureDir(args.screenshotDir);

  console.log(`iterate-client: ${args.url}`);
  console.log(`  actions: ${steps.length} steps, ${args.iterations} iterations`);
  if (args.restartCycles > 0) {
    console.log(`  restart: ${args.restartCycles} cycles, key: ${args.restartKey}`);
  }
  console.log(`  output:  ${args.screenshotDir}/`);

  const browser = await chromium.launch({
    headless: args.headless,
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });

  const page = await browser.newPage();
  const errors = new ConsoleErrorTracker();

  // Track console errors
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    errors.ingest({ type: 'console.error', text: msg.text() });
  });
  page.on('pageerror', err => {
    errors.ingest({ type: 'pageerror', text: String(err) });
  });

  // Inject virtual time shim before page load — provides advanceTime() even
  // for games that don't expose it, and tracks pending async operations
  await page.addInitScript({ content: makeVirtualTimeShim() });

  // Navigate
  await page.goto(args.url, { waitUntil: 'domcontentloaded' });

  // Wait for game to be ready (our templates expose window.__GAME__)
  if (args.waitForGame) {
    try {
      await page.waitForFunction(() => {
        // Phaser: __GAME__.isBooted && __GAME__.canvas
        const g = window.__GAME__;
        if (g && g.isBooted && g.canvas) return true;
        // Three.js: __GAME__.renderer
        if (g && g.renderer) return true;
        return false;
      }, { timeout: args.timeoutMs });
    } catch {
      console.warn('  warn: timed out waiting for game boot, proceeding anyway');
    }
  }

  // Let initial render settle
  await page.waitForTimeout(500);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));

  let canvas = await getCanvasHandle(page);

  // Optional pre-action click (e.g., click a start button)
  if (args.clickSelector) {
    try {
      await page.click(args.clickSelector, { timeout: 5000 });
      await page.waitForTimeout(250);
    } catch (err) {
      console.warn(`  warn: failed to click selector "${args.clickSelector}":`, err.message);
    }
  }

  // Check for boot errors before starting iterations
  const bootErrors = errors.drain();
  if (bootErrors.length) {
    const errPath = path.join(args.screenshotDir, 'errors-boot.json');
    fs.writeFileSync(errPath, JSON.stringify(bootErrors, null, 2));
    console.error(`  BOOT ERRORS (${bootErrors.length}): see ${errPath}`);
  }

  // --- Iteration loop ---
  let hadErrors = false;
  for (let i = 0; i < args.iterations; i++) {
    if (!canvas) canvas = await getCanvasHandle(page);

    // Run choreographed actions
    await runActions(page, canvas, steps);
    await sleep(args.pauseMs);

    // Capture screenshot
    const shotPath = path.join(args.screenshotDir, `shot-${i}.png`);
    await captureScreenshot(page, canvas, shotPath);

    // Capture text state
    const textState = await page.evaluate(() => {
      if (typeof window.render_game_to_text === 'function') {
        return window.render_game_to_text();
      }
      // Fallback: read __GAME_STATE__ directly
      if (window.__GAME_STATE__) {
        return JSON.stringify(window.__GAME_STATE__);
      }
      return null;
    });
    if (textState) {
      fs.writeFileSync(path.join(args.screenshotDir, `state-${i}.json`), textState);
    }

    const tag = textState ? ` state=${textState.slice(0, 80)}` : '';
    console.log(`  [${i}] screenshot: ${shotPath}${tag}`);

    // Check for new errors
    const freshErrors = errors.drain();
    if (freshErrors.length) {
      const errPath = path.join(args.screenshotDir, `errors-${i}.json`);
      fs.writeFileSync(errPath, JSON.stringify(freshErrors, null, 2));
      console.error(`  [${i}] ERRORS (${freshErrors.length}): see ${errPath}`);
      hadErrors = true;
      break; // Stop on first new error — fix before continuing
    }
  }

  // --- Restart cycle testing ---
  if (!hadErrors && args.restartCycles > 0) {
    console.log(`\n--- Restart cycle testing (${args.restartCycles} cycles, key: ${args.restartKey}) ---`);
    const restartIssues = [];

    for (let cycle = 0; cycle < args.restartCycles; cycle++) {
      console.log(`\n  [cycle ${cycle + 1}/${args.restartCycles}]`);

      // Step 1: Run actions to play the game
      if (!canvas) canvas = await getCanvasHandle(page);
      await runActions(page, canvas, steps);
      await sleep(args.pauseMs);

      // Step 2: Wait for game_over state (poll render_game_to_text every 500ms, timeout 15s)
      let gameOverReached = false;
      const pollStart = Date.now();
      const pollTimeout = 15000;

      while (Date.now() - pollStart < pollTimeout) {
        const stateStr = await page.evaluate(() => {
          if (typeof window.render_game_to_text === 'function') {
            return window.render_game_to_text();
          }
          if (window.__GAME_STATE__) {
            return JSON.stringify(window.__GAME_STATE__);
          }
          return null;
        });

        if (stateStr) {
          try {
            const state = JSON.parse(stateStr);
            if (state.mode === 'game_over' || state.gameOver === true) {
              gameOverReached = true;
              console.log(`    game_over reached (${Date.now() - pollStart}ms)`);
              break;
            }
          } catch { /* ignore parse errors */ }
        }

        // Advance time and wait before next poll
        await page.evaluate(async () => {
          if (typeof window.advanceTime === 'function') {
            await window.advanceTime(500);
          }
        });
        await sleep(500);
      }

      if (!gameOverReached) {
        console.warn('    warn: game_over not reached within 15s, pressing restart anyway');
      }

      // Capture pre-restart screenshot
      const preRestartPath = path.join(args.screenshotDir, `restart-${cycle}-pre.png`);
      await captureScreenshot(page, canvas, preRestartPath);

      // Step 3: Press the restart key
      const restartKeyMapped = KEY_MAP[args.restartKey.toLowerCase()] || args.restartKey;
      await page.keyboard.press(restartKeyMapped);
      console.log(`    pressed ${args.restartKey}`);

      // Small delay for game to process restart
      await sleep(500);

      // Also advance a few frames for the game loop to process
      await page.evaluate(async () => {
        if (typeof window.advanceTime === 'function') {
          await window.advanceTime(500);
        }
      });
      await sleep(250);

      // Step 4: Verify state after restart
      const postStateStr = await page.evaluate(() => {
        if (typeof window.render_game_to_text === 'function') {
          return window.render_game_to_text();
        }
        if (window.__GAME_STATE__) {
          return JSON.stringify(window.__GAME_STATE__);
        }
        return null;
      });

      // Capture post-restart screenshot
      const postRestartPath = path.join(args.screenshotDir, `restart-${cycle}-post.png`);
      await captureScreenshot(page, canvas, postRestartPath);

      if (postStateStr) {
        try {
          const postState = JSON.parse(postStateStr);
          const issues = [];

          // Check score reset to 0
          if (typeof postState.score === 'number' && postState.score !== 0) {
            issues.push(`score not reset: expected 0, got ${postState.score}`);
          }

          // Check mode is not game_over (should be playing, menu, or similar)
          if (postState.mode === 'game_over') {
            issues.push(`mode still game_over after restart`);
          }

          if (issues.length > 0) {
            console.error(`    ISSUES: ${issues.join('; ')}`);
            restartIssues.push({
              cycle: cycle + 1,
              issues,
              preRestartScreenshot: preRestartPath,
              postRestartScreenshot: postRestartPath,
              postState: postState,
            });
          } else {
            const mode = postState.mode || 'unknown';
            const score = postState.score ?? 'n/a';
            console.log(`    OK — mode: ${mode}, score: ${score}`);
          }
        } catch (err) {
          console.warn(`    warn: could not parse post-restart state: ${err.message}`);
        }
      } else {
        console.warn('    warn: render_game_to_text() returned null after restart');
      }

      // Check for console errors during this cycle
      const cycleErrors = errors.drain();
      if (cycleErrors.length) {
        const errPath = path.join(args.screenshotDir, `errors-restart-${cycle}.json`);
        fs.writeFileSync(errPath, JSON.stringify(cycleErrors, null, 2));
        console.error(`    ERRORS (${cycleErrors.length}): see ${errPath}`);
        hadErrors = true;
        break;
      }
    }

    // Write issues file if there were any
    if (restartIssues.length > 0) {
      const issuesPath = path.join(args.screenshotDir, `restart-${args.restartCycles}-issues.json`);
      fs.writeFileSync(issuesPath, JSON.stringify(restartIssues, null, 2));
      console.error(`\n  Restart issues written to ${issuesPath}`);
    } else if (!hadErrors) {
      console.log(`\n  All ${args.restartCycles} restart cycles passed`);
    }
  }

  await browser.close();

  if (hadErrors) {
    console.error('\niterate-client: FAILED — console errors detected');
    process.exit(1);
  }

  console.log('\niterate-client: PASSED — no errors');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
