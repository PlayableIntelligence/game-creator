import { test as base } from '../../scripts/browser-test.mjs';

export const test = base.extend({
  gamePage: async ({ page }, use) => {
    await page.goto('/');
    // Wait for Phaser to boot and canvas to exist
    await page.waitForFunction(() => {
      return window.__GAME__ && window.__GAME__.isBooted && window.__GAME__.canvas;
    }, { timeout: 10000 });
    // Small delay for first scene render
    await page.waitForTimeout(500);
    await use(page);
  },
});

export async function startPlaying(page) {
  // First tap: dismiss GET READY and start playing (also inits audio)
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
}
