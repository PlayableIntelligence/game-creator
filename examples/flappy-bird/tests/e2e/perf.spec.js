import { expect } from '../../scripts/browser-test.mjs';
import { test, startPlaying } from '../fixtures/game-test.js';

test.describe('Flappy Bird — Performance', () => {
  test('game loads within 5 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/');
    await page.waitForFunction(() => {
      return window.__GAME__ && window.__GAME__.isBooted && window.__GAME__.canvas;
    }, { timeout: 5000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  test('canvas has correct aspect ratio', async ({ gamePage: page }) => {
    const size = await page.evaluate(() => ({
      width: window.__GAME__.canvas.width,
      height: window.__GAME__.canvas.height,
    }));
    // Canvas should maintain the 400:600 = 2:3 aspect ratio
    const aspect = size.width / size.height;
    const expectedAspect = 400 / 600;
    expect(Math.abs(aspect - expectedAspect)).toBeLessThan(0.02);
    // Canvas should be at least the design dimensions
    expect(size.width).toBeGreaterThanOrEqual(400);
    expect(size.height).toBeGreaterThanOrEqual(600);
  });

  test('maintains minimum FPS', async ({ gamePage: page }) => {
    await startPlaying(page);

    const fps = await page.evaluate(() => {
      return new Promise(resolve => {
        let frames = 0;
        const start = performance.now();
        function count() {
          frames++;
          if (performance.now() - start >= 1000) {
            resolve(frames);
          } else {
            requestAnimationFrame(count);
          }
        }
        requestAnimationFrame(count);
      });
    });

    // Headless Chromium reports low FPS (~7-9), threshold set to 5
    expect(fps).toBeGreaterThanOrEqual(5);
  });
});
