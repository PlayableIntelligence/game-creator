# Session start

The first thing to run at the start of every session in an existing project. Builds context and aligns on what to do next before any other work.

## When to use

- The current working directory is a project directory (has `docs/` or game source files)
- You have not yet read project docs in this conversation
- The user has just opened a new session

## Inputs

- The current working directory
- Any `docs/` folder that exists in it

## Steps

1. **Check for `docs/STATE.md`.** If it exists, read it first. This is the previous session's handoff and tells you exactly where to resume.
2. **Read `docs/gameplan.md`** if it exists. This is the source of truth for what the game is.
3. **Read `docs/tech.md`** if it exists. This is the source of truth for the stack.
4. **List `docs/milestones/`.** Identify the earliest milestone with incomplete acceptance criteria. Read its full content.
5. **Read `docs/backlog.md`** if it exists. You don't need to action items, but you must know what was deferred. If the user opens the session with a request that matches a backlog item, treat the backlog entry as the source of truth (description, notes, prior context) rather than starting from scratch.
6. **Spot-check the codebase** against the open milestone. Has work been done that hasn't been ticked off? Has the AC drifted from reality?
7. **Decide the phase:**
   - No `docs/` and no project source files → **Idea phase**
   - `docs/` exists but no project source / dependencies installed → **Scaffold phase**
   - Project source files exist *and* `docs/` exists → **Development phase**
   - Project source files exist but `docs/` is missing or near-empty → **Development phase + doc backfill**. The project was started outside this skill (or by an earlier non-skill session). Before continuing feature work, offer to bootstrap `docs/gameplan.md` and `docs/tech.md` from the existing code: read the entry point, package manifest, and a representative scene/system; draft the docs; confirm with the user; then run the [agents-bootstrap sub-pipeline](agents-bootstrap.md) so future sessions enforce the skill regardless of which agent tool is used. Do not silently start coding new features in a project with no docs — that's how drift starts.
   - Project has `docs/` but no `AGENTS.md` at the project root → **same phase as detected, plus agents-bootstrap**. Run the [agents-bootstrap sub-pipeline](agents-bootstrap.md) before continuing other work. `AGENTS.md` is the cross-session enforcement file and is mandatory for any project past the idea phase.
8. **Confirm with the user before acting.** Summarize: "We're in `<phase>`, current milestone is `<X>`, next open AC is `<Y>`. Proceed?" Use the `AskUserQuestion` tool with the proposed next step as one of the options. For the doc-backfill branch, the question is: "Bootstrap `docs/` from existing code now, or skip the backfill and start coding (you'll be in minimum-viable doc mode — see `SKILL.md` §1)?" If `docs/backlog.md` has items the user might want to promote ahead of the next AC, include the top one or two as alternative options in the question.

## Outputs

- An internal understanding of phase, current milestone, and the next concrete step
- A user confirmation (or correction) of that summary
- (At the end of the session, not the start) An updated `docs/STATE.md` once progress was made — see [`templates/state.md`](../templates/state.md)

## Exit criteria

- You can name the current phase, current milestone, and the next acceptance criterion to work on
- The user has confirmed (or corrected) that summary and given a go-ahead
