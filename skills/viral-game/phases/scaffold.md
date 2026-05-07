# Scaffold phase

Copy the engine template, install dependencies, start the dev server, and run a code-writing subagent to transform the template into the actual game concept. End with verification.

## When to use

After the concept phase passes its boundary. Always runs — there is no skip path for scaffolding.

## Inputs

- `docs/gameplan.md` — the slim gameplan from concept.
- `docs/STATE.md` — pipeline-wide variables (`hasPublicFigures`, `publicFigureSlugs`, `MONETIZATION_INTENT`, engine, name, project path).
- The plugin's `templates/phaser-2d/` or `templates/threejs-3d/` directory.

## Steps

**1. Mark the scaffold task `in_progress`.**

**2. Copy the template.**

The full infrastructure setup (template path resolution, `npm install`, Playwright + Chromium install, port-conflict handling, dev server start, generation of `scripts/example-actions.json`) lives in [`../sub-pipelines/step-details.md`](../sub-pipelines/step-details.md) under "Step 1: Scaffold the Game → Main Thread — Infrastructure Setup". Run that block.

**3. Run the scaffold subagent.**

The subagent prompt is in [`../sub-pipelines/step-details.md`](../sub-pipelines/step-details.md) under "Step 1 → Subagent — Game Implementation". It contains the full set of guardrails (mobile-first input, force portrait, Play.fun safe zone, `render_game_to_text` exposure, conditional public-figure scaffolding hints when `publicFigureSlugs` is non-empty, button pattern preservation, character sizing rules). Pass it: `<project-dir>`, `<2d|3d>`, the game concept text from `docs/gameplan.md`, the dev server port, and `publicFigureSlugs` (may be empty).

**4. Run verification.**

Apply [`../sub-pipelines/verification.md`](../sub-pipelines/verification.md) — build → runtime → iterate → architecture → visual review. Autofix on failure (max 3 attempts). The protocol writes its own results to `output/`.

**5. Update `docs/STATE.md`.**

```
Phase: scaffold → build
Last action: scaffold complete. Game boots, core loop wired, render_game_to_text() exposes <fields>.
Current task: <next conditional task — gateables if MONETIZATION_INTENT != 'none', else assets>.
Next step: launch <step> subagent.
```

Also write the legacy `progress.md` at the project root for back-compat with consumers that haven't migrated to `docs/STATE.md` yet (see "Migration note" below). The structure is in [`../sub-pipelines/step-details.md`](../sub-pipelines/step-details.md) under "Step 1 → After Subagent Returns".

**6. Mark the scaffold task `completed`. Tell the user one short paragraph** about what shipped (entry points, mobile controls built in, what's next).

## Migration note

Existing consumers (`/improve-game`, `/add-feature`, the meme-game audit phase) read `progress.md` at the project root. Until those skills migrate to read `docs/STATE.md` directly, write **both** files during this phase — `docs/STATE.md` is the canonical source, `progress.md` is a one-line redirect plus a copy of the relevant sections. When in doubt, read first; if `docs/STATE.md` exists, treat it as authoritative.

## Outputs

- `<project-dir>/` populated with the engine template, transformed into the game concept.
- `node_modules/` installed.
- Playwright + Chromium installed.
- Dev server running and reachable on a known port.
- `docs/STATE.md` rolled to `phase: scaffold → build`.
- `progress.md` at the project root (back-compat).
- `design-brief.md` at the project root (written by the subagent — kept for consumers that haven't migrated to `docs/gameplan.md`).

## Exit criteria

- The dev server boots without errors.
- The game starts in `playing` mode (no title screen unless the user explicitly asked).
- `window.render_game_to_text()` returns a usable JSON snapshot.
- Verification protocol passes (or, after autofix, passes on retry).
- `docs/STATE.md` reflects the phase boundary.

## Pause point

Pause for user confirmation **at the phase boundary** between scaffold and build. Show the user the dev server URL and a short summary. Wait for "go" before launching any build-phase task.
