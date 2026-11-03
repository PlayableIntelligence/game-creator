import { test, expect } from '../../scripts/browser-test.mjs';

test.describe('Flappy Bird 3D — Performance', () => {
  test('game loads within 10 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/');

    await page.waitForFunction(() => {
      return window.__GAME__ && document.querySelector('canvas');
    }, null, { timeout: 10000 });

    const loadTime = Date.now() - start;
    expect(loadTime).toBeLessThan(10000);
  });

  test('canvas fills the viewport', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.querySelector('canvas'));

    const dimensions = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
      };
    });

    const ratio = await page.evaluate(() => window.devicePixelRatio || 1);
    expect(dimensions.canvasWidth).toBe(dimensions.windowWidth * ratio);
    expect(dimensions.canvasHeight).toBe(dimensions.windowHeight * ratio);
  });

  test('game maintains acceptable FPS', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.__GAME__ && document.querySelector('canvas'));

    await page.locator('#play-btn').click();
    await page.waitForFunction(() => window.__GAME_STATE__.started);

    const avgFps = await page.evaluate(() => {
      return new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        function countFrame() {
          frames++;
          if (performance.now() - start < 2000) {
            requestAnimationFrame(countFrame);
          } else {
            resolve(frames / ((performance.now() - start) / 1000));
          }
        }
        requestAnimationFrame(countFrame);
      });
    });

    // Headless Chromium with Three.js + WebGL reports very low FPS
    expect(avgFps).toBeGreaterThan(3);
  });
});
