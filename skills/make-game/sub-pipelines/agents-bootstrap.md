# Agents bootstrap

Generate the project-root `AGENTS.md` (and `CLAUDE.md` pointer) that enforces the `make-game` skill rules across every future session and every agent tool. Run once at the end of the scaffold phase, and again whenever the stack or core architecture changes.

`AGENTS.md` is a cross-tool standard read unconditionally by Cursor, Aider, Codex, Claude, and others — it's a stronger enforcement guarantee than skill description matching.

## When to use

- End of the scaffold phase, before flipping `docs/STATE.md` to `development`
- During the doc-backfill branch of [session-start](session-start.md), once `gameplan.md` and `tech.md` exist
- After a top-level stack or architecture change (new engine, new state-machine pattern, new mandatory file convention) — regenerate
- When the [doc-drift audit](doc-drift-audit.md) flags `AGENTS.md` as stale

## Inputs

- `docs/gameplan.md` — pitch, genre, gameplay loop
- `docs/tech.md` — engine, language, libraries, tooling, package manager, dev/test/build commands
- `docs/architectural-decisions/0001-*.md` — locked engine/language/art-style
- (Optional) any project-specific architecture rules already documented

## Steps

1. **Confirm the inputs exist.** If `docs/gameplan.md` or `docs/tech.md` is missing, stop and run the appropriate phase pipeline first. Do not synthesize an `AGENTS.md` from guesses.

2. **Copy the template.** Start from [`templates/agents.md`](../templates/agents.md). Do not improvise structure.

3. **Fill the project overview** from `docs/gameplan.md` and `docs/tech.md`:
   - Title, pitch, genre, engine + version, language, target platform.

4. **Fill the architecture rules** based on the engine. Defaults:
   - **Phaser 3 / Three.js (browser):** EventBus singleton, GameState singleton, `Constants.js`, `window.render_game_to_text()`, `window.advanceTime(ms)`. These are mandatory for the live-iterate loop and must be called out.
   - **Unity:** ScriptableObject for shared state; UnityEvent or signal-bus for cross-component messaging; Constants/Settings as ScriptableObjects; expose a debug state-dump method on a singleton MonoBehaviour for agent inspection.
   - **Godot:** Autoload singletons for state and event bus; `Globals` script for constants; `_unhandled_input` discipline; expose a debug `state_to_text()` on a global node.
   - **Other / custom:** ask the user what patterns the project will use, write them down, and add an ADR if no architecture-pattern ADR exists yet.

   Rule of thumb: every architecture rule in `AGENTS.md` should map to either an ADR or a clear convention captured in `docs/tech.md`. If it can't, surface it to the user before writing it.

5. **Fill stack-specific commands** from `docs/tech.md` tooling section:
   - Dev server, tests, build, lint/format. Use the *exact* commands the project uses — copy from `package.json` scripts, the engine's run target, etc. Mark "n/a" rather than inventing a command.

6. **Confirm with the user** before writing. Show the filled-in file in chat. Get explicit go-ahead. This file will be the front door for every future session — getting it right is worth a confirmation.

7. **Write `AGENTS.md`** to the project root. Stamp the **Last regenerated** field with today's date and your agent identity (e.g. `2026-05-04 by Claude / make-game scaffold`).

8. **Write `CLAUDE.md`** to the project root with a single line:
   ```
   > This project follows AGENTS.md. See ./AGENTS.md.
   ```
   Do not duplicate content. A pointer file avoids drift between the two.

9. **Commit both files** in a single commit titled `chore: bootstrap AGENTS.md and CLAUDE.md` (or follow the project's commit conventions if different).

## Outputs

- `AGENTS.md` at the project root, fully filled in (no remaining `<placeholder>` text)
- `CLAUDE.md` at the project root with the one-line pointer
- Both committed
- Confirmation in `docs/STATE.md` that the bootstrap ran (one line under "Last action" is enough)

## Exit criteria

- `AGENTS.md` exists at project root and contains no unfilled placeholders
- `CLAUDE.md` exists and points to `AGENTS.md`
- Every architecture rule listed in `AGENTS.md` is also captured in `docs/tech.md` or an ADR — no rule lives only in `AGENTS.md`
- The user has approved the file content
- A future agent opening this project finds `AGENTS.md` first and can act on it without further setup
