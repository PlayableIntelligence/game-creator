# Audit phase

Read the existing project, identify which entities are public-figure candidates, and resolve the slug list. This is the entry point — every `/meme-game` invocation starts here.

## When to use

- The user invoked `/meme-game [path] [name1,name2,...]` directly.
- `/viral-game` is auto-invoking `/meme-game` after Step 1.5.
- The user is iterating ("redo with karpathy as opponent") and the project already has a public-figure pass.

## Inputs

- `$ARGUMENTS`: optional `[path]` and optional comma-separated `[names]`.
- The project at the resolved path. Required files: `src/core/Constants.js`, `src/core/EventBus.js`, `src/core/GameState.js`, `src/entities/*.js`, `src/main.js`.
- `docs/STATE.md`, `docs/gameplan.md`, or legacy `progress.md` / `design-brief.md` if any of those exist.

## Steps

**1. Resolve the project path.**

If `$ARGUMENTS` includes a path, use it. Otherwise, default to the current working directory. Confirm the directory looks like a game project (has `package.json` with `phaser` or `three`, plus `src/core/`); abort with a clear message if not.

**2. Read the project state in this order.**

1. `docs/STATE.md` if it exists — recovers session context (last action, current phase). Falls back to `progress.md` if STATE.md is missing.
2. `docs/gameplan.md` if it exists — gameplay loop, art style, tech stack. Falls back to `design-brief.md`.
3. `src/core/Constants.js` — entity sizes, colors, palettes, `EXPRESSION` constants if already present.
4. `src/core/EventBus.js` — events you'll wire expressions to (`SCORE_CHANGED`, `PLAYER_DAMAGED`, `BIRD_DIED`, `SPECTACLE_*`, etc.). Cache the event names — wire phase needs them.
5. `src/core/GameState.js` — confirm which entities are stateful targets.
6. `src/entities/*.js` — identify which entities are candidates for public-figure replacement.

**3. Determine the target slug list.**

In priority order:

- **Explicit names from `$ARGUMENTS`**: split on comma, normalize (`Donald Trump` → `trump`, `Sam Altman` → `altman`). Use these exactly. Skip detection.
- **Auto-detection** (when `$ARGUMENTS` has no name list): run [`../sub-pipelines/public-figure-detection.md`](../sub-pipelines/public-figure-detection.md) against the prompt that the user gave (or against `docs/gameplan.md` if invoking a saved project). If detection returns a non-empty slug list, use it.
- **Ask the user** (last resort): if both above produced nothing, surface a one-sentence question via `AskUserQuestion`: "Which characters should this game feature? E.g. `trump,musk` for player + opponent." Wait for confirmation before doing any work. Do not guess.

**4. Map slugs to entity slots.**

For the ordered slug list, assign:

- First slug → player entity (or the slug-named class in `src/entities/`, if Step 1's conditional scaffolding already named it).
- Subsequent slugs → named opponents / NPCs in spawn order.
- Collectibles only get a slug if the game explicitly riffs on the figure (e.g. "Altman heads to collect"). Otherwise, leave collectibles generic.

Record the mapping. The resolve and wire phases use it.

**5. Update STATE.md.**

Append (or create) a `## Meme Pass — Audit` section to `docs/STATE.md`:

```
## Meme Pass — Audit
- Player slot: <slug>
- Opponent slots: <slug>, <slug>
- Collectible slots (if any): <slug>
- Source: $ARGUMENTS / detection / user-confirmed
```

Falls back to appending to `progress.md` if `docs/STATE.md` does not exist (back-compat with games scaffolded by old viral-game).

## Outputs

- A resolved project path
- A target slug list with role assignments (player / opponent / collectible)
- An updated `docs/STATE.md` (or `progress.md`) capturing the audit decisions
- Cached event names from `EventBus.js` for the wire phase

## Exit criteria

- The project path resolves to a real game project (not just any directory).
- The slug list is non-empty.
- Each slug maps to a specific entity slot in `src/entities/`.
- The user is confirmed on the slug list (either via explicit `$ARGUMENTS`, detection that doesn't ask, or an `AskUserQuestion` they answered).
