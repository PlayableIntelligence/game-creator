# Live iterate

The canonical post-edit verification loop during the development phase. Run after every meaningful code change so changes are validated before handing the keyboard back to the user. This is the primary mechanism for tight, real-time feedback between agent and player.

## When to use

- A code change has just been made during the development phase
- A milestone implementation step has been completed
- A bug fix has been applied (use this *and* the repro from [bug-fix.md](bug-fix.md))
- The user has asked "did that work?" or "can you check?"

Do not skip this loop. A change is not "done" until it has been iterated on. If the dev server is not running, start it first.

## Inputs

- A running dev server (e.g. `npm run dev`) reachable at a known URL
- Project exposes `window.render_game_to_text()` and `window.advanceTime(ms)` per the parent project's architecture rules. If they are missing, add them as part of the change before continuing — they are mandatory for this loop.
- The change just made (file paths + intent)
- The most relevant acceptance criterion or bug repro from the milestone or bug report

## Steps

1. **Confirm the dev server is live.** If it isn't, start it (`npm run dev` or equivalent for the engine) and wait for the ready signal. Do not assume HMR caught the change — for non-HMR setups (production build, some frameworks), force a reload.

2. **Check console errors first.** Open the page (or use the existing Playwright session) and read the browser console. Any uncaught error means stop and triage — do not move forward to behavior checks while errors are present.

3. **Read the game state without pixels.** Call `window.render_game_to_text()` and inspect the returned JSON. This is faster, cheaper, and more reliable than screenshots for verifying state-shape changes (mode, score, entity counts, player position). Quote the relevant fields back to yourself.

4. **Step time deterministically when needed.** For changes that depend on time-based behavior (physics, animations, timers, AI), use `window.advanceTime(ms)` to step the simulation in known increments. Re-read `render_game_to_text()` after each step. For Playwright-driven verification, prefer `page.clock.install()` + `runFor()` for frame-precise control.

5. **Drive input via the iterate client (optional but recommended for input-driven changes).** Run `node scripts/iterate-client.js --url <dev-url> --actions-json '<actions>'` from the repo root to play scripted input, capture screenshots, dump state, and surface console errors in one pass. See `scripts/example-actions.json` for the action shape.

6. **Take a screenshot if the change is visual.** Save it under `output/iterate/<YYYY-MM-DD>-<short-tag>.png` (or the project's existing screenshot location). Compare to a prior screenshot if one exists for the same scene.

7. **Regression-check adjacent state.** For every system that shares state with the changed code, run a one-action smoke test: does the score still increment? Do collisions still fire? Does restart still reset cleanly? This catches the "while I'm here" class of regression early.

8. **Decide the verdict.** One of three outcomes:
   - **Verified** — change matches the AC, no regressions, no console errors. Move on.
   - **Off-target** — change runs but doesn't match the AC. Diagnose, edit, re-loop. Do not declare done.
   - **Broken** — console errors or crashes. Stop, triage, fix. Do not paper over with try/catch.

9. **Hand back to the user with a focused question.** Don't dump the whole state object — give a one-line verdict, link the screenshot if visual, and ask one specific question. Examples:
   - "Jump apex now peaks at 0.38s (target was ≤0.4s). Try it — does the landing feel right, or still floaty?"
   - "Score increments correctly but the HUD doesn't redraw until the next frame. Want me to fix the redraw, or is the one-frame delay acceptable?"
   Use the `AskUserQuestion` tool when the answer is multiple choice.

## Outputs

- A console-clean game running at the dev URL
- A `render_game_to_text()` snapshot (in chat or saved alongside the screenshot)
- (If visual) A screenshot saved to `output/iterate/`
- A one-line verdict and a single targeted question for the user

## Exit criteria

- Console is error-free
- `render_game_to_text()` reflects the expected state for the change
- The relevant AC or bug repro is satisfied (or explicitly deferred with the user's agreement)
- The user has been handed a clear, narrow question — not a wall of state
