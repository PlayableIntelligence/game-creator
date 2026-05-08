# Verify phase

Run a focused verification pass on the public-figure work. The QA scope is narrow on purpose — meme-game changes only entity rendering and expression wiring, so the verification stays scoped to that.

## When to use

After [wire.md](wire.md) finishes. Final phase of every `/meme-game` invocation.

## Inputs

- The project, now with public-figure entities wired.
- A running dev server (or one we can start).
- A list of the slugs that were resolved + which tier each landed on (from resolve).

## Steps

**1. Build check.**

```bash
cd <project-dir> && npm run build
```

Build must succeed. If it fails, fix before continuing — common causes are import path typos in the new spritesheet load (2D) or missing `SkeletonUtils.js` import (3D).

**2. Runtime check.**

If the project has `scripts/verify-runtime.mjs` (some templates ship it), run it. Otherwise, boot the dev server and confirm the page returns 200 + the canvas mounts without console errors.

**3. Visual review (Playwright MCP).**

Use Playwright MCP if available; otherwise, fall back to reading the iterate screenshots from `output/iterate/` if they exist.

For each slug, confirm:
- **2D Tier 1–4**: photo head visible on cartoon body. Head is positioned correctly (not floating above the body, not buried inside it). Sprite is at the size the wire phase intended (12–15% of canvas width for the player).
- **2D Tier 5**: pixel-art caricature renders with the signature features called out in `character-resolution-2d.md` (Trump combover, Musk dark casual, etc.).
- **3D**: model loads in T-pose-free state, faces the camera or its target, scales to roughly human height in the scene, feet planted on the floor.

**4. Expression check (2D only, Tier 1–4 slugs).**

Trigger the wired events and confirm expressions change:
- Cause a score event → player goes `HAPPY` → reverts to `NORMAL` after `EXPRESSION_HOLD_MS`.
- Cause damage / death → player goes `ANGRY` → reverts.
- Cause a streak / milestone → player goes `SURPRISED` → reverts after the longer hold.

If Playwright MCP is available, drive these via simulated input. Otherwise, ask the user to play for 30 seconds and confirm.

**5. Run the existing test suite.**

```bash
cd <project-dir> && npm test
```

If a Playwright suite exists, run it. Visual snapshot tests will likely need their baselines updated — the entities now look completely different. That's expected. Update the baselines and confirm the tests pass against the new visuals; do not "fix" failing snapshots by reverting the meme work.

**6. Update STATE.md.**

Append a `## Meme Pass — Done` section to `docs/STATE.md` summarizing the run:

```
## Meme Pass — Done
- Slugs wired: trump (Tier 1), musk (Tier 2)
- Expression events: SCORE_CHANGED → HAPPY, PLAYER_DAMAGED → ANGRY, SPECTACLE_STREAK → SURPRISED (1000ms)
- Visual snapshots: updated (2 files)
- Tests passing: 15/15
- Next step: hand back to user (mention `/game-deploy` and `/monetize-game` if they want to ship)
```

Falls back to `progress.md` if `docs/STATE.md` does not exist.

## Outputs

- A clean build, runtime check, and visual confirmation.
- Updated test baselines (visual snapshots changed because the entities look different).
- An updated `docs/STATE.md` capturing what shipped.

## Exit criteria

- Build passes.
- Each slug renders correctly per its tier.
- For 2D Tier 1–4 slugs, expressions trigger on the wired events and revert after the hold timer.
- The full test suite is green (with updated visual baselines).
- `docs/STATE.md` reflects the new state so the next agent / session can pick up cleanly.
