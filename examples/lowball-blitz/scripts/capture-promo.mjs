#!/usr/bin/env node
/**
 * capture-promo.mjs — Record promo footage of Lowball Blitz via screenshot loop.
 *
 * WebGL + headless Chromium's recordVideo produces black frames.
 * Workaround: take viewport screenshots at 25 FPS, assemble with FFmpeg → 50 FPS.
 *
 * Usage:
 *   node scripts/capture-promo.mjs --port 3008 --duration 8000 --output-dir output
 */

import { chromium } from './cdp.mjs';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return (idx !== -1 && idx + 1 < args.length) ? args[idx + 1] : fallback;
}

const PORT = getArg('port', '3008');
const DESIRED_GAME_DURATION = parseInt(getArg('duration', '8000'), 10);
const OUTPUT_DIR = resolve(getArg('output-dir', 'output'));
const FRAMES_DIR = join(OUTPUT_DIR, 'frames');

const CAPTURE_FPS = 12; // screenshots per second (limited by screenshot speed)
const FRAME_INTERVAL = 1000 / CAPTURE_FPS;
const VIEWPORT = { width: 540, height: 960 }; // half-res for faster screenshots

mkdirSync(FRAMES_DIR, { recursive: true });

// Clean old frames
for (const f of readdirSync(FRAMES_DIR)) {
  if (f.endsWith('.jpg')) unlinkSync(join(FRAMES_DIR, f));
}

// ---------------------------------------------------------------------------
// Input action generator
// ---------------------------------------------------------------------------
function generateInputSequence(totalMs) {
  const actions = [];
  let elapsed = 0;

  // 1.5s pause for entrance
  actions.push({ type: 'wait', ms: 1500 });
  elapsed += 1500;

  while (elapsed < totalMs) {
    // Throw
    actions.push({ type: 'key', key: 'Space', hold: 50 });
    elapsed += 50;

    const postThrow = 80 + Math.floor(Math.random() * 150);
    actions.push({ type: 'wait', ms: postThrow });
    elapsed += postThrow;

    // Dodge
    const dodgeKey = Math.random() > 0.5 ? 'ArrowLeft' : 'ArrowRight';
    const holdMs = 120 + Math.floor(Math.random() * 300);
    actions.push({ type: 'key', key: dodgeKey, hold: holdMs });
    elapsed += holdMs;

    const gap = 80 + Math.floor(Math.random() * 200);
    actions.push({ type: 'wait', ms: gap });
    elapsed += gap;
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n=== Promo Capture (screenshot mode): Lowball Blitz ===`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Duration: ${DESIRED_GAME_DURATION}ms`);
  console.log(`  Capture FPS: ${CAPTURE_FPS}`);
  console.log(`  Viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);
  console.log(`  Output: ${OUTPUT_DIR}/promo.mp4\n`);

  // Must use headed mode — headless Chromium renders WebGL canvases as black
  const browser = await chromium.launch({
    headless: false,
    args: ['--use-gl=angle', '--use-angle=metal'],
  });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Patch death
  await page.evaluate(() => {
    const state = window.__GAME_STATE__;
    if (state) state.loseLife = () => false;
    const bus = window.__EVENT_BUS__;
    if (bus) {
      const origEmit = bus.emit.bind(bus);
      bus.emit = (event, data) => {
        if (event === 'game:over' || event === 'player:died') return;
        return origEmit(event, data);
      };
    }
    const game = window.__GAME__;
    if (game && game.player) game.player.takeDamage = () => {};
  });

  console.log('  [capture] Death patched. Starting capture...');

  // Run input + capture in parallel
  const inputActions = generateInputSequence(DESIRED_GAME_DURATION);
  let frameNum = 0;
  let capturing = true;

  // Start screenshot loop
  const captureLoop = (async () => {
    while (capturing) {
      const start = Date.now();
      const padded = String(frameNum).padStart(5, '0');
      try {
        await page.screenshot({
          path: join(FRAMES_DIR, `frame-${padded}.jpg`),
          type: 'jpeg',
          quality: 85,
        });
        frameNum++;
      } catch {
        // page might be closing
        break;
      }
      const elapsed = Date.now() - start;
      const wait = Math.max(0, FRAME_INTERVAL - elapsed);
      if (wait > 0) await page.waitForTimeout(wait);
    }
  })();

  // Run input actions
  for (const action of inputActions) {
    if (!capturing) break;
    if (action.type === 'wait') {
      await page.waitForTimeout(action.ms);
    } else if (action.type === 'key') {
      await page.keyboard.down(action.key);
      await page.waitForTimeout(action.hold);
      await page.keyboard.up(action.key);
    }
  }

  // Stop capture
  capturing = false;
  await captureLoop;

  await page.close();
  await context.close();
  await browser.close();

  console.log(`  [capture] Captured ${frameNum} frames.`);

  if (frameNum < 10) {
    console.error('  [capture] Too few frames captured!');
    process.exit(1);
  }

  // Assemble with FFmpeg — input at capture FPS, output at 2x for smooth 24 FPS
  const outPath = join(OUTPUT_DIR, 'promo.mp4');
  const ffmpegCmd = `ffmpeg -y -framerate ${CAPTURE_FPS} -i "${FRAMES_DIR}/frame-%05d.jpg" -vf "scale=1080:1920:flags=lanczos" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -r 24 "${outPath}"`;

  console.log('  [capture] Assembling MP4...');
  try {
    execSync(ffmpegCmd, { stdio: 'pipe' });
  } catch (err) {
    console.error(`  FFmpeg error: ${err.stderr?.toString().slice(-200)}`);
    process.exit(1);
  }

  // Get file info
  const { statSync } = await import('node:fs');
  const stat = statSync(outPath);
  const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);

  // Extract thumbnail
  try {
    execSync(`ffmpeg -y -ss 3 -i "${outPath}" -frames:v 1 -update 1 "${join(OUTPUT_DIR, 'promo-thumbnail.jpg')}"`, { stdio: 'pipe' });
  } catch { /* non-critical */ }

  console.log(`\n  video → ${outPath} (${sizeMB} MB, ${frameNum} frames)`);
  console.log('\n=== Capture complete ===\n');
}

main().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
