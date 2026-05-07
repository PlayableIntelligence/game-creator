# Ship phase

Deploy the finished game to here.now, monetize per `MONETIZATION_INTENT`, run a final read-only review, and hand the user back the URLs they need to share.

## When to use

After the build phase passes its boundary. Last phase of `/viral-game`.

## Inputs

- `docs/STATE.md` — `MONETIZATION_INTENT`, project path, engine, public-figure slugs.
- `docs/gameplan.md` — used to derive the Play.fun registration metadata (name, description).
- A fully built game (passing build, runtime, visual, and tests).
- `output/promo.mp4` — for the share message at the end.

## Steps

### 1. Deploy to here.now

This task **stays in the main thread** because it may need user back-and-forth for API key setup. The full step-by-step (here-now skill check, build, base path verification, publish, anonymous-claim warning, magic-link account setup, deploy script wiring) is in [`../sub-pipelines/step-details.md`](../sub-pipelines/step-details.md) under "Step 4: Deploy to here.now".

Key reminders:
- Do **not** run `npx skills add` automatically — the here-now skill is third-party. If it's not installed, ask the user to install it themselves (`npx skills add heredotnow/skill --skill here-now -g`) and wait.
- Anonymous publishes expire in 24h. Always tell the user about the claim URL in the same message that hands them the live URL.
- Wire `npm run deploy` so future redeploys are one command.

After deploy, update `docs/STATE.md` with the live URL.

### 2. Monetize (branches on `MONETIZATION_INTENT`)

| Intent | Action |
|---|---|
| `none` | Skip monetization entirely. Pipeline goes straight to step 3 (review). |
| `playfun` | Run the full Play.fun integration (8a authenticate → 8b register → 8c add SDK → 8d redeploy → 8e tell user). Full step-by-step in `step-details.md` under "Step 5". |
| `subgames` | Skip the Play.fun flow. Tell the user to run `/subgames` separately from the `subdotgames/skills` repo. Pipeline ends after this hand-off message. |
| `both` | Run the full Play.fun flow, then add the `/subgames` external hand-off message at the end. |

This task **stays in the main thread** for the `playfun` and `both` branches because Play.fun authentication is interactive.

After monetize finishes (or is skipped), update `docs/STATE.md` with the Play.fun URL if applicable.

### 3. Final review (read-only, non-blocking)

Load the `review-game` skill and run the full analysis against the project. Read-only — no code changes, no autofix loop. Report scores + recommendations to the user.

```
**Quality Report:**
- Architecture: X/5
- Performance: X/5
- Code Quality: X/5
- Monetization Readiness: X/5

**Recommendations** (if any):
- [list any issues found]

These are suggestions for future improvement — your game is already live.
```

### 4. Final hand-back message

Build the message conditionally on `MONETIZATION_INTENT`:

- **Always include**: dev URL, here.now URL, promo video path, test command (`npm test`), redeploy command (`npm run deploy`).
- **Include the gateables bullet** only if `MONETIZATION_INTENT != 'none'`.
- **Include the Play.fun + Moltbook share bullet** only for `playfun` and `both`.
- **Include the sub.games next-step callout** only for `subgames` and `both`.
- **Always end** with the graduation hint: "If you want to keep iterating across sessions with milestones, ADRs, and `docs/STATE.md`-based handoff, run `/make-game` next time — `docs/STATE.md` and `docs/gameplan.md` are already set up for that workflow."

The full templated message is in `step-details.md` under "Step 5.5 / Pipeline Complete".

## Outputs

- A live game URL (here.now).
- A Play.fun game URL (if `playfun` or `both`).
- A quality report with 4 scores.
- An updated `docs/STATE.md` with phase=`ship → done`, all URLs captured, last action set.
- `npm run deploy` wired in `package.json` for future redeploys.

## Exit criteria

- Deploy returns 200 from the live URL.
- Play.fun registration succeeds (for `playfun` / `both`) and the SDK is wired.
- Quality report rendered to the user.
- Hand-back message sent.
- `docs/STATE.md` reflects `Phase: ship → done`.

## Graduation path

Even though `/viral-game` is one-shot, the project it leaves behind is `/make-game`-compatible:

- `docs/STATE.md` and `docs/gameplan.md` use the same schema as `/make-game`'s templates.
- `progress.md` and `design-brief.md` are kept for back-compat with skills that haven't migrated.
- The autofix history in `output/autofix-history.json` is portable.

A user who wants to keep iterating can run `/make-game` against the same directory in their next session — it will pick up `docs/STATE.md`, run the session-start sub-pipeline, derive milestones from the gap between gameplan and current state, and continue. No file rewrites needed.
