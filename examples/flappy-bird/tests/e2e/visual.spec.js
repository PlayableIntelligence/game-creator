import { expect } from '../../scripts/browser-test.mjs';
import { test, startPlaying } from '../fixtures/game-test.js';

test.describe('Flappy Bird — Visual Regression', () => {
  test('initial gameplay screenshot', async ({ gamePage: page }) => {
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('initial-gameplay.png', {
      maxDiffPixels: 3000,
    });
  });

  test('game over scene screenshot', async ({ gamePage: page }) => {
    await startPlaying(page);

    // Trigger game over
    await page.evaluate(() => {
      window.__GAME_STATE__.addScore(3);
      const scene = window.__GAME__.scene.getScene('GameScene');
      scene.triggerGameOver();
    });
    await page.waitForTimeout(1500);

    await expect(page).toHaveScreenshot('game-over-scene.png', {
      maxDiffPixels: 3000,
    });
  });
});
