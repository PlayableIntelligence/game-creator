// Settings for scripts/browser-test.mjs (node --test with the Chrome on this machine), in Playwright's config shape.
// Not used by it: retries, fullyParallel, forbidOnly, workers, reporter, trace and video.
export default {
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 3000,
      threshold: 0.3,
    },
  },

  projects: [
    { name: 'chromium', use: { viewport: { width: 1280, height: 720 } } },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
};
