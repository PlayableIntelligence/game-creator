// scripts/verify-runtime.mjs
// Launches headless Chromium, loads the game, checks for runtime errors.
// Exit 0 = pass, Exit 1 = fail (prints errors to stderr).
import { chromium } from './cdp.mjs';

const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}`;
const WAIT_MS = 3000;

async function verify() {
  const errors = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('pageerror', (err) => errors.push(`PAGE ERROR: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(`CONSOLE ERROR: ${msg.text()}`);
    }
  });

  try {
    const response = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
    if (!response || response.status() >= 400) {
      errors.push(`HTTP ${response?.status() || 'NO_RESPONSE'} loading ${URL}`);
    }
  } catch (e) {
    errors.push(`NAVIGATION ERROR: ${e.message}`);
  }

  // Wait for game to initialize and render
  await page.waitForTimeout(WAIT_MS);

  await browser.close();

  if (errors.length > 0) {
    console.error(`Runtime verification FAILED with ${errors.length} error(s):\n`);
    errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
    process.exit(1);
  }

  console.log('Runtime verification PASSED — no errors detected.');
  process.exit(0);
}

verify();
