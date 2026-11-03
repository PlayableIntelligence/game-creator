# Verification Protocol

Run this protocol after **every code-modifying step** (Steps 1, 1.5, 2, 3). Step 2.5 (Promo Video) does not modify game code, so it skips QA. It delegates all QA work to a subagent to minimize main-thread context usage.

## Browser Check (once, before first QA run)

Before the first QA run (after Step 1 infrastructure setup), check that `scripts/cdp.mjs` is in the project and Google Chrome is installed (or `BOOP_CHROME` names a Chrome/Chromium). Visual review uses screenshots written by `scripts/iterate-client.js` and the Read tool; do not install a browser MCP server.

## QA Subagent

Launch a `Task` subagent with these instructions:

> You are the QA subagent for the game creation pipeline.
>
> **Project path**: `<project-dir>`
> **Dev server port**: `<port>`
> **Step being verified**: `<step name>`
>
> Run these phases in order. Stop early if a phase fails critically (build or runtime).
>
> **Phase 1 — Build Check**
> ```bash
> cd <project-dir> && npm run build
> ```
> If the build fails, report FAIL immediately with the error output.
>
> **Phase 2 — Runtime Check**
> ```bash
> cd <project-dir> && node scripts/verify-runtime.mjs
> ```
> If the runtime check fails, report FAIL immediately with the error details.
>
> **Phase 3 — Gameplay Verification**
> ```bash
> cd <project-dir> && node scripts/iterate-client.js \
>   --url http://localhost:<port> \
>   --actions-file scripts/example-actions.json \
>   --iterations 3 --screenshot-dir output/iterate
> ```
> After running, read the state JSON files (`output/iterate/state-*.json`) and error files (`output/iterate/errors-*.json`):
> - **Scoring**: At least one state file should show `score > 0`
> - **Death**: At least one state file should show `mode: "game_over"`. Mark as SKIPPED (not FAIL) if game_over is not reached — some games have multi-life systems or random hazard spawns that make death unreliable in short iterate runs. Death SKIPPED is acceptable and does not block the pipeline.
> - **Errors**: No critical errors in error files
>
> Skip this phase if `scripts/iterate-client.js` is not present.
>
> **Phase 4 — Architecture Validation**
> ```bash
> cd <project-dir> && node scripts/validate-architecture.mjs
> ```
> Report any warnings but don't fail on architecture issues alone.
>
> **Phase 5 — Visual Review via Screenshots**
> Visually review the game from screenshots written by the iterate client (Chrome over the DevTools protocol, `scripts/cdp.mjs`), viewed with the Read tool. If no screenshots can be captured, fall back to code review.
>
> With screenshots:
> 1. Run `node scripts/iterate-client.js --url http://localhost:<port> --iterations 1 --pause-ms 2000 --screenshot-dir output/qa` — the pause gives the game 2 seconds to load
> 2. Read `output/qa/shot-0.png` (copy it to `output/qa-gameplay.png`)
> 3. Assess: Are entities visible? Is the game rendering correctly?
> 4. Check safe zone: Is any UI hidden behind the top ~8% (Play.fun widget area)?
> 5. Check entity sizing: Is the main character large enough (12-15% screen width for character games)?
> 6. Wait for game over (more `--iterations` with no input, or the `output/iterate/` run from Phase 3 that reached `mode: "game_over"`), Read that shot — save as `output/qa-gameover.png`
> 7. Check buttons: Are button labels visible? Blank rectangles = broken button pattern.
> 8. Check mute button: Is there a mute toggle visible? If not, flag as ISSUE.
>
> **Screenshot timeout**: If the iterate client hangs for more than 10 seconds on a screenshot (can happen with continuous WebGL animations), stop it and proceed with code review instead. Do not let a screenshot hang block the entire QA phase.
>
> **Note on iterate screenshots**: If a screenshot comes out blank/black (a canvas read back with `canvas.toDataURL()` when Phaser uses WebGL with `preserveDrawingBuffer: false`), take a viewport screenshot instead with a short cdp.mjs script (`page.screenshot({ path })`).
>
> Without screenshots (fallback):
> 1. Read whatever iterate screenshots exist in `output/iterate/shot-*.png` (may be black if WebGL — this is expected)
> 2. Fall back to code review: read scene files and assess visual correctness from the code
>
> **Return your results in this exact format (text only, no images):**
> ```
> QA RESULT: PASS|FAIL
>
> Phase 1 (Build): PASS|FAIL
> Phase 2 (Runtime): PASS|FAIL
> Phase 3 (Gameplay): Iterate PASS|FAIL, Scoring PASS|FAIL|SKIPPED, Death PASS|FAIL|SKIPPED, Errors PASS|FAIL
> Phase 4 (Architecture): PASS — N/N checks
> Phase 5 (Visual): PASS|FAIL — <issues if any>
>
> ISSUES:
> - <issue descriptions, or "None">
>
> SCREENSHOTS: output/qa-gameplay.png, output/qa-gameover.png
> ```

## Orchestrator Flow

```
Launch QA subagent -> read text result
  If PASS -> proceed to next step
  If FAIL -> launch autofix subagent with ISSUES list -> re-run QA subagent
  Max 3 attempts per step
```

## Autofix Logic

When the QA subagent reports FAIL:

1. **Read `output/autofix-history.json`** to see what fixes were already attempted. If a previous entry matches the same `issue` and `fix_attempted` with `result: "failure"`, instruct the subagent to try a different approach.
2. Launch a **fix subagent** via `Task` tool with:
   - The ISSUES list from the QA result
   - The phase that failed (build errors, runtime errors, gameplay issues, visual problems)
   - Any relevant failed attempts from `output/autofix-history.json` so the subagent knows what NOT to repeat
3. **After each autofix attempt**, append an entry to `output/autofix-history.json`:
   ```json
   { "step": "<step name>", "issue": "<what failed>", "fix_attempted": "<what was tried>", "result": "success|failure", "timestamp": "<ISO date>" }
   ```
4. Re-run the QA subagent (all phases)
5. Up to **3 total attempts** per step (1 original + 2 retries)
6. If all 3 attempts fail, report the failure to the user and ask whether to skip or abort

**Important**: Always fix issues before proceeding to the next step. The autofix loop ensures each step produces working, visually correct output.
