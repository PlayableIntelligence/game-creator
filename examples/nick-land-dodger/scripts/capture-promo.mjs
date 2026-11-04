/**
 * Autonomous promo video capture for nick-land-dodger.
 *
 * Technique: recordVideo (./cdp.mjs) records at 25 FPS.
 * We slow the game to 0.5× and record for 2× duration,
 * then FFmpeg speeds it up 2× → effective 50 FPS output.
 *
 * Usage:
 *   node scripts/capture-promo.mjs [--port 3003] [--duration 13000] [--output output/promo-raw.webm]
 */

import { chromium } from './cdp.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');

// --- Config ---
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const PORT = getArg('port', '3003');
const GAME_URL = `http://localhost:${PORT}/`;
const VIEWPORT = { width: 1080, height: 1920 }; // 9:16 portrait (mobile-native)
const SLOW_MO_FACTOR = 0.5;
const DESIRED_GAME_DURATION = parseInt(getArg('duration', '13000'), 10); // ms of game-time
const WALL_CLOCK_DURATION = DESIRED_GAME_DURATION / SLOW_MO_FACTOR;
const OUTPUT_DIR = path.resolve(PROJECT_DIR, getArg('output-dir', 'output'));
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'promo-raw.webm');

// --- Synthetic input patterns (make it look like real dodging) ---
// Each segment: { key, holdMs, pauseMs }
// Varying hold/pause durations create natural-looking movement
function generateInputSequence(totalMs) {
  const sequence = [];
  let elapsed = 0;
  const keys = ['ArrowLeft', 'ArrowRight'];
  let keyIdx = 0;

  // First 1.5s: let entrance animation play (no input)
  sequence.push({ key: null, holdMs: 0, pauseMs: 1500 });
  elapsed += 1500;

  while (elapsed < totalMs) {
    // Vary hold times: 150-600ms (short dodges + longer sweeps)
    const holdMs = 150 + Math.floor(Math.random() * 450);
    // Vary pauses: 50-300ms (quick reactions + brief hesitations)
    const pauseMs = 50 + Math.floor(Math.random() * 250);

    // Occasionally do a quick double-tap (same direction)
    const doubleTap = Math.random() < 0.15;
    if (doubleTap) {
      sequence.push({ key: keys[keyIdx], holdMs: 100, pauseMs: 60 });
      sequence.push({ key: keys[keyIdx], holdMs: holdMs, pauseMs: pauseMs });
      elapsed += 100 + 60 + holdMs + pauseMs;
    } else {
      sequence.push({ key: keys[keyIdx], holdMs, pauseMs });
      elapsed += holdMs + pauseMs;
    }

    // Alternate direction (with occasional same-direction repeats)
    if (Math.random() < 0.75) {
      keyIdx = 1 - keyIdx;
    }
  }

  return sequence;
}

async function captureGameplay() {
  console.log(`Capturing promo video...`);
  console.log(`  Game URL: ${GAME_URL}`);
  console.log(`  Viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);
  console.log(`  Game duration: ${DESIRED_GAME_DURATION}ms (wall clock: ${WALL_CLOCK_DURATION}ms)`);
  console.log(`  Slow-mo factor: ${SLOW_MO_FACTOR}`);
  console.log(`  Output: ${OUTPUT_FILE}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: {
      dir: OUTPUT_DIR,
      size: VIEWPORT,
    },
  });

  const page = await context.newPage();

  // Navigate and wait for Phaser boot
  await page.goto(GAME_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__GAME__?.isBooted, { timeout: 15000 });
  console.log('  Game booted.');

  // Wait for GameScene to be active and entrance animation to start
  await page.waitForFunction(() => {
    const gs = window.__GAME_STATE__;
    return gs && gs.started;
  }, { timeout: 10000 });
  console.log('  GameScene active.');

  // Small delay for entrance animation to begin
  await page.waitForTimeout(300);

  // Monkey-patch: prevent game over during recording
  await page.evaluate(() => {
    const scene = window.__GAME__.scene.getScene('GameScene');
    if (scene) {
      scene.triggerGameOver = () => {};
      scene.onPlayerHit = () => {};
    }
  });
  console.log('  Death patched out.');

  // Slow down all 5 Phaser time subsystems
  await page.evaluate(({ factor }) => {
    const game = window.__GAME__;
    const scene = game.scene.getScene('GameScene');

    // 1. Update delta
    const originalUpdate = scene.update.bind(scene);
    scene.update = function(time, delta) {
      originalUpdate(time, delta * factor);
    };

    // 2. Tweens
    scene.tweens.timeScale = factor;

    // 3. Scene timers
    scene.time.timeScale = factor;

    // 4. Physics
    if (scene.physics?.world) {
      scene.physics.world.timeScale = 1 / factor; // Arcade physics is inverse
    }

    // 5. Animations
    if (scene.anims) {
      scene.anims.globalTimeScale = factor;
    }
  }, { factor: SLOW_MO_FACTOR });
  console.log(`  Game slowed to ${SLOW_MO_FACTOR}x.`);

  // Generate and execute synthetic inputs
  const sequence = generateInputSequence(WALL_CLOCK_DURATION);
  console.log(`  Playing ${sequence.length} input segments over ${WALL_CLOCK_DURATION}ms...`);

  for (const seg of sequence) {
    if (seg.key === null) {
      // Pure pause (e.g., entrance animation)
      await page.waitForTimeout(seg.pauseMs);
      continue;
    }

    // Hold the key
    await page.keyboard.down(seg.key);
    await page.waitForTimeout(seg.holdMs);
    await page.keyboard.up(seg.key);

    // Pause between inputs
    if (seg.pauseMs > 0) {
      await page.waitForTimeout(seg.pauseMs);
    }
  }

  console.log('  Input sequence complete.');

  // Close context to finalize video
  const video = page.video();
  await context.close();

  const videoPath = await video.path();
  console.log(`  Raw recording saved: ${videoPath}`);

  // Rename to expected output path
  const fs = await import('fs');
  if (videoPath !== OUTPUT_FILE) {
    fs.renameSync(videoPath, OUTPUT_FILE);
    console.log(`  Moved to: ${OUTPUT_FILE}`);
  }

  await browser.close();
  console.log('Done. Run FFmpeg to convert:');
  console.log(`  scripts/convert-highfps.sh ${OUTPUT_FILE} output/promo.mp4 ${SLOW_MO_FACTOR}`);
}

captureGameplay().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
