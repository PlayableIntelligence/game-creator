# Visual Inspection -- Screenshot-and-Read Visual QA

In addition to automated tests, do interactive visual inspection: drive the game with `scripts/iterate-client.js` (or a short `scripts/cdp.mjs` script), which writes PNG screenshots, then look at them with the **Read** tool. This gives your agent real visual evaluation with no browser MCP server and no npm dependency.

## Setup

Copy the helpers from the plugin into the game's `scripts/` (they need Node 22+ or Bun and Google Chrome; set `BOOP_CHROME=/path/to/chrome` to use another Chrome/Chromium):

```bash
cp <plugin-root>/scripts/cdp.mjs <plugin-root>/scripts/iterate-client.js scripts/
```

Do not install a browser MCP server for this. To verify it's working, run `node scripts/iterate-client.js --url http://localhost:3000 --iterations 1` and check that `output/iterate/shot-0.png` exists.

## When to Use Visual Inspection vs Automated Tests

| Task | Use |
|------|-----|
| "Does this look right?" | **Visual inspection** -- take a screenshot, analyze visually |
| "Did this change break boot flow?" | **Automated test** -- assert scene transitions |
| "Are the colors cohesive?" | **Visual inspection** -- screenshot + visual judgment |
| "Does scoring still work?" | **Automated test** -- assert gameState.score |
| "How does the death animation feel?" | **Visual inspection** -- screenshot a sequence with `--iterations` and a short `--pause-ms` |
| "Regression after refactor" | **Automated test** -- run full suite |
| "Check FPS on real browser" | **Visual inspection** -- `--headless 0` runs headed Chrome for more accurate FPS |
| "CI/CD gate" | **Automated test** -- headless, pass/fail |
| "Evaluate visual polish" | **Visual inspection** -- designer uses screenshots to judge atmosphere |
| "Active gameplay screenshot" | **Visual inspection** -- animated scenes are unstable for automated screenshots |
| "Check Play.fun widget overlay" | **Visual inspection** -- inspect iframe computed styles with `page.evaluate` |

## Visual Inspection Flow

When doing visual QA:

1. **Run the iterate client** against the game URL (e.g., `node scripts/iterate-client.js --url http://localhost:3000 --iterations 3 --pause-ms 2000`) -- the pause gives the game time to fully render
2. **Read** `output/iterate/shot-0.png` -- gameplay (game starts immediately, no title screen); `state-0.json` has `render_game_to_text()`
3. **Read** `output/iterate/errors-0.json` if it exists -- console errors
4. **Assess visually**: Check rendering, entity sizing, background, atmosphere
5. **Check safe zone**: Verify no UI elements are hidden behind the top ~8% of the screen (Play.fun widget area at 75px). If deployed, inspect the widget directly with a short cdp.mjs script:
   ```js
   // node inspect-widget.mjs -- inspect Play.fun widget iframe
   import { chromium } from './scripts/cdp.mjs';
   const browser = await chromium.launch({ headless: true });
   const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
   await page.goto(process.argv[2] ?? 'http://localhost:3000');
   console.log(await page.evaluate(() => {
     const iframe = document.querySelector('iframe[src*="widget.play.fun"]');
     if (!iframe) return 'No Play.fun widget found';
     const styles = window.getComputedStyle(iframe);
     return { position: styles.position, top: styles.top, height: styles.height, zIndex: styles.zIndex };
   }));
   await page.screenshot({ path: 'output/widget.png' });
   await browser.close();
   ```
6. **Check buttons**: If game over is visible, verify button labels (text) are readable -- not blank rectangles
7. Let the player die (more `--iterations`, or `--actions-json` with no input), **Read** the later shots -- check game-over screen polish and score display
8. **Restart** with `--restart-cycles 1 --restart-key Space` and Read the shots to verify transitions
9. Report findings with specific visual observations

## Visual Inspection + Automated: Best of Both

The recommended workflow is:

1. **Write automated tests** for all objective checks (boot, scenes, input, scoring, game over, regression, gameplay invariants)
2. **Use visual inspection** for subjective visual evaluation (does it look good? feel right? color palette working? safe zone respected? entity sizes appropriate?)
3. Run automated tests in CI; run visual inspections during design passes
