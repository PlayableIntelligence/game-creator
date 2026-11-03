# Gameplay Invariants

Every game built through the pipeline **must** pass these minimum gameplay checks. These verify the game is actually playable, not just renders without errors.

## 1. Scoring works

The player must be able to earn at least 1 point through normal gameplay actions:

```js
test('player can score at least 1 point', async ({ gamePage }) => {
  // Start the game (space/tap)
  await gamePage.keyboard.press('Space');
  await gamePage.waitForFunction(() => window.__GAME_STATE__.started, null, { timeout: 5000 });

  // Perform gameplay actions — keep the player alive
  const actionInterval = setInterval(async () => {
    await gamePage.keyboard.press('Space').catch(() => {});
  }, 400);

  // Wait for score > 0
  await gamePage.waitForFunction(
    () => window.__GAME_STATE__.score > 0,
    null,
    { timeout: 20000 }
  );
  clearInterval(actionInterval);

  const score = await gamePage.evaluate(() => window.__GAME_STATE__.score);
  expect(score).toBeGreaterThan(0);
});
```

## 2. Death/fail condition triggers

The player must be able to die or lose through inaction or collision:

```js
test('game over triggers through normal gameplay', async ({ gamePage }) => {
  // Start the game
  await gamePage.keyboard.press('Space');
  await gamePage.waitForFunction(() => window.__GAME_STATE__.started, null, { timeout: 5000 });

  // Do nothing — let the fail condition trigger naturally (fall, timer, collision)
  await gamePage.waitForFunction(
    () => window.__GAME_STATE__.gameOver === true,
    null,
    { timeout: 15000 }
  );

  const isOver = await gamePage.evaluate(() => window.__GAME_STATE__.gameOver);
  expect(isOver).toBe(true);
});
```

## 3. Game-over buttons have visible text

After game over, restart/play-again buttons must show their text labels:

```js
test('game over buttons display text labels', async ({ gamePage }) => {
  // Trigger game over
  await gamePage.keyboard.press('Space');
  await gamePage.waitForFunction(() => window.__GAME_STATE__.started, null, { timeout: 5000 });
  await gamePage.waitForFunction(() => window.__GAME_STATE__.gameOver, null, { timeout: 15000 });

  // Wait for GameOverScene to render
  await gamePage.waitForFunction(() => {
    const scenes = window.__GAME__.scene.getScenes(true);
    return scenes.some(s => s.scene.key === 'GameOverScene');
  }, null, { timeout: 5000 });
  await gamePage.waitForTimeout(500);

  // Check that text objects exist and are visible in the scene
  const hasVisibleText = await gamePage.evaluate(() => {
    const scene = window.__GAME__.scene.getScene('GameOverScene');
    if (!scene) return false;
    const textObjects = scene.children.list.filter(
      child => child.type === 'Text' && child.visible && child.alpha > 0
    );
    // Should have at least: title ("GAME OVER"), score, and button label ("PLAY AGAIN")
    return textObjects.length >= 3;
  });
  expect(hasVisibleText).toBe(true);
});
```

## 4. `render_game_to_text()` returns valid state

The AI-readable state function must return parseable JSON with required fields:

```js
test('render_game_to_text returns valid game state', async ({ gamePage }) => {
  const stateStr = await gamePage.evaluate(() => window.render_game_to_text());
  const state = JSON.parse(stateStr);

  expect(state).toHaveProperty('mode');
  expect(state).toHaveProperty('score');
  expect(['playing', 'game_over']).toContain(state.mode);
  expect(typeof state.score).toBe('number');
});
```

## 5. Design Intent

Tests that catch mechanics which technically exist but are too weak to affect gameplay. These use values from `Constants.js` to set meaningful thresholds instead of trivial `> 0` checks.

**Detecting win/lose state**: Read `GameState.js` for `won`, `result`, or similar boolean/enum fields. Check `render_game_to_text()` in `main.js` for distinct outcome modes (`'win'` vs `'game_over'`). If either exists, the game has a lose state — write lose-condition tests.

**Using design-brief.md**: If `design-brief.md` exists in the project root, read it for expected magnitudes, rates, and win/lose reachability. Use these values to set test thresholds instead of deriving from Constants.js alone.

**Non-negotiable assertion**: The no-input lose test must assert the losing outcome. Never write a passing test for a no-input win — if the player wins by doing nothing, that is a bug, and the test exists to catch it.

**Lose condition** — verify the player can actually lose:

```js
test('player loses when providing no input', async ({ gamePage }) => {
  await gamePage.keyboard.press('Space');
  await gamePage.waitForFunction(() => window.__GAME_STATE__.started);

  await gamePage.waitForFunction(
    () => window.__GAME_STATE__.gameOver,
    null,
    { timeout: 45000 }
  );

  const result = await gamePage.evaluate(() => window.__GAME_STATE__.result);
  expect(result).toBe('lose');
});
```

**Opponent/AI pressure** — verify AI mechanics produce substantial state changes:

```js
test('opponent reaches 25% within half the round duration', async ({ gamePage }) => {
  await gamePage.keyboard.press('Space');
  await gamePage.waitForFunction(() => window.__GAME_STATE__.started);

  const { halfDuration, maxValue } = await gamePage.evaluate(() => {
    return {
      halfDuration: window.Constants?.ROUND_DURATION_MS / 2 || 15000,
      maxValue: window.Constants?.MAX_VALUATION || 100,
    };
  });

  await gamePage.waitForTimeout(halfDuration);

  const opponentValue = await gamePage.evaluate(() => {
    return window.__GAME_STATE__.opponentScore;
  });

  expect(opponentValue).toBeGreaterThanOrEqual(maxValue * 0.25);
});
```

**Win condition** — verify active input leads to a win:

```js
test('player wins with active input', async ({ gamePage }) => {
  await gamePage.keyboard.press('Space');
  await gamePage.waitForFunction(() => window.__GAME_STATE__.started);

  const inputInterval = setInterval(async () => {
    await gamePage.keyboard.press('Space').catch(() => {});
  }, 100);

  await gamePage.waitForFunction(
    () => window.__GAME_STATE__.gameOver,
    null,
    { timeout: 45000 }
  );

  clearInterval(inputInterval);

  const result = await gamePage.evaluate(() => window.__GAME_STATE__.result);
  expect(result).toBe('win');
});
```

Adapt field names (`result`, `opponentScore`, constant names) to match the specific game's GameState and Constants. The patterns above are templates — read the actual game code to determine the correct fields and thresholds.

## 6. Entity Interaction Audit

Audit collision and interaction logic for asymmetries. A first-time player
expects consistent rules: if visible objects interact with some entities, they
expect them to interact with all relevant entities.

**What to check**: Read all collision handlers in GameScene.js. Map
entity->entity interactions. Flag any visible moving entity that interacts with
one side but not the other.

**Using design-brief.md**: If an "Entity Interactions" section exists, verify
each documented interaction matches the code. Flag any entity documented as
"no player interaction" that isn't clearly background/decoration.

**Output**: Add `// QA FLAG: asymmetric interaction` comments in game.spec.js
for any flagged entity. This is informational — the flag surfaces the issue
for human review, it doesn't fail the test suite.

## 7. Mute Button Exists and Toggles

Every game with audio must have a mute toggle. Test that `isMuted` exists on GameState and responds to the M key shortcut:

```js
test('mute button exists and toggles audio state', async ({ gamePage }) => {
  await gamePage.keyboard.press('Space');
  await gamePage.waitForFunction(() => window.__GAME_STATE__.started, null, { timeout: 5000 });

  const hasMuteState = await gamePage.evaluate(() => {
    return typeof window.__GAME_STATE__.isMuted === 'boolean';
  });
  expect(hasMuteState).toBe(true);

  const before = await gamePage.evaluate(() => window.__GAME_STATE__.isMuted);
  await gamePage.keyboard.press('m');
  await gamePage.waitForTimeout(100);
  const after = await gamePage.evaluate(() => window.__GAME_STATE__.isMuted);
  expect(after).toBe(!before);

  await gamePage.keyboard.press('m');
  await gamePage.waitForTimeout(100);
  const restored = await gamePage.evaluate(() => window.__GAME_STATE__.isMuted);
  expect(restored).toBe(before);
});
```

The M key is a testable proxy for the mute button — if the event wiring exists, the visual button does too. Browser tests cannot inspect Phaser Graphics objects directly.
