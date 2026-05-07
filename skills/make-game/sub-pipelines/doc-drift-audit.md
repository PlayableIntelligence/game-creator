# Doc drift audit

Verify the `docs/` folder still reflects what the code actually does. Run periodically, or when the user asks "is anything stale?".

## When to use

- After several milestones have closed without a doc review
- Before starting major feature work where you need to trust the docs
- The user reports the docs feel out of date
- Before pitching the game externally or onboarding a collaborator

## Inputs

- All of `docs/`
- The current codebase

## Steps

1. **Cross-check `docs/gameplan.md` rules vs code.** Pick each rule in the gameplan. Find where it's enforced in code. Flag any rule with no enforcement, and any rule in code with no doc.
2. **Cross-check `docs/tech.md` vs the actual stack.** Read package manifests / project files. Flag any library used in code but missing from `tech.md`, and any library in `tech.md` no longer in use.
3. **Audit milestones.**
   - Any milestone with all AC checked but exit condition unverified → flag.
   - Any milestone marked open where the work appears done in code → flag.
   - Any milestone older than the current one with no progress → flag for cancellation or revision.
4. **Audit ADRs.** For each ADR, find the code it governs. If the code now violates the ADR, either the ADR is wrong or the code is. Flag, do not silently reconcile.
5. **Cross-check `AGENTS.md` against `tech.md` and the codebase.** Confirm:
   - Engine, language, and platform fields match `tech.md`.
   - Stack-specific commands (dev, test, build, lint) match the project's actual scripts/targets.
   - Architecture rules listed in `AGENTS.md` are still in force in the code.
   - The "Last regenerated" date is not absurdly old relative to the most recent stack ADR.

   If `AGENTS.md` is missing entirely on a project past the idea phase, flag it as a top-priority drift item and recommend running the [agents-bootstrap sub-pipeline](agents-bootstrap.md).
6. **Write a drift report** to the user. Group findings as:
   - **Stale** — doc is behind code
   - **Aspirational** — doc is ahead of code
   - **Contradiction** — doc and code actively disagree
7. **Get user direction on each finding before editing docs.** Drift resolution is opinionated — the agent does not silently rewrite history.

## Outputs

- A drift report (delivered in chat, or written to `docs/drift-report-<YYYY-MM-DD>.md` if the user wants it persisted)
- Doc edits, only after user direction

## Exit criteria

- Every drift finding has a user decision: fix doc, fix code, or accept
- (Optional) Docs marked "current as of `<date>`" if the user wants that signal
