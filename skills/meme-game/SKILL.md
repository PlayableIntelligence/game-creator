---
name: meme-game
description: Turn an existing game into a public-figure (meme) version — swap the player and named entities for photo-composite characters of real people (politicians, tech CEOs, world leaders, entertainers) and wire reactive expressions to game events. Auto-invoked by `/viral-game` Step 1.6 when the prompt or source tweet explicitly names a public figure or a public company (mapped to its CEO); can also be run manually with `/meme-game [path] [name1,name2,...]`. Use when the user explicitly mentions a public figure ("make me a Trump game", "add Altman as the player", "feature Musk", "OpenAI/Anthropic-themed game") or asks to "make this a meme game". Do NOT use for fictional characters, brand mascots, or generic pixel-art conversion (use `/add-assets`); for new game scaffolding use `/viral-game`.
argument-hint: "[path-to-game] [name1,name2,...]"
license: MIT
metadata:
  author: OpusGameLabs
  version: "2.0"
  tags: [game, public-figure, meme, characters, photo-composite, 2d, 3d]
---

# Meme Game (Public-Figure Pass)

Transform an existing game into a public-figure version. The skill resolves named real people (politicians, tech CEOs, world leaders, entertainers) into photo-composite spritesheets (2D) or rigged caricature models (3D), then wires reactive expressions to existing game events. The underlying gameplay is unchanged — only the visual identity of named entities is upgraded.

`/meme-game` is **the engine** for public-figure work. It runs in two ways:

1. **Auto-invoked** by `/viral-game` Step 1.6 when the prompt or source tweet explicitly names a public figure or a public company (e.g. "OpenAI" → `altman`).
2. **Manual** invocation by the user (`/meme-game <path> <names>`) on any existing game — same engine, manual targeting.

In either mode, the skill stays out of generic games. If a game like `maze-tank` has no public figures named, this skill is not invoked, and no real-person content is injected anywhere.

## When to use vs. other skills

| Want | Use |
|---|---|
| Swap real people into an existing game with reactive expressions | **`/meme-game`** (this skill) |
| Build a new game from scratch (one-shot) — possibly with public figures | `/viral-game` (which auto-invokes this skill in Step 1.6 when public figures are detected) |
| Build a new game from scratch (multi-session, milestone-driven) | `/make-game` |
| Replace shapes with generic pixel art (no real public figures) | `/add-assets` |
| Visual polish, particles, juice | `/design-game` |

If the user starts a `/meme-game` session and asks for milestones, ADRs, or multi-session iteration, redirect them to `/make-game`. This skill is one-shot — it does one focused pass on an existing game and exits.

## Philosophy

Recognition is the meme hook. A photo-composite head of Trump, Altman, or Musk on a tiny South Park-style cartoon body is instantly readable at any size, on any screen — that's the whole reason the photo-composite pipeline exists. Pixel-art caricatures are a real fallback (when no photo can be sourced), but the pipeline always tries to land on a recognizable photo first.

This skill is **purely additive**. It modifies entity rendering and wires expressions. It does not change gameplay mechanics, scoring, fail conditions, or the core loop.

## Rules

- **Detection is conservative.** Public figures are matched only when they are explicitly named in the prompt, the tweet, or `$ARGUMENTS`. Topic is never enough. `maze-tank` does not match. Detection logic is shared with `/viral-game` and lives in [`sub-pipelines/public-figure-detection.md`](sub-pipelines/public-figure-detection.md).
- **Step 1.5 (asset pass) must run before this skill** when invoked from `/viral-game`. Public-figure work is an **overlay** on top of generic pixel art / GLB models — it doesn't replace them. Enemies, items, tiles, and any entity not in the slug list keep the art Step 1.5 produced.
- **Always read the project state first.** Read `docs/STATE.md` + `docs/gameplan.md` (or fall back to `progress.md` + `design-brief.md`) before any code changes. Don't infer — read.
- **Minimum-viable doc mode by default.** This is a one-shot pass; it appends to existing docs but never demands ADRs, milestones, or `tech.md`. Use `docs/STATE.md` + `docs/gameplan.md` if they exist; otherwise fall back to `progress.md` (back-compat with games scaffolded by older `/viral-game` versions).
- **Redirect to `/make-game` if the user wants milestones / multi-session / careful planning.** This skill is one-shot, scoped to entity rendering + expression wiring. Anything bigger belongs in `/make-game`.
- **All code changes go through subagents** when invoked autonomously. The main thread orchestrates: read context, run detection, hand off resolved slugs + role assignments to the wire phase. The orchestrator does not write game code directly.

## Phases

The skill runs four phases sequentially. Pause between phases for user confirmation only when invoked manually; when auto-invoked from `/viral-game`, run straight through and let viral-game's Step 1.6 verification cover the boundary.

1. **[Audit](phases/audit.md)** — read the project, identify entities, resolve the slug list (from `$ARGUMENTS`, detection, or a single user question).
2. **[Resolve](phases/resolve.md)** — walk the per-slug fallback (5-tier 2D or 4-tier 3D). Stop at the first tier that produces a usable asset.
3. **[Wire](phases/wire.md)** — load assets, add bobblehead Container layering (2D) or wire `MODELS` config + `SkeletonUtils.clone()` (3D), bind expression frame swaps to game events.
4. **[Verify](phases/verify.md)** — build check, runtime check, visual review, expression spot-check, test suite, STATE.md update.

## Sub-pipelines

- **[public-figure-detection.md](sub-pipelines/public-figure-detection.md)** — shared detection rules (manifest slugs, recognizable names, company → CEO mapping). Used by both `/meme-game` (when no explicit names) and `/viral-game` (during concept). Single source of truth.
- **[character-resolution-2d.md](sub-pipelines/character-resolution-2d.md)** — 5-tier 2D fallback (pre-built library → 4 photos → 1‑3 photos → 1 photo → pixel-art caricature). Reuses `scripts/build-character.mjs`, `scripts/crop-head.mjs`, `scripts/process-head.mjs`, and `assets/characters/manifest.json`.
- **[character-resolution-3d.md](sub-pipelines/character-resolution-3d.md)** — 4-tier 3D flow (Meshy AI caricature + rig → pre-built library → Sketchfab → generic library model).
- **[expression-wiring.md](sub-pipelines/expression-wiring.md)** — meme-game-specific event-to-expression mapping (idle revert, opponent inversion, optional Expression Map for `docs/gameplan.md`). The static technique (`EXPRESSION` constants, bobblehead body pattern, scaling, head positioning) is in `game-assets/character-pipeline.md` — load that as a reference.

## Reference (other skills)

- `game-assets/character-pipeline.md` — bobblehead body Container layering, `EXPRESSION` constants, `CHARACTER` scaling, head positioning math, idle breathing tween. Load as a reference during the wire phase.
- `game-assets/sprite-catalog.md` — Public-Figure Caricature archetype (the 2D Tier 5 pixel-art fallback).

## Example invocations

### Standalone, on an existing game
```
/meme-game examples/asteroid-dodge trump,musk
```
Result: player becomes Trump (photo head + cartoon body), opponent becomes Musk. Expressions wire to score / damage / streak events. Physics and gameplay unchanged.

### Auto-invoked from `/viral-game`
```
/viral-game https://x.com/.../status/...   # tweet about Sam Altman
```
Form B detects "Sam Altman" as a public figure and, after Step 1.5 finishes, automatically calls `/meme-game` with `altman` as the target. End state matches what the old monolithic pipeline used to produce, but the public-figure work is cleanly attributed and skippable.

### Pixel-art caricature (Tier 5 forced)
```
/meme-game examples/space-runner karpathy
```
If WebSearch finds no usable photos and the photo-composite pipeline fails, the resolve phase falls back to pixel-art caricature with signature features (long dark hair, casual hoodie). Functional, recognizable, no expressions.

## Self-check before completing

- Each slug resolved to a tier and the tier was recorded in `docs/STATE.md`.
- Photo-composite heads paired with cartoon bodies (no floating heads alone) for 2D Tier 1–4.
- `EXPRESSION` and `EXPRESSION_HOLD_MS` defined in `Constants.js` if any 2D Tier 1–4 slug exists.
- Expressions wired to at least 3 game events per character (score, damage, streak).
- Idle timer reverts to `NORMAL` after `EXPRESSION_HOLD_MS`.
- Physics bodies adjusted for new sprite dimensions.
- `npm run build` succeeds.
- Visual check confirms all characters render and react to events (or animations play correctly for 3D).
- `docs/STATE.md` updated with `## Meme Pass — Done` summary.
- No gameplay logic changed — only entity rendering and expression wiring.
