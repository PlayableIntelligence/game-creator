---
name: eval-game
description: Score a built browser game's Build Health (and pixel-level Visual Usability) by loading it in headless Chromium, capturing lifecycle + render signals, and producing a deductive [0, 100] score with structured deductions. Use when the user says "evaluate my game", "score my game", "how good is this game", "check build health", or "is my game broken". Do NOT use for adding tests (use qa-game) or implementing fixes (use improve-game). Requires OpusGameLabs/game-eval cloned as a sibling, or GAME_EVAL_DIR env var pointing to it.
argument-hint: "[path-to-game]"
license: MIT
metadata:
  author: OpusGameLabs
  version: 0.1.0
  tags: [game, eval, qa, build-health, visual-usability]
---

# eval-game

Run the **Build Health** bench from [OpusGameLabs/game-eval](https://github.com/OpusGameLabs/game-eval) against any built game-creator project. Produces a structured score the agent can act on. Cheaper, faster, and more diagnostic than launching the dev server and manually reviewing — but does NOT replace gameplay-aware QA (use `qa-game` for that).

## When to use

- The user wants a single-number health check on a game.
- After `make-game` or `improve-game` finishes, before declaring the game "done".
- As a regression check after edits to a game's core files (Constants, EventBus, scenes).

**Do not use** for: adding Playwright tests (`qa-game`), implementing fixes (`improve-game`), or visual design feedback (`design-game`).

## Prerequisites

The skill requires [`OpusGameLabs/game-eval`](https://github.com/OpusGameLabs/game-eval) checked out somewhere on the local machine. The wrapper script tries:

1. `$GAME_EVAL_DIR` — set this if game-eval isn't a sibling of game-creator
2. `../game-eval/` — sibling of the game-creator repo

If neither resolves, the script exits 2 with a clear error and tells the user how to fix it. Do **not** try to clone game-eval or work around its absence — surface the message and stop.

## Instructions

Run the wrapper script against the game directory. The script handles `npm install` (if needed), `npm run build -- --base=./` (relative-path build for bench compatibility), invocation of game-eval's `bench_bh.ts`, and result formatting.

```bash
node scripts/eval-game.mjs <path-to-game>
```

The wrapper exits:
- `0` — bench valid, game rendered visible content without errors
- `1` — bench ran but reported `valid=false` (deductions explain why)
- `2` — couldn't run (build failed, game-eval missing, etc.)

### Reading the output

Output ends with a structured summary block:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Build Health: 100/100   valid=true
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
No deductions — clean run.

Visual Usability (pixel-half): 60/100
  entropy: 100/100  motion: 19/100

Signals:
  loaded=true loadDuration=650ms canvas=true frames=5/5
  consoleErrors=0 pageErrors=0 failedRequests=0

Full output: <run-dir>
```

The full `bh.json` lives in the printed run directory. For machine-readable output use `--json`.

### What each metric means

- **Build Health (BH)**: deductive [0, 100] score starting at 100 and subtracting per failure mode. Common deductions:
  - `−50 every captured frame is blank` — canvas exists but renders nothing visible
  - `−50 no <canvas> in DOM` — page loaded but never created a canvas
  - `−50 page failed to load` — navigation timed out
  - `−40 N uncaught exceptions` — `pageerror` events
  - `−5 per console.error` capped low — non-fatal but worth flagging
  - `−10 per failed request, capped at −30` — 4xx/5xx or network errors

- **Visual Usability (pixel-half)**: separate [0, 100] score. Two equally-weighted subscores:
  - `entropy` — how visually rich the captured frames are (median Shannon entropy in bits, full credit at 4 bits ≈ a colorful Phaser scene)
  - `motion` — how much the scene changes between frames (overall pairwise pixel difference, full credit at ~5% per-frame change)
  - **Static games** (no input applied, no auto-animation) score low on motion. That's correct — they ARE static. Don't treat low VU as a failure unless BH is also flagged.

- **VU is null** when BH is invalid — there's no point scoring the visuals of a game that didn't render.

### When to act on each result

- `BH=100, valid=true`: report success. If VU is also high, the game is in good shape. If VU is low (e.g., flat-color regions, no motion), mention it but don't escalate — many games legitimately have low-motion menus.
- `BH<100, valid=true`: report each deduction by name. The deductions list is the diagnosis.
- `valid=false`: the game didn't render. Top deductions tell you why. Surface the first 1-2 `pageerror` / `consoleEvents` lines from the JSON for context.
- Wrapper exit 2: don't try to retry or work around. Surface the error message verbatim.

### Limitations to flag honestly

1. **Static evaluation** — the bench loads `dist/index.html` and observes for ~10s without any input. It catches "the game runs and renders something" but not "the game is fun" or "the player can win." Use `qa-game` for gameplay-aware testing.
2. **Single-shot** — no retry, no re-roll. Flaky games (timing-dependent boots) may score differently across runs. Run twice if unsure.
3. **Pixel-half only** — VU here is the pixel half. The VLM half (rubric-judged screenshots) is **not yet implemented** and is not part of this skill. Don't claim a low VU means "the game looks bad" — it means it has low entropy / motion in the captured frames.
4. **Build override** — the bench builds with `vite --base=./` to produce relative paths. This differs from a deployed build. The score reflects "does the compiled JS work in a browser," not "does it deploy correctly to GH Pages."

### What's tested in this PR

The skill is end-to-end validated against:
- `templates/phaser-2d` (clean) → BH=100 valid=true ✓
- `examples/flappy-bird` (real game with GH Pages base path) → BH=100 valid=true ✓
- `OpusGameLabs/game-eval/fixtures/runtime/null-deref` (materialized broken fixture) → BH=30 valid=false, exact `Cannot read properties of undefined (reading 'sprite')` flagged ✓
- `OpusGameLabs/game-eval/fixtures/build/syntax-error` → wrapper exits 2 with the Vite parse error visible ✓
