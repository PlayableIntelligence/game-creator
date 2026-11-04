import { chromium } from './cdp.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');

// --- Config ---
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const PORT = getArg('port', '3001');
const GAME_URL = `http://localhost:${PORT}/`;
const VIEWPORT = { width: 1080, height: 1920 }; // 9:16 mobile portrait
const SLOW_MO_FACTOR = 0.5;
const DESIRED_GAME_DURATION = parseInt(getArg('duration', '13000'), 10);
const WALL_CLOCK_DURATION = DESIRED_GAME_DURATION / SLOW_MO_FACTOR;
const OUTPUT_DIR = path.resolve(PROJECT_DIR, getArg('output-dir', 'output'));
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'promo-raw.webm');

// Generate arena battle input: dodge left/right + throw projectiles
function generateInputSequence(totalMs) {
  const sequence = [];
  let elapsed = 0;

  // Pause for entrance animation (characters rise up)
  sequence.push({ key: null, holdMs: 0, pauseMs: 2000 });
  elapsed += 2000;

  while (elapsed < totalMs) {
    // Dodge left or right
    const dodgeKey = Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight';
    const dodgeMs = 200 + Math.floor(Math.random() * 400);
    sequence.push({ key: dodgeKey, holdMs: dodgeMs, pauseMs: 50 });
    elapsed += dodgeMs + 50;

    // Throw projectile
    sequence.push({ key: 'Space', holdMs: 80, pauseMs: 100 + Math.floor(Math.random() * 200) });
    elapsed += 80 + 200;

    // Sometimes double-dodge for variety
    if (Math.random() < 0.3) {
      const dir = Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight';
      const ms = 100 + Math.floor(Math.random() * 200);
      sequence.push({ key: dir, holdMs: ms, pauseMs: 30 });
      elapsed += ms + 30;
    }

    // Sometimes rapid-fire
    if (Math.random() < 0.2) {
      sequence.push({ key: 'Space', holdMs: 60, pauseMs: 80 });
      elapsed += 140;
      sequence.push({ key: 'Space', holdMs: 60, pauseMs: 150 });
      elapsed += 210;
    }

    // Brief pause between actions
    const pause = 50 + Math.floor(Math.random() * 150);
    sequence.push({ key: null, holdMs: 0, pauseMs: pause });
    elapsed += pause;
  }

  return sequence;
}

async function captureGameplay() {
  console.log('Capturing promo video...');
  console.log(`  URL: ${GAME_URL} | Viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);
  console.log(`  Game duration: ${DESIRED_GAME_DURATION}ms | Wall clock: ${WALL_CLOCK_DURATION}ms`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: OUTPUT_DIR, size: VIEWPORT },
  });

  const page = await context.newPage();
  await page.goto(GAME_URL, { waitUntil: 'networkidle' });

  // Wait for Three.js game boot + gameplay active
  await page.waitForFunction(() => window.__GAME__ != null, { timeout: 15000 });
  await page.waitForFunction(() => window.__GAME_STATE__?.started === true, { timeout: 10000 });
  await page.waitForTimeout(500);
  console.log('  Game active.');

  // Patch out death — prevent health depletion and game over
  await page.evaluate(() => {
    const gs = window.__GAME_STATE__;
    // Override takeDamage to do nothing
    gs.takeDamage = () => {};
    // Ensure health stays full
    Object.defineProperty(gs, 'health', {
      get() { return 5; },
      set() {},
      configurable: true,
    });
  });
  console.log('  Death patched.');

  // Slow the Three.js clock for smooth recording
  await page.evaluate(({ factor }) => {
    const game = window.__GAME__;
    if (game && game.clock) {
      const origGetDelta = game.clock.getDelta.bind(game.clock);
      game.clock.getDelta = function() {
        return origGetDelta() * factor;
      };
    }
  }, { factor: SLOW_MO_FACTOR });
  console.log(`  Slowed to ${SLOW_MO_FACTOR}x.`);

  // Execute input sequence
  const sequence = generateInputSequence(WALL_CLOCK_DURATION);
  console.log(`  Playing ${sequence.length} inputs over ${WALL_CLOCK_DURATION}ms...`);

  for (const seg of sequence) {
    if (!seg.key) { await page.waitForTimeout(seg.pauseMs); continue; }
    await page.keyboard.down(seg.key);
    await page.waitForTimeout(seg.holdMs);
    await page.keyboard.up(seg.key);
    if (seg.pauseMs > 0) await page.waitForTimeout(seg.pauseMs);
  }

  console.log('  Input complete.');

  // Finalize video
  const video = page.video();
  await context.close();
  const videoPath = await video.path();

  if (videoPath !== OUTPUT_FILE) {
    fs.renameSync(videoPath, OUTPUT_FILE);
  }

  await browser.close();
  console.log(`  Raw recording: ${OUTPUT_FILE}`);
  console.log('Done.');
}

captureGameplay().catch(err => { console.error('Capture failed:', err); process.exit(1); });
