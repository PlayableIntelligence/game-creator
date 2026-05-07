# Sub-pipelines

Reusable pipelines for specific tasks during game development. Use these when the task fits — do not invent your own pipeline if one is already defined here.

## How to use

Before starting work that fits a sub-pipeline below, read that sub-pipeline document and follow it. If your task spans multiple sub-pipelines, name them in your plan and run them in order.

## Standard sub-pipeline shape

Every sub-pipeline doc follows this structure. When adding a new sub-pipeline, follow the same shape so behavior stays consistent across sessions.

- **When to use** — concrete trigger conditions
- **Inputs** — what must exist before starting (docs, codebase state, user info)
- **Steps** — ordered, numbered actions
- **Outputs** — files written or changed, decisions captured
- **Exit criteria** — how you know the sub-pipeline is done

## Available sub-pipelines

### Process
- [Session start](session-start.md) — entry point for every session in an existing project; recovers context and decides the current phase
- [Scope triage](scope-triage.md) — narrow a multi-feature request down to a single focused session; defer the rest to `docs/backlog.md`
- [Milestone planning](milestone-planning.md) — propose the next 1–3 milestones from the gap between `docs/gameplan.md` and current state + `docs/backlog.md`
- [Bug fix](bug-fix.md) — triage, repro, minimal-scope fix, regression check
- [Playtest / repro](playtest-repro.md) — convert vague gameplay feedback into testable acceptance criteria
- [Doc drift audit](doc-drift-audit.md) — verify `docs/` still reflects code reality

### Setup
- [Agents bootstrap](agents-bootstrap.md) — generate `AGENTS.md` + `CLAUDE.md` at the project root to enforce skill use across every future session. Run at end of scaffold phase, after stack changes, or when drift is flagged.

### Verification
- [Live iterate](live-iterate.md) — post-edit verification loop: console → `render_game_to_text()` → `advanceTime()` → screenshot → user check. Run after every code change in the development phase.

### Authoring
- [Asset pipeline](asset-pipeline.md) — naming, folder layout, placeholder→final swap, binary storage rules

### Systems
- [State machine](state-machine.md) — canonical FSM pattern; prevents ad-hoc booleans-as-state
