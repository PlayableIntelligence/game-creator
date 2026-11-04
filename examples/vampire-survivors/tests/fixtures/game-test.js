import { test as base, expect } from '../../scripts/browser-test.mjs';

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.goto('/');
    // Wait for Phaser to boot and canvas to render
    await page.waitForFunction(() => {
      return window.__GAME__ && window.__GAME__.scene?.scenes?.length > 0;
    }, { timeout: 15000 });
    // Small extra wait for scene rendering
    await page.waitForTimeout(500);
    await use(page);
  },
});

export async function startPlaying(page) {
  // Game boots directly into gameplay — just wait for scene to be ready
  await page.waitForTimeout(500);
}

export { expect };
