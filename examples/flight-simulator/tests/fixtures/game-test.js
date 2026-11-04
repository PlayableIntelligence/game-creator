import { test as base, expect } from '../../scripts/browser-test.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const test = base.extend({
  gamePage: async ({ page }, use) => {
    // Inject seeded PRNG for deterministic ring/terrain placement
    await page.addInitScript({
      path: path.join(__dirname, '..', 'helpers', 'seed-random.js'),
    });

    await page.goto('/');

    // Wait for Three.js game to boot — canvas rendered and game object available
    await page.waitForFunction(() => {
      return window.__GAME__ && document.querySelector('canvas');
    }, null, { timeout: 10000 });

    await use(page);
  },
});

export { expect };
