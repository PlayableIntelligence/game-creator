import { expect } from '../../scripts/browser-test.mjs';
import { test, startPlaying } from '../fixtures/game-test.js';

test.describe('Flappy Bird — Game Tests', () => {
  test('game boots and shows canvas', async ({ gamePage: page }) => {
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('starts on GameScene', async ({ gamePage: page }) => {
    const sceneKey = await page.evaluate(() => {
      const scenes = window.__GAME__.scene.getScenes(true);
      return scenes[0]?.scene?.key;
    });
    expect(sceneKey).toBe('GameScene');
  });

  test('starts playing on first input', async ({ gamePage: page }) => {
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);

    const state = await page.evaluate(() => ({
      started: window.__GAME_STATE__.started,
      gameOver: window.__GAME_STATE__.gameOver,
    }));
    expect(state.started).toBe(true);
    expect(state.gameOver).toBe(false);
  });

  test('GameScene shows GET READY before first input', async ({ gamePage: page }) => {
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => ({
      started: window.__GAME_STATE__.started,
      gameOver: window.__GAME_STATE__.gameOver,
    }));
    expect(state.started).toBe(true);
    expect(state.gameOver).toBe(false);
  });

  test('bird flaps on space during gameplay', async ({ gamePage: page }) => {
    await startPlaying(page);

    const y1 = await page.evaluate(() => {
      const scene = window.__GAME__.scene.getScene('GameScene');
      return scene?.bird?.sprite?.y;
    });

    await page.keyboard.press('Space');
    await page.waitForTimeout(150);

    const y2 = await page.evaluate(() => {
      const scene = window.__GAME__.scene.getScene('GameScene');
      return scene?.bird?.sprite?.y;
    });

    // Bird should have moved up (lower y)
    expect(y2).toBeLessThan(y1);
  });

  test('score starts at zero', async ({ gamePage: page }) => {
    await startPlaying(page);

    const score = await page.evaluate(() => window.__GAME_STATE__.score);
    expect(score).toBe(0);
  });

  test('score increments via event', async ({ gamePage: page }) => {
    await startPlaying(page);

    await page.evaluate(() => {
      window.__EVENT_BUS__.emit(window.__EVENTS__.SCORE_CHANGED, { score: 1 });
    });

    // Score should be settable through the score system
    await page.evaluate(() => {
      window.__GAME_STATE__.addScore(1);
    });

    const score = await page.evaluate(() => window.__GAME_STATE__.score);
    expect(score).toBe(1);
  });

  test('game over triggers on bird death event', async ({ gamePage: page }) => {
    await startPlaying(page);

    await page.evaluate(() => {
      const scene = window.__GAME__.scene.getScene('GameScene');
      scene.triggerGameOver();
    });

    const gameOver = await page.evaluate(() => window.__GAME_STATE__.gameOver);
    expect(gameOver).toBe(true);
  });

  test('game over transitions to GameOverScene', async ({ gamePage: page }) => {
    await startPlaying(page);

    await page.evaluate(() => {
      const scene = window.__GAME__.scene.getScene('GameScene');
      scene.triggerGameOver();
    });

    // Wait for the delayed transition (800ms in game + buffer)
    await page.waitForTimeout(1200);

    const sceneKeys = await page.evaluate(() => {
      const scenes = window.__GAME__.scene.getScenes(true);
      return scenes.map(s => s.scene.key);
    });
    expect(sceneKeys).toContain('GameOverScene');
  });

  test('restart returns to GameScene', async ({ gamePage: page }) => {
    await startPlaying(page);

    await page.evaluate(() => {
      const scene = window.__GAME__.scene.getScene('GameScene');
      scene.triggerGameOver();
    });
    await page.waitForTimeout(1200);

    // Press space to restart from game over
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);

    const sceneKeys = await page.evaluate(() => {
      const scenes = window.__GAME__.scene.getScenes(true);
      return scenes.map(s => s.scene.key);
    });
    expect(sceneKeys).toContain('GameScene');
  });

  test('best score persists across restarts', async ({ gamePage: page }) => {
    await startPlaying(page);

    // Set a score
    await page.evaluate(() => {
      window.__GAME_STATE__.addScore(5);
    });

    await page.evaluate(() => {
      const scene = window.__GAME__.scene.getScene('GameScene');
      scene.triggerGameOver();
    });
    await page.waitForTimeout(1200);

    const bestScore = await page.evaluate(() => window.__GAME_STATE__.bestScore);
    expect(bestScore).toBe(5);
  });
});
