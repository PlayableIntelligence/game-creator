---
name: make-game
description: Use when the user wants to design, scaffold, build, or iterate on a video game — including brainstorming new game ideas, planning a gameplay loop, choosing an engine, scaffolding a project, adding features, fixing gameplay bugs, or working on assets. Triggers on phrases like "make a game", "create a [genre] game", "build a [type] game", "I want to make a [genre]", or any session inside a game project directory (has docs/, src/, or an engine config).
metadata:
  author: OpusGameLabs
  version: "2.0"
  tags: video games, threejs, unity, gaming, pipelines, commands, godot
---

# Make Games

When working with a user to create a video game, reference the skills/pipelines/commands provided to help the user create a perfect pipeline for their game development.

Based on the state of the user's request, current codebase, and stage of development, choose the proper steps to take with the user to complete their request.

## When to Use

Use this skill when:

- The user is brainstorming or describing a game idea (no project directory required — the idea phase exists exactly for this)
- The current working directory is a game project (has `docs/`, source files, or an engine config like `package.json` with Phaser/Three.js, a Unity `Assets/`, a Godot `project.godot`, etc.)
- The user wants to add gameplay features, fix gameplay bugs, work on assets, or iterate on game design

Do not use this skill when:

- The user's request is unrelated to game development (general web apps, CLI tools, libraries, infrastructure, data work, etc.)
- The user explicitly asks for a non-game artifact (e.g. "build me a chat app")
- The user wants a quick prototype with no doc rigor — use [`/quick-game`](../quick-game/SKILL.md) for a fast scaffold + core loop only. If the project grows beyond a prototype (the user starts asking for milestones, ADRs, or long-term iteration), switch back to this skill.

# Table of Contents

1. Rules
2. Phases
3. Milestones
4. Important Files
5. Templates
6. Sub-pipelines
7. Other Skills

# 1. Rules

- **No code before plan.** If `docs/gameplan.md` does not exist, you MUST run the [idea-phase pipeline](phase-pipelines/idea.md) to completion — gameplan, `docs/tech.md`, and ADR-0001 written and user-confirmed — before creating any source files, running engine scaffolders, installing dependencies, or otherwise touching code. A detailed-sounding user prompt is **not** a substitute for the idea-phase questions: even if the user says "3D racing game with pixel art shaders," you do not yet know the gameplay loop, win condition, controls, scope, or target session length, and improvising those choices is the single biggest cause of refactoring later. Treat this as a hard tripwire — if you find yourself about to scaffold a project without a written gameplan the user has signed off on, stop and run the idea phase first. The clarifying-questions checklist in [idea.md](phase-pipelines/idea.md) is the minimum bar; do not skip items because the prompt "seems clear."
- **Always run the [session-start sub-pipeline](sub-pipelines/session-start.md) first** when entering a session in an existing project directory. It recovers context (`docs/STATE.md`, `docs/gameplan.md`, `docs/tech.md`, milestones), determines the current phase, and confirms the next step with the user. Skip only if there is no project directory yet (idea-phase brand-new conversation).
- When asking the user questions, use the `AskUserQuestion` tool. If you can provide some recommendations as multiple choice answers, with the option for the user to provide their own answer, that would be optimal.
  - When asking questions, keep them focused, clear, and detailed. If the question may have some logical answers you can think of, provide those as possible answers for the user. This will help if they want to think of a solution themselves as well since they can pull from the different options you provided to curate the perfect answer.
  - If you have prior memory or experience with the user, guage their technical ability/expertise, and shape your questions around that. If they do not seem technically advanced, make sure to ask questions in a way they would understand. Offering explanations for more advanced topics along with the question so they aren't answering them blindly.
- Based on the current state of the codebase, the users request, and architectural decisions such as game engine, art style, etc. decide which phase of development the game is in, and start with the pipeline outlined for said phase. They are described in the next section.
- When scaffolding a new project, do not use your embedded knowledge of how to setup the project — many things might have changed since you were trained. Find the newest version of the documentation, or ask the user to find a link and provide it to you. Read the newest installation instructions for the frameworks/libraries you are working with, and follow them according to the stack and setup the project already has set.
- **Always prefer the engine's or framework's official scaffolding command over hand-rolling files.** Examples: `npm create @phaserjs/game@latest` for Phaser; `npm create vite@latest` (then `npm install three`) for Three.js; Unity's `-createProject` CLI (`"C:\Program Files\Unity\Hub\Editor\<version>\Editor\Unity.exe" -createProject "<path>" -quit` on Windows, `/Applications/Unity/Hub/Editor/<version>/Unity.app/Contents/MacOS/Unity -createProject <path> -quit` on macOS) or Unity Hub's "New project" dialog. For Godot/Unreal, ask the user to create the project from the editor. Hand-written `package.json`, bundler configs, or engine entry points cause version mismatches the moment a second library is added — do not do it. If you cannot find an official scaffolder and the user cannot point you to one, ask the user to initialize the project themselves and resume the session once it's ready, rather than improvising a setup. Full guidance and per-engine examples live in [scaffold.md](phase-pipelines/scaffold.md) step 3.
- If the user has a large change to anything regarding core gameplay loop, architecture, etc., ensure that the relevant documentation in the `docs/` folder is updated to reflect their changes. For large architecture decisions, we should write to `docs/architectural-decisions` that can be referenced later with the changelogs. These changelogs must be detailed and include the reason for changing them. The `docs/gameplan.md` file must also be updated when these decisions are made, with referenced to the AD documents behind the changes.
- **After every code change in the development phase, run the [live-iterate sub-pipeline](sub-pipelines/live-iterate.md).** It is the canonical real-time verification loop (console → `render_game_to_text()` → `advanceTime()` → screenshot if visual → user check). A change is not "done" until it has been iterated on.
- **Write failing tests before writing the implementation.** Tests are the executable form of acceptance criteria — every checkable AC for the active milestone must have at least one test that asserts it, written first and confirmed to fail for the right reason before any implementation code is touched. Use Playwright (per `/qa-game`) for gameplay logic and visual baselines; unit tests for pure helpers; multi-client Playwright for multiplayer. Visual/feel AC that can't be meaningfully asserted (juice, polish) must be **explicitly** marked "verified by user playtest" in the milestone — never silently skipped. If the AC is too vague to write a test against, run [playtest / repro](sub-pipelines/playtest-repro.md) first to make it checkable. Loosening a failing test to make it pass is forbidden — fix the implementation, or update the milestone AC and rewrite the test.
- **Keep every session focused on a single feature.** When the user's request implies more than one independent feature or change, run the [scope-triage sub-pipeline](sub-pipelines/scope-triage.md) before any coding: enumerate the asks, write the deferred ones to `docs/backlog.md`, and pick the single best balance of *important* and *easy to ship in one focused session* via `AskUserQuestion`. Sessions that try to carry multiple unrelated features cause context drift, make live-iterate verification ambiguous (which feature broke?), and leave milestones half-checked. Bundling features is allowed only when the user explicitly insists and acknowledges the trade-off.
- **Nothing the user mentions gets silently dropped.** If a feature, polish item, refactor, or open question surfaces during a session but is out of scope, it must be appended to `docs/backlog.md` using the shape from [`templates/backlog.md`](templates/backlog.md). The backlog is the single home for "later" — never rely on conversation memory or `docs/STATE.md` notes to remember future work. The development pipeline and milestone planning both read this file.
- **When the user needs a roadmap, run [milestone planning](sub-pipelines/milestone-planning.md), don't improvise.** Whenever the user asks "what's next?" / "what milestones do we need?" / "what's left to ship?" — or whenever open milestones run out before `docs/gameplan.md` is satisfied — derive the next 1–3 milestones from the **gap between the gameplan and current state + backlog**, ordered architecture-enabling first, then confirm via `AskUserQuestion` before writing any milestone files. Cap proposals at three: future milestones will look different once the next ones ship, so over-committing wastes planning effort. Never propose a milestone whose exit condition can't be written as "User does X → observes Y" — vague targets produce vague milestones.
- **`AGENTS.md` must exist at the project root** for any project past the idea phase. It is the cross-tool, unconditionally-read enforcement file that guarantees future sessions follow this skill's rules even when the skill itself doesn't auto-trigger. If you find a project past the idea phase without an `AGENTS.md`, run the [agents-bootstrap sub-pipeline](sub-pipelines/agents-bootstrap.md) before continuing other work.
- You MUST follow the pipelines outlined by each phase when working on the project based on the phase the project is in.

## Minimum-viable doc mode

If the user pushes back on documentation overhead ("just code it", "skip the docs"), do **not** silently abandon the doc rules — that is exactly how cross-session drift starts. Instead, downgrade to **minimum-viable doc mode** and tell the user you're doing so:

- One-line milestone entry (title + one-line AC) is acceptable in place of a full milestone doc.
- `docs/STATE.md` updates remain mandatory — even one line.
- `docs/gameplan.md` and `docs/tech.md` remain mandatory if they don't yet exist (otherwise the next session has no source of truth).
- ADRs may be deferred only if the change is _not_ a top-level architectural decision. Engine, language, and stack ADRs cannot be skipped.

The point is to compress the docs, not delete them. If the user wants no docs at all, that signals they want a different tool — say so honestly rather than running this skill in a degraded state.

# 2. Phases

## Idea Phase

The user has an idea for a game, but no codebase or documentation around it yet. Maybe there is concept art or some sort of lore they've come up with. In this phase, you should help the user brainstorm, develop, and iron out their game idea and gameplay loop.

## Pipeline

Refer to [this document](phase-pipelines/idea.md) for the idea phase pipeline. Follow it.

#### Requirements for Phase Completion

- [ ] `docs/` folder is created in the project directory
- [ ] `docs/gameplan.md` is written with detailed game information based on brainstorming and planning with the user
- [ ] `docs/tech.md` is written with detailed tech stack information, with the use of each library/framework included
- [ ] `docs/architectural-decisions/` folder exists with `0001-engine-and-stack.md` locking the engine, language, and art-style decisions

If the project directory has not been created yet, ask the user for permission to create a new project directory and write the folders/files there. Before moving to the next phase, ask the user to start a new session in the project directory so it becomes your CWD. Provide a resume prompt for the new session.

## Scaffold Phase

After the idea for the game has been solidified, help the user scaffold the project. The methods used to scaffold said project will depend on the tech stack used for the project.

## Pipeline

Refer to [this document](phase-pipelines/scaffold.md) for the scaffold phase pipeline. Follow it.

#### Requirements for Phase Completion

- [ ] Initial project files exist in the project directory
- [ ] Dependencies are installed
- [ ] Game boots in the browser (or the engine's play mode), the initial scene renders, and the console is error-free
- [ ] `AGENTS.md` and `CLAUDE.md` exist at the project root (see [agents-bootstrap sub-pipeline](sub-pipelines/agents-bootstrap.md))
- [ ] A future agent can run the project with one well-known command (`npm run dev`, engine equivalent) without further setup

"No compilation errors" alone is not sufficient — projects often build clean and crash on boot. The smoke test in [`scaffold.md`](phase-pipelines/scaffold.md) is mandatory before declaring this phase complete.

## Development Phase

This phase is the longest, and possibly never ending phase. The pipeline here is extremely important, and should be applied to any and all feature work in this project. If the user is asking you to fix a bug, you can defer this pipeline to quickly fix said bug and focus on bug fixing.

## Pipeline

Refer to [this document](phase-pipelines/development.md) for the development phase pipeline. Follow it.

There are no requirements for phase completion, as this is an active phase which possibly never ends, and the milestones within the pipeline document requirements and acceptance criteria.

# 3. Milestones

Within the development phase pipeline, you will use milestones as a source of truth for different large scoped tasks. These milestones live within `docs/milestones/*.md`.

Every milestone should include but not be limited to the following:

- Objective: The main goal of the milestone, with a detailed description of what the changes being made are.
- Scope: List of changes scoped to the task
- Acceptance Criteria: Checkbox list of sub-tasks within the milestone that must be verified and completed before the milestone can be marked as done.
- Exit Condition: The bottom line condition that must be verified by the user to have the milestone marked as complete.

You **MUST** ground all large changes in a milestone document, or ensure your changes are grounded in an existing milestone document. The only exceptions to this are small changes that would not require extreme planning, general bug fixes, or follow up changes that the user asks you to make, so long as they are within the scope of the milestone you're working on.

Small feature additions or changes that would not warrant a milestone may be deferred. If the changes would matter in the future, they must be documented in a milestone. You can revise milestone documents for cases like this.

At the end of implementation, you must ensure we keep milestone documentation updated and AC boxes checked off, otherwise future sessions will assume the milestones are incomplete, when they are complete. Ensure the user tests the exit condition of each milestone before moving on or marking as complete.

### Rules

1. Milestones must be ordered and each one must have the required sections listed above
2. Choose the smallest milestone set that explains delivery order
3. Put architecture enabling work before UX polish
4. If milestones depend on each other, it's important to mention the order in which they must be completed within the milestone documents

### Append vs spawn a new milestone

When new work surfaces during a session, decide whether to extend the current milestone or open a new one:

- **Append AC to the current milestone** when the work is in-scope refinement of the milestone's existing objective — clarifying behavior, tightening a check, splitting an existing AC into two checkable items.
- **Spawn a new milestone** when the work is out of scope for the current objective but related to the project — a new system, a new feature area, a refactor that enables future milestones. Use the `Depends on:` field in the new milestone's frontmatter to capture the ordering relationship.
- **Open a follow-up issue (no milestone)** when the work is small, isolated, and would never be planned ahead of time — a typo, a one-line fix, an obvious cleanup. These can ride on the current milestone if they're trivially adjacent.

When in doubt, prefer spawning a new milestone over inflating the current one. A bloated milestone hides progress and makes the exit condition harder to test.

# 4. Important Files

## `docs/gameplan.md`

The main source of truth around the game and idea of the game. Includes gameplay loop, rules, main game idea, art style, etc.

### When to read

At the start of every session. When reading through milestones. When gathering context about the game around the user's request.

### When to write

When the user wants to change how the game works, when rules change, etc. This is the main source of truth for how the game should work.

## `docs/tech.md`

The main source of truth on the tech stack.

### When to read

At the start of every session. When planning out milestones and architectural decisions.

### When to write

When adding new tech to the stack or changing out the core game engines/libraries/frameworks being used.

## `docs/milestones/*.md`

Detailed milestones for different features and tasks that eventually build the game.

### When to read

Prior to implementation. When users ask for you to perform changes to the codebase. Anytime you need relevant prior information to what's been done so far.

### When to write

When a user asks for new features, changes, etc. that have not yet been implemented in the codebase. When the user wants a full refactor to an older milestone, etc.

You should not have to update milestones once written unless there are explicit changes requested by the user, or if you are checking off acceptance criteria.

## `docs/architectural-decisions/*.md`

Detailed ADRs for different top-level architectural decisions. Use [`templates/adr.md`](templates/adr.md) when creating one. The first ADR (`0001`) should be created at the end of the idea phase to lock in engine / language / art-style decisions.

## `docs/backlog.md`

Single-file, append-only catalog of every feature, polish item, refactor, or open question the user has mentioned but that was deferred out of the session that captured it. The home for "later". Created from [`templates/backlog.md`](templates/backlog.md) the first time scope triage defers an item.

Promoted entries get a checkbox tick and a link to the milestone that absorbed them — they are not deleted. Rejected entries are struck through with a one-line reason. The history matters: future sessions need to see what was considered, when, and why it was deferred or rejected.

### When to read

- Before creating any new milestone (development pipeline step 2).
- During [scope-triage](sub-pipelines/scope-triage.md) step 2, to avoid duplicating items.
- During [session-start](sub-pipelines/session-start.md), to surface items the user may want to promote.
- When the user asks "what's next?" and the open milestones don't have an obvious answer.

### When to write

- Whenever scope triage defers an item.
- Whenever a feature/polish/refactor surfaces mid-session but is out of scope for the current milestone.
- Whenever the user mentions an idea in passing ("oh, eventually we should…"). Capture it immediately so it isn't lost.

## `docs/STATE.md`

Single-file session handoff. The previous session's last action, current milestone, and the next concrete step. Read first by the [session-start sub-pipeline](sub-pipelines/session-start.md), updated at the end of any session that made progress. Use [`templates/state.md`](templates/state.md).

### When to read

At the very start of every session in an existing project, before any other doc.

### When to write

At the end of any session that changed code, docs, or decisions. Even one line is better than nothing — the goal is continuity for the next session.

## `AGENTS.md` and `CLAUDE.md` (project root)

The cross-session, cross-tool enforcement file. `AGENTS.md` is read unconditionally by Cursor, Aider, Codex, Claude, and other agent tools at session start — a stronger guarantee than skill description matching. `CLAUDE.md` is a one-line pointer to `AGENTS.md` so the two files never drift.

Generated by the [agents-bootstrap sub-pipeline](sub-pipelines/agents-bootstrap.md) using [`templates/agents.md`](templates/agents.md).

### When to read

`AGENTS.md` is read by other agents — you don't need to read it during a normal `make-game` session because the source of truth lives in `docs/`. Read it when auditing for drift, when the user reports an outside agent ignored the rules, or before regenerating it.

### When to write

- End of the scaffold phase (mandatory).
- During the doc-backfill branch of [session-start](sub-pipelines/session-start.md), once `gameplan.md` and `tech.md` exist.
- After a top-level stack or architecture change — regenerate.
- When the [doc-drift audit](sub-pipelines/doc-drift-audit.md) flags `AGENTS.md` as stale.

Every architecture rule in `AGENTS.md` must also live in `docs/tech.md` or an ADR. `AGENTS.md` is a *reflection* of the source-of-truth docs, not its own source.

# 5. Templates

When creating any of the docs the skill mandates (`gameplan.md`, `tech.md`, milestones, ADRs, `STATE.md`), copy the structure from [`templates/`](templates/README.md) rather than improvising. Consistent structure across sessions is the highest-leverage anti-drift mechanism in this skill.

# 6. Sub-pipelines

These sub-pipelines can be used for individual steps during development, such as asset genration, lore building, gameplay loop building, research, etc.

Refer to [this document](sub-pipelines/README.md) to see all currently available sub-pipelines. Use them when necessary only if the task calls for it. Always refer to sub-pipelines to see if there's one available to use before starting your own pipeline of work.

# 7. Other Skills

It may be useful to install other skills to the project. There are many other skills in the `game-creator` Skill suite and plugin that can interlace with this skill.

Refer to [this document](useful-skills.md) to see skills you can install to the project directory that will help with development, planning, asset generation, etc based on what project you're working on.
