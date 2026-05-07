# Concept phase

Compressed, one-shot replacement for `/make-game`'s idea phase. Parse `$ARGUMENTS` (Form A direct or Form B tweet), run public-figure detection, ask the user **only** the two questions one-shot mode can't answer for them (engine, monetization intent), and write a slim `docs/gameplan.md` + `docs/STATE.md` so downstream phases have something to read.

## When to use

Every `/viral-game` invocation starts here.

## Inputs

- `$ARGUMENTS` (kebab-case name, `2d|3d`, OR a tweet URL)
- The current working directory
- API key state in `.env` and the environment

## Steps

**1. Parse `$ARGUMENTS`.**

Two forms:

- **Form A — Direct specification.** `[2d|3d] [game-name]`. If engine missing, ask. If name missing, suggest one based on the user's free-text description and ask them to confirm.
- **Form B — Tweet URL.** `x.com/.../status/...`, `twitter.com/.../status/...`, `fxtwitter.com/.../status/...`, or `vxtwitter.com/.../status/...`. Run [`../sub-pipelines/tweet-pipeline.md`](../sub-pipelines/tweet-pipeline.md) to fetch, abstract a concept, and generate a name. Default to 2D unless the abstraction is obviously 3D.

**2. Resolve API keys for 3D.**

Only for 3D games. Check `.env` first, then the environment:

- `MESHY_API_KEY` — character/prop models
- `WLT_API_KEY` / `WORLDLABS_API_KEY` — photorealistic environments (optional)

If missing, ask the user once, save to `.env` (gitignored), and proceed. Do not block the pipeline on missing keys — Meshy can be replaced with library models, World Labs is fully optional. See [`../sub-pipelines/tweet-pipeline.md`](../sub-pipelines/tweet-pipeline.md) for the canonical prompt strings.

**3. Run public-figure detection.**

Apply [`../../meme-game/sub-pipelines/public-figure-detection.md`](../../meme-game/sub-pipelines/public-figure-detection.md) against `$ARGUMENTS` (Form A) or the tweet text + abstracted concept (Form B). Output:

- `hasPublicFigures: boolean`
- `publicFigureSlugs: string[]`

Both are pipeline-wide. The build phase reads them to decide whether the conditional public-figure-pass task fires (Step 1.6 in legacy numbering).

**4. Ask the monetization question (one question, one time).**

Use `AskUserQuestion`:

> Before we scaffold: how do you plan to monetize this game?
> 1. **none** — just a fun build, no monetization
> 2. **Play.fun** — points, leaderboards, wallet rewards (bundled, runs in ship phase)
> 3. **sub.games** — subscription tiers (run `/subgames` separately after this pipeline; it lives in a different repo)
> 4. **both** — Play.fun for points + sub.games tiers

Store as `MONETIZATION_INTENT ∈ {'none', 'playfun', 'subgames', 'both'}`. Ambiguous answer → re-ask, don't guess.

This is **the only mandatory question** in the concept phase. Engine + name only get asked when Form A leaves them ambiguous. Public-figure work is auto-detected (no question). Stack is locked (no question — switch to `/make-game` if you want choices).

**5. Decide the project directory.**

If the current working directory is the `game-creator` plugin repository (check for `.claude-plugin/plugin.json` or `CLAUDE.md` mentioning game-creator), create the new game in `examples/<game-name>/`. Otherwise, create it as `<game-name>/` in the current working directory.

**6. Write `docs/gameplan.md` (slim, auto-derived).**

Use the [`../templates/gameplan-slim.md`](../templates/gameplan-slim.md) skeleton. Fill it from the concept derived in steps 1–3:

- **Pitch**: 1–2 sentences, derived from the prompt or tweet abstraction.
- **Core gameplay loop**: named verbs, single line.
- **Win/lose**: best-effort from the prompt; default to "endless run, score on survival, lose on collision" if nothing more specific.
- **Art style**: 2D=pixel art (palette tag from prompt vibe), 3D=low-poly + optional World Labs splat.
- **Stack**: opinionated default (Phaser 3 / Three.js, Vite, here.now, Play.fun if `playfun`).
- **Detected public figures**: write the slug list verbatim or `none`.
- **Open questions**: blank unless the prompt explicitly raised something the concept phase couldn't decide.

Do **not** run the `/make-game` clarifying-questions checklist. The whole point of `/viral-game` is to skip it. If the prompt is too thin to fill a slim gameplan, surface the gap to the user with one targeted question — never multiple.

**7. Write `docs/STATE.md`.**

Use the [`../templates/state.md`](../templates/state.md) skeleton:

```
# State

Phase: concept → scaffold
Last action: concept phase complete. Slim gameplan written.
Current task: scaffold from template.
Next step: copy <2d|3d> template, npm install, start dev server.

Detected public figures: [trump, altman]   # or "none"
Monetization intent: playfun                # or none / subgames / both
```

This file is the session-handoff anchor. Every later phase reads and updates it.

**8. Create the pipeline task list (`TaskCreate`).**

Build it conditionally on `MONETIZATION_INTENT` and `hasPublicFigures`:

| # | Task | Condition |
|---|---|---|
| 1 | Scaffold game from template | always |
| 1.25 | Scaffold gateables | `MONETIZATION_INTENT != 'none'` |
| 1.5 | Add assets (pixel art / GLB) | always |
| 1.6 | Public-figure pass via `/meme-game` | `hasPublicFigures = true` |
| 2 | Visual polish | always |
| 2.5 | Promo video | always |
| 3 | Audio | always |
| 3.5 | QA test suite (Playwright) | always |
| 4 | Deploy to here.now | always |
| 5 | Monetize | depends on `MONETIZATION_INTENT` (`none` → omit; `playfun`/`both` → Play.fun flow; `subgames` → instruct user to run `/subgames` externally) |

Quality assurance is built into each step, not a separate task. Each code-modifying step ends with [`../sub-pipelines/verification.md`](../sub-pipelines/verification.md).

**9. Initialize the autofix history.**

Create `<project-dir>/output/` and write `output/autofix-history.json` as `[]`. The verification protocol appends to this file across the pipeline so fix subagents avoid repeating failed approaches.

## Outputs

- A `docs/gameplan.md` slim gameplan
- A `docs/STATE.md` with phase=`concept→scaffold`, last action, next step, public-figure list, monetization intent
- A pipeline task list visible to the user
- An empty `output/autofix-history.json`
- Resolved API keys for 3D games (or explicit user "skip")

## Exit criteria

- `docs/gameplan.md` exists and is filled (no placeholder strings).
- `docs/STATE.md` exists and reflects phase boundary.
- `MONETIZATION_INTENT` and `hasPublicFigures` are pipeline-wide variables.
- Task list is created and tracking pending work.
- The user has confirmed the engine, name, and monetization choice (no ambiguity).

## Pause point

Pause for user confirmation **at the phase boundary** between concept and scaffold. Show the gameplan + the task list + the monetization choice. Wait for "go" before any code-writing step. This is the only pause inside the concept phase — sub-steps within it run continuously.
