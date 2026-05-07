# Build phase

Run the sequenced task list from concept against the scaffolded game. Each task is a one-pass subagent (or a hand-off to another skill) followed by verification. Tasks are conditional on the pipeline-wide flags set during concept; skipped tasks are skipped silently.

## When to use

After the scaffold phase passes its boundary. Runs once per `/viral-game` invocation. This phase is the bulk of the pipeline — concept and scaffold prepare it, ship closes it out.

## Inputs

- `docs/STATE.md` — `hasPublicFigures`, `publicFigureSlugs`, `MONETIZATION_INTENT`, engine, project path.
- `docs/gameplan.md` — game concept, art style, stack.
- The scaffolded game running on a dev server.
- `output/autofix-history.json` — accumulating fix history across the phase.

## Build-phase task sequence

| # | Task | Condition | Driver |
|---|---|---|---|
| 1.25 | Scaffold gateables | `MONETIZATION_INTENT != 'none'` | `/scaffold-gateables` skill |
| 1.5 | Add assets (pixel art / GLB + optional World Labs) | always | `game-assets` skill (2D) / `game-3d-assets` + `meshyai` (3D) |
| 1.6 | Public-figure pass | `hasPublicFigures = true` | `/meme-game` skill |
| 2 | Visual polish | always | `game-designer` skill |
| 2.5 | Promo video (50 FPS portrait capture) | always | `promo-video` skill |
| 3 | Audio (BGM + SFX, Web Audio API) | always | `game-audio` skill |
| 3.5 | QA test suite (Playwright) | always | `qa-game` skill |

The full subagent prompt for each task lives in [`../sub-pipelines/step-details.md`](../sub-pipelines/step-details.md) under the matching "Step 1.25" / "Step 1.5" / etc. heading. Phase docs do not duplicate the prompts — they orchestrate the sequence.

## Steps

**For each task in order**, do this loop. Skip the task entirely if its condition is false; do not mark a skipped task as completed (just remove it from the visible list).

**a. Mark the task `in_progress` via `TaskUpdate`.**

**b. Read `docs/STATE.md`** to confirm pipeline-wide variables haven't drifted (the user may have edited the gameplan between phases).

**c. Launch the task.**

For tasks driven by a subagent prompt: use `Task` with the prompt from `step-details.md`. The subagent inherits: project path, engine, dev server port, game concept, and any task-specific flags (palette tag for assets, `publicFigureSlugs` for the public-figure pass, etc.).

For tasks driven by another skill (`/scaffold-gateables`, `/meme-game`): invoke the skill with the explicit arguments rather than re-implementing its logic. The skill runs its own internal verification — when it returns, treat its return value as authoritative and do not re-run verification at the build-phase level.

**d. Run verification** ([`../sub-pipelines/verification.md`](../sub-pipelines/verification.md)) for tasks driven by a subagent. Skip for tasks driven by another skill (they verify themselves). Step 3.5 (QA test suite) runs `npm test` instead of the standard verification — it's verifying its own output.

**e. Update `docs/STATE.md`** with one-line task progress:

```
Last action: <task name> complete. <one short summary>.
Current task: <next task in sequence>.
Next step: <one sentence>.
```

Also append a `## Step <n>: <Task>` section to `progress.md` for back-compat. The exact structure for each task is in `step-details.md`.

**f. Mark the task `completed`** via `TaskUpdate`.

## Pause discipline

**Do not pause between tasks within this phase.** The whole point of the make-game 2.0 refactor is that build-phase tasks run continuously — pause **at the phase boundary** (between build and ship), not at every sub-step. Exception: if a task fails verification three times in a row and the autofix loop gives up, surface the failure to the user and ask whether to skip or abort — that's the only inside-phase user-stop.

If the user interrupts mid-phase, the next session should pick up from `docs/STATE.md`'s "Current task" line. Don't restart the phase from scratch.

## Order rationale (don't reorder these)

- **Gateables before assets** — gateables add `isEntitled()` seams to existing entities. Touching gateables after assets means every gated entity got pixel art that may need rework.
- **Assets before public-figure pass** — Step 1.5 is mandatory and produces art for every entity. Step 1.6 only overlays photo-composite heads onto public-figure-named entities. Reverse order means non-public-figure entities have no art (they get covered by /meme-game's narrow scope, which only touches the slug list).
- **Public-figure pass before design** — design-game audits expression usage. If the public-figure pass hasn't run, design-game has nothing to audit.
- **Design before promo** — promo records the polished game.
- **Promo before audio** — promo is silent; audio is added after.
- **Audio before QA** — QA's visual snapshot tests need to capture the final state.

## Outputs

- A fully built game with assets, optional public-figure overlay, design polish, promo video, audio, and tests.
- `output/promo.mp4` — 50 FPS mobile-portrait gameplay capture.
- `tests/` — Playwright suite covering gameplay, visual, perf.
- `progress.md` and `docs/STATE.md` reflecting every completed task.
- `output/autofix-history.json` with the cumulative fix history (review later if you're hitting recurring failures).

## Exit criteria

- Every applicable task completed and marked as such.
- All verifications green (or autofixed on retry).
- `npm run build` and `npm test` both pass.
- The dev server still serves a playable, polished game with audio.
- `docs/STATE.md` ends with `Phase: build → ship`.

## Pause point

Pause for user confirmation **at the phase boundary** between build and ship. Show: dev URL, promo video path, test results, what got polished. Wait for "go" before deploy.
