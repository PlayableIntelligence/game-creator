# Mobile Input & Responsive Layout Tests

Use the `mobile-chrome` project (Pixel 5 emulation) to test touch input and responsive layout.

## Mobile Test Patterns

```js
test('game canvas fills mobile viewport', async ({ gamePage }) => {
  const { width, height } = await gamePage.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  });
  const viewport = gamePage.viewportSize();
  expect(width).toBeGreaterThanOrEqual(viewport.width * 0.9);
  expect(height).toBeGreaterThanOrEqual(viewport.height * 0.9);
});

test('virtual joystick appears on touch device', async ({ gamePage }) => {
  // Start the game
  await gamePage.tap('#play-btn');
  await gamePage.waitForTimeout(1000);
  // Joystick should be visible (if gyro is unavailable in emulation)
  const joystick = await gamePage.$('#virtual-joystick');
  // On emulated devices without gyro, joystick should appear
  if (joystick) {
    const visible = await joystick.isVisible();
    expect(visible).toBe(true);
  }
});

test('touch tap registers as input', async ({ gamePage }) => {
  await gamePage.tap('#play-btn');
  await gamePage.waitForFunction(() => window.__GAME_STATE__?.started);
  // Tap on the canvas
  const canvas = gamePage.locator('canvas');
  await canvas.tap();
  // Game should still be running (no crash from touch input)
  const running = await gamePage.evaluate(() => window.__GAME_STATE__?.started);
  expect(running).toBe(true);
});
```

## Notes

- The `mobile-chrome` project in `browser.config.mjs` emulates a Pixel 5 (393x851 viewport, `isMobile`, `hasTouch`)
- Touch events are simulated via the `.tap()` method (`page.tap(selector)` / `locator.tap()`, CDP touch events)
- Virtual joystick testing requires checking if the DOM element exists (games without joystick will skip)
- Canvas tap tests verify the game doesn't crash on touch input, not specific gameplay behavior
