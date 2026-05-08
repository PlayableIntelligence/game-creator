# Troubleshooting

Common issues and fixes for the game-creator plugin.

## Skill Triggering Issues

### Skill doesn't trigger

**Symptom**: You say "make a game" but the skill doesn't load.

**Fixes**:
1. Check the skill is installed: `npx skills list` should show `game-creator`
2. Use the explicit slash command: `/game-creator:make-game` (milestone-driven workflow) or `/game-creator:quick-game 2d my-game` (rapid prototype)
3. If using a non-Claude agent, ensure the agent supports skill loading (check `npx skills add` docs for your agent)
4. Try rephrasing with exact trigger phrases from the skill description (e.g., "build me a game", "create a new game")

### Skill triggers on unrelated query

**Symptom**: Asking about game theory or board games loads a game-creator skill.

**Fixes**:
1. Be specific: "Explain game theory in economics" vs "make a game"
2. If a skill loads incorrectly, tell the agent: "I don't want the game-creator skill, I'm asking about X"
3. Each skill's description includes "Do NOT use for..." clauses — if these are insufficient, open an issue

### Wrong skill triggers

**Symptom**: You want to add audio but `/add-feature` loads instead.

**Reference — which skill to use**:
| Want to... | Use this | Not this |
|------------|----------|----------|
| Build from scratch (milestone-driven, multi-session) | `/make-game` | `/add-feature` |
| Build a quick prototype (no doc rigor) | `/quick-game` | `/add-feature` |
| Add pixel art | `/add-assets` | `/add-feature` |
| Add 3D models | `/add-3d-assets` | `/add-feature` |
| Add music/SFX | `/add-audio` | `/add-feature` |
| Visual polish | `/design-game` | `/improve-game` |
| Add gameplay mechanic | `/add-feature` | `/improve-game` |
| Full audit + fixes | `/improve-game` | `/review-game` (review only) |
| Code review only | `/review-game` | `/improve-game` (also implements) |
| Write tests | `/qa-game` | `/review-game` |
| Deploy | `/monetize-game` (includes deploy) | — |

## Build Failures

### `npm run build` fails with module not found

**Cause**: Missing import or circular dependency.

**Fix**: Check that all imports use relative paths (`./core/EventBus.js`, not `core/EventBus`). Vite requires file extensions in ES module imports.

### `npm run dev` port already in use

**Cause**: Another dev server is running on port 3000.

**Fix**: Kill the existing process (`lsof -ti:3000 | xargs kill`) or use a different port (`npm run dev -- --port 3001`).

### Vite build outputs empty `dist/`

**Cause**: `index.html` is not in the project root, or `vite.config.js` has a wrong `root` setting.

**Fix**: Ensure `index.html` is at the project root (not inside `src/`). Check `vite.config.js` doesn't override `root`.

## Playwright / QA Issues

### Tests fail with "browser not found"

**Fix**: Run `npx playwright install chromium`. The scaffold step in `/make-game` attempts this automatically but it can fail in restricted environments.

### FPS test fails (reports ~7 FPS)

**Expected**: Headless Chromium runs at reduced FPS (~7-9). The default threshold is 5 FPS. This is not a bug — real browsers achieve 60 FPS.

**Fix**: Don't raise the FPS threshold above 5 for headless tests. Use Playwright MCP (real browser) for accurate FPS measurement.

### Visual regression tests fail with pixel differences

**Expected**: Parallax clouds and animated elements shift between captures. The default tolerance is 3000 maxDiffPixels.

**Fix**: Increase `maxDiffPixels` if your game has more animation, or use `page.clock.install()` to freeze time before screenshots.

### `render_game_to_text()` returns undefined

**Cause**: The function isn't exposed on `window`, or the game hasn't booted yet.

**Fix**: Ensure `main.js` sets `window.render_game_to_text = () => { ... }` and the test fixture waits for the game to initialize (check `game-test.js` fixture for the pattern).

## Deployment Issues

### here.now deploy fails

**Causes**:
1. No internet connection
2. `dist/` doesn't exist (run `npm run build` first)
3. The `here-now` skill isn't installed

**Fix**: Run `npx skills add heredotnow/skill --skill here-now -g` to install the deployment skill. Then `npm run build && npx here-now dist/`.

### Anonymous deploy expires after 24 hours

**Expected**: Anonymous here.now deploys are temporary. The deploy output includes a "claim URL" — visit it to make the deploy permanent.

### GitHub Pages deploy shows blank page

**Cause**: Vite's `base` path doesn't match the GitHub Pages URL.

**Fix**: Set `base: '/<repo-name>/'` in `vite.config.js` (or `base: '/'` if using a custom domain).

## Play.fun / Monetization Issues

### Authentication fails

**Fix**:
1. Visit https://play.fun/dashboard
2. Refresh your Creator Credentials
3. Paste the API Key and Secret Key when prompted
4. If using MCP, update the `x-api-key` and `x-secret-key` headers in your MCP client configuration

### SDK doesn't load (points not tracking)

**Cause**: The CDN script failed to load (network issue or ad blocker).

**Expected**: The SDK is non-blocking. Games work without it. Points buffer locally and sync when the SDK becomes available.

**Fix**: Check browser console for SDK errors. Ensure `https://sdk.play.fun/latest` is not blocked. The `src/playfun.js` wrapper handles SDK absence gracefully.

### Anti-cheat rejects valid scores

**Cause**: `maxScorePerSession` is set too low for your game's scoring system.

**Fix**: Update the anti-cheat limits when registering the game. The limits in `playfun.js` should match realistic gameplay maximums — check the `ANTI_CHEAT` object in Constants.js.

## 3D Asset Issues

### GLB model loads in T-pose (no animation)

**Cause**: Used `.clone(true)` instead of `SkeletonUtils.clone()`.

**Fix**: Always use `SkeletonUtils.clone(model)` from `three/examples/jsm/utils/SkeletonUtils.js` for animated models. Regular clone breaks skeleton bindings.

### Model faces wrong direction

**Cause**: Different models have different default facing directions.

**Fix**: Store a `facingOffset` per character model. Soldier/Xbot face -Z (need `+Math.PI`), Robot/Fox face +Z (need `+0`). Apply the offset to the model's rotation.

### Meshy AI generation times out

**Expected**: Meshy text-to-3D takes 2-5 minutes. Image-to-3D can take longer.

**Fix**: The `meshy-generate.mjs` script polls automatically. If it times out, check your `MESHY_API_KEY` is valid and you haven't hit the API rate limit.

## Audio Issues

### No sound plays

**Cause**: Browser autoplay policy blocks AudioContext before user interaction.

**Fix**: Audio must initialize on first user interaction (click/tap/keypress). The `AudioManager.js` pattern listens for the `AUDIO_INIT` event, which fires on first game input. Don't try to play audio before this event.

### Music sounds wrong / out of tune

**Cause**: Web Audio API oscillator frequencies are in Hz, not MIDI notes.

**Fix**: Use the frequency conversion helpers in the audio skill. Check `music.js` patterns for correct note-to-frequency mapping.
