/**
 * capture-promo.mjs -- Autonomous promo video capture for mog-showdown.
 *
 * Launches headless Chrome with video recording (recordVideo in ./cdp.mjs: CDP screencast frames to ffmpeg),
 * patches out all death/game-over paths so gameplay runs uninterrupted,
 * and simulates skilled left/right dodging inputs for a natural-looking
 * promo clip.
 *
 * Usage:
 *   node scripts/capture-promo.mjs [--port 3001] [--duration 13000] [--output-dir output]
 *
 * Output:
 *   <output-dir>/promo-raw.webm
 */

import { chromium } from './cdp.mjs';
import { parseArgs } from 'node:util';
import { rename, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    port:         { type: 'string', default: '3001' },
    duration:     { type: 'string', default: '13000' },
    'output-dir': { type: 'string', default: 'output' },
  },
});

const PORT       = values.port;
const DURATION_MS = parseInt(values.duration, 10);
const OUTPUT_DIR  = path.resolve(values['output-dir']);

// ---------------------------------------------------------------------------
// Input sequence generator -- skilled dodger gameplay
// ---------------------------------------------------------------------------

/**
 * Generates a sequence of left/right dodging inputs that looks like a
 * skilled human player. Mixes:
 *   - Medium holds (200-500ms) for deliberate movement
 *   - Quick taps (80-150ms) for reactive dodges
 *   - Brief pauses (100-300ms) to breathe
 *   - Occasional double-taps (quick same-direction repeat)
 *   - Direction changes weighted toward alternation (looks like dodging)
 *
 * The first ~2s are idle so the entrance animation plays fully.
 */
function generateInputSequence(totalMs) {
  const seq = [];
  let elapsed = 0;

  // --- 2s entrance pause (visual hook: bounce-in + camera flash) ---
  seq.push({ key: null, holdMs: 2000 });
  elapsed += 2000;

  // Seed a simple PRNG for reproducibility
  let seed = 42;
  function rand() {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  function randBetween(lo, hi) {
    return lo + Math.floor(rand() * (hi - lo + 1));
  }

  let lastDir = null;        // 'ArrowLeft' | 'ArrowRight'
  let movesSinceSwitch = 0;  // how many same-direction moves in a row

  while (elapsed < totalMs) {
    const remaining = totalMs - elapsed;
    if (remaining < 80) break;

    // Decide: move or pause
    const pauseChance = movesSinceSwitch > 3 ? 0.35 : 0.12;
    if (rand() < pauseChance) {
      // Brief pause -- looks like the player is reading projectile paths
      const pauseMs = Math.min(randBetween(100, 300), remaining);
      seq.push({ key: null, holdMs: pauseMs });
      elapsed += pauseMs;
      continue;
    }

    // Pick direction -- favour switching for a dodging look
    const switchChance = lastDir === null ? 0.5 : 0.65;
    let dir;
    if (rand() < switchChance || lastDir === null) {
      dir = lastDir === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
      movesSinceSwitch = 0;
    } else {
      dir = lastDir;
      movesSinceSwitch++;
    }
    lastDir = dir;

    // Decide hold duration
    const isQuickTap = rand() < 0.30;
    let holdMs;
    if (isQuickTap) {
      holdMs = randBetween(80, 150);
    } else {
      holdMs = randBetween(200, 500);
    }
    holdMs = Math.min(holdMs, remaining);

    seq.push({ key: dir, holdMs });
    elapsed += holdMs;

    // Double-tap: ~18% chance to immediately repeat same direction
    if (rand() < 0.18 && elapsed < totalMs) {
      const dtHold = Math.min(randBetween(60, 120), totalMs - elapsed);
      // Brief gap before double-tap
      const gap = Math.min(randBetween(30, 60), totalMs - elapsed - dtHold);
      if (gap > 0) {
        seq.push({ key: null, holdMs: gap });
        elapsed += gap;
      }
      seq.push({ key: dir, holdMs: dtHold });
      elapsed += dtHold;
    }

    // Small inter-move gap (feels like releasing then pressing again)
    const gapMs = Math.min(randBetween(20, 80), totalMs - elapsed);
    if (gapMs > 0) {
      seq.push({ key: null, holdMs: gapMs });
      elapsed += gapMs;
    }
  }

  return seq;
}

// ---------------------------------------------------------------------------
// Death-patching evaluate payload
// ---------------------------------------------------------------------------

/**
 * Monkey-patches every code path that leads to game over so the player
 * never dies during recording. The patches are:
 *
 * 1. gameState.loseLife() -- always returns 999 and keeps lives at max
 * 2. GameScene.triggerGameOver() -- no-op
 * 3. EventBus listener for PLAYER_DIED -- removed
 * 4. GameScene.hitByAttack() -- skip damage, keep visual effects only
 * 5. gameState.gameOver setter -- blocked from becoming true
 */
const DEATH_PATCH_CODE = `(() => {
  const gs = window.__GAME_STATE__;
  const bus = window.__EVENT_BUS__;
  const events = window.__EVENTS__;

  if (!gs || !bus || !events) {
    console.warn('[promo] Game globals not ready for patching');
    return false;
  }

  // 1. Prevent lives from decreasing
  gs.loseLife = function() {
    // Keep lives at max, never trigger death
    return this.lives;
  };

  // 2. Block gameOver from ever becoming true
  let _gameOver = false;
  Object.defineProperty(gs, 'gameOver', {
    get() { return _gameOver; },
    set(v) {
      // Never allow gameOver = true during promo capture
      _gameOver = false;
    },
    configurable: true,
  });

  // 3. Remove all PLAYER_DIED listeners (safety net)
  bus.listeners[events.PLAYER_DIED] = [];

  // 4. Patch the active GameScene to neuter triggerGameOver
  const game = window.__GAME__;
  if (game) {
    const gameScene = game.scene.getScene('GameScene');
    if (gameScene) {
      gameScene.triggerGameOver = function() {
        // No-op during promo
      };

      // Also patch hitByAttack to skip the damage chain entirely
      // but keep the visual explosion of the projectile
      const origHitByAttack = gameScene.hitByAttack.bind(gameScene);
      gameScene.hitByAttack = function(proj) {
        // Mark projectile collected and do visual destroy, skip damage
        proj.markCollected();
        if (gameScene.tweens) {
          gameScene.tweens.add({
            targets: proj.sprite,
            scaleX: 0,
            scaleY: 0,
            alpha: 0,
            duration: 150,
            onComplete: () => proj.destroy(),
          });
        }
        // Skip: no ATTACK_HIT event, no invulnerability, no flashDamage
      };
    }
  }

  console.log('[promo] Death patches applied successfully');
  return true;
})()`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Ensure output directory exists
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`[promo] Capturing ${DURATION_MS}ms of gameplay on port ${PORT}`);
  console.log(`[promo] Output directory: ${OUTPUT_DIR}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
      '--run-all-compositor-stages-before-draw',
      '--disable-checker-imaging',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    recordVideo: {
      dir: OUTPUT_DIR,
      size: { width: 1080, height: 1920 },
    },
  });

  // Slow-mo is set on browser launch, not context; we handle pacing via
  // input timing instead. The recorder samples at 25 FPS whatever the
  // compositor provides.

  const page = await context.newPage();

  // Navigate and wait for the Phaser game to boot
  console.log('[promo] Navigating to game...');
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });

  // Wait for the Phaser game instance and GameScene to be active
  await page.waitForFunction(() => {
    const g = window.__GAME__;
    if (!g) return false;
    const scenes = g.scene.getScenes(true);
    return scenes.some(s => s.scene.key === 'GameScene');
  }, { timeout: 15000 });

  console.log('[promo] GameScene active, applying death patches...');

  // Apply death patches
  const patched = await page.evaluate(DEATH_PATCH_CODE);
  if (!patched) {
    console.error('[promo] Failed to apply death patches -- aborting');
    await context.close();
    await browser.close();
    process.exit(1);
  }

  // Play through the input sequence
  console.log('[promo] Starting input playback...');
  const sequence = generateInputSequence(DURATION_MS);

  for (const step of sequence) {
    if (step.key) {
      await page.keyboard.down(step.key);
      await page.waitForTimeout(step.holdMs);
      await page.keyboard.up(step.key);
    } else {
      await page.waitForTimeout(step.holdMs);
    }
  }

  console.log('[promo] Input playback complete, closing recording...');

  // Close page and context to finalize video
  await page.close();
  await context.close();

  // Find the recorded video and rename to promo-raw.webm
  const files = await readdir(OUTPUT_DIR);
  const video = files.find(f => f.endsWith('.webm'));
  if (video) {
    const src = path.join(OUTPUT_DIR, video);
    const dst = path.join(OUTPUT_DIR, 'promo-raw.webm');
    await rename(src, dst);
    console.log(`[promo] Promo captured: ${dst}`);
  } else {
    console.warn('[promo] No .webm file found in output directory');
  }

  await browser.close();
  console.log('[promo] Done.');
}

main().catch((err) => {
  console.error('[promo] Fatal error:', err);
  process.exit(1);
});
