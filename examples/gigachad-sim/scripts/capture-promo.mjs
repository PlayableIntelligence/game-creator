#!/usr/bin/env node
/**
 * capture-promo.mjs — Record autonomous promo footage of GigaChad Sim.
 * Records at 0.5x speed, 25 FPS → FFmpeg speeds up to 50 FPS.
 */

import { chromium } from './cdp.mjs';

const PORT = parseInt(process.argv.find((a, i, arr) => arr[i - 1] === '--port') ?? '3000');
const DURATION_MS = parseInt(process.argv.find((a, i, arr) => arr[i - 1] === '--duration') ?? '13000');
const OUTPUT_DIR = process.argv.find((a, i, arr) => arr[i - 1] === '--output-dir') ?? 'output';
const SLOW_MO = 0.5;
const WALL_CLOCK_MS = DURATION_MS / SLOW_MO;

console.log(`Capturing promo: port=${PORT}, game-time=${DURATION_MS}ms, wall-clock=${WALL_CLOCK_MS}ms`);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: 1080, height: 1920 },
  recordVideo: { dir: OUTPUT_DIR, size: { width: 1080, height: 1920 } },
});
const page = await context.newPage();

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });

// Wait for game to be ready
await page.waitForFunction(() => window.__GAME__ && window.__GAME_STATE__, { timeout: 30000 });
console.log('Game loaded.');

// Patch death — prevent game over
await page.evaluate(() => {
  const gs = window.__GAME_STATE__;
  // Override loseLife to never actually lose lives
  gs.loseLife = () => {};
  // Also patch gameState directly
  gs.gameOver = false;
  // Keep lives at 3
  Object.defineProperty(gs, 'lives', { get: () => 3, set: () => {} });
});
console.log('Death patched out.');

// Slow game to 0.5x by intercepting the clock
await page.evaluate((factor) => {
  const game = window.__GAME__;
  if (game && game.clock) {
    const origGetDelta = game.clock.getDelta.bind(game.clock);
    game.clock.getDelta = () => origGetDelta() * factor;
  }
}, SLOW_MO);
console.log(`Game slowed to ${SLOW_MO}x.`);

// Let entrance animation play (2s)
await page.waitForTimeout(2000);

// Generate input sequence — left/right movement for a dodger game
const totalMs = WALL_CLOCK_MS - 2000;
let elapsed = 0;

while (elapsed < totalMs) {
  // Random direction
  const key = Math.random() > 0.5 ? 'ArrowRight' : 'ArrowLeft';
  const holdMs = 200 + Math.floor(Math.random() * 500);
  const pauseMs = 50 + Math.floor(Math.random() * 200);

  await page.keyboard.down(key);
  await page.waitForTimeout(Math.min(holdMs, totalMs - elapsed));
  elapsed += holdMs;

  await page.keyboard.up(key);
  await page.waitForTimeout(Math.min(pauseMs, Math.max(0, totalMs - elapsed)));
  elapsed += pauseMs;

  // Occasional flex (Space)
  if (Math.random() < 0.15) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    elapsed += 100;
  }
}

console.log('Recording complete. Closing...');

await page.close();
await context.close();
await browser.close();

console.log(`Raw video saved to ${OUTPUT_DIR}/`);
