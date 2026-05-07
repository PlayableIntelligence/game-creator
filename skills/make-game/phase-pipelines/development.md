# Development phase

The longest, possibly never-ending phase. The pipeline below applies to **every** feature addition, change, or refactor while the project is in this phase.

For unambiguous bug fixes, defer to the focused [bug-fix sub-pipeline](../sub-pipelines/bug-fix.md) rather than running this full pipeline. For vague gameplay feedback ("feels floaty", "combat is boring"), run [playtest / repro](../sub-pipelines/playtest-repro.md) first to convert it into a checkable AC.

## When to use

- Project has source files and dependencies installed (development phase confirmed by [session-start](../sub-pipelines/session-start.md))
- The user has asked for a feature, change, or improvement
- An open milestone has unchecked acceptance criteria

## Inputs

- `docs/STATE.md` (last session handoff)
- `docs/gameplan.md` (gameplay source of truth)
- `docs/tech.md` (stack source of truth)
- `docs/milestones/` (current and pending milestones)
- `docs/backlog.md` (deferred features and open questions from past sessions)
- The user's request, however phrased

## Steps

**1. Ground the task or feature**

- Read relevant `docs/gameplan.md` and `docs/tech.md` sections.
- Read `docs/backlog.md` (or note that it doesn't exist yet). Items relevant to the current request should be linked from — not duplicated by — the new milestone.
- Identify whether the task belongs to an existing milestone in `docs/milestones/`.
- Identify whether the task deliberately deviates from existing ADRs.
- Identify whether the task changes core gameplay, the gameplay loop, rules, or state-machine contracts.

**1a. Triage scope before going further**

If the user's request implies more than one independent feature, change, or "while you're in there" addition — or if it is open-ended brainstorming — run the [scope-triage sub-pipeline](../sub-pipelines/scope-triage.md) **now**, before step 2. The output is exactly one chosen feature plus a `docs/backlog.md` updated with everything else. The rest of this pipeline operates on that single chosen feature.

If the request is already a single, scoped feature that fits the current milestone, skip to step 2.

**2. Update relevant documentation before coding**

If the task introduces new scope:

- Add or revise milestone acceptance criteria in `docs/milestones/`. Use the **append vs spawn** rule from `SKILL.md` §3.
- Add or revise gameloop / rules in `docs/gameplan.md`.
- Add or revise stack changes in `docs/tech.md`.
- Add an ADR in `docs/architectural-decisions/` for any top-level architectural change.
- If `docs/backlog.md` items influenced (or were promoted into) this milestone, tick their checkboxes and append `→ milestone NN-<slug>.md`. The trail must be preserved, not deleted.

If the work does not fit an existing milestone, create a new milestone document **before** coding. **Re-read `docs/backlog.md` first** so you don't duplicate or contradict deferred items. If you're authoring more than one milestone in this step, or the user has asked for a roadmap rather than a single feature, switch to the [milestone-planning sub-pipeline](../sub-pipelines/milestone-planning.md) — it handles gameplan-delta analysis, dependency ordering, and proposal confirmation so the milestones you write actually move the gameplan forward. If the user has invoked minimum-viable doc mode (`SKILL.md` §1), at least add a one-line milestone entry — never skip the doc step entirely.

**3. Write failing tests first**

Before changing implementation code, **write the tests that will prove the milestone's acceptance criteria are satisfied — and watch them fail.** Tests are the executable form of AC; if a piece of AC has no corresponding test, it isn't really checkable. The work for this step is "done" when:

- Every checkable AC for the active milestone has at least one test that asserts it.
- Each new test runs and **fails for the right reason** (asserts the missing behavior, not a typo, missing file, or unrelated error). Run the test suite and inspect the failure message — a green-from-the-start test or a test that fails with `ModuleNotFoundError` is a bug in the test, not a baseline.
- The failing tests are committed (or at least staged) so the red-to-green transition is visible in diff history.

What to write where:

- **Gameplay logic, state transitions, scoring, collision rules, win/lose conditions** → Playwright tests using the patterns in `/qa-game` (the `game-test` fixture, `render_game_to_text()` for state assertions, `advanceTime()` / `page.clock` for deterministic timing). These are the default and cover almost everything.
- **Pure functions that don't depend on the game runtime** (math helpers, formatters, RNG wrappers) → unit tests next to the source if the project already has a unit test runner. Don't introduce a new test framework just for one helper.
- **Visual-only changes** (palette tweaks, particle counts, juice, transitions) → a Playwright screenshot test that captures the *current* baseline before the change, then a second assertion that the post-change screenshot differs (or matches a reviewed new baseline). For polish where "differs" isn't a meaningful assertion, fall back to live-iterate (step 5) and **explicitly note in the milestone that the AC is verified by user playtest, not automated test** — do not silently skip the test step.
- **Multiplayer behavior** → tests that boot two clients via Playwright and assert state convergence. The `add-multiplayer` skill has scaffolding patterns.

If the milestone AC is too vague to write a test against ("combat should feel snappy", "menus should be polished"), stop and run [playtest / repro](../sub-pipelines/playtest-repro.md) to convert the AC into something checkable before continuing.

If the project has no test harness yet, run `/qa-game` to set one up before writing the milestone's first test — do not hand-roll Playwright config when the skill exists.

**4. Implement the smallest correct change**

- Implement only behavior outlined by the relevant milestone — the goal is to turn the failing tests from step 3 green.
- Avoid introducing top-level architecture changes without consulting the user first and updating docs.
- Preserve game rules captured in `docs/gameplan.md`.
- If blocked, surface possible unblock paths to the user rather than guessing.
- Run the test suite frequently. The transition from red → green on the AC tests is the primary signal that the implementation is on track. If a test goes green before you intended (because something else covered it), inspect — do not assume the milestone is done.
- Do not edit a failing test to make it pass unless the test itself is wrong. If you find yourself loosening assertions, the implementation is still incomplete or the AC needs to change first (update the milestone, not the test).

**Task → slash command quick reference.** Match the work to an installed user-invocable skill rather than improvising. See [`useful-skills.md`](../useful-skills.md) for the full menu.

| Task class | Slash command / sub-pipeline |
|---|---|
| New gameplay feature following existing patterns | `/add-feature` |
| Replace shapes with pixel art | `/add-assets` |
| Replace primitives with GLB models | `/add-3d-assets` |
| Generate custom 3D models | `/meshyai` |
| Add procedural BGM/SFX | `/add-audio` |
| Visual polish, juice, transitions | `/design-game` |
| Add/extend Playwright tests | `/qa-game` |
| Real-time or turn-based multiplayer | `/add-multiplayer` |
| Holistic audit + improvements | `/improve-game` |
| Read-only architecture review | `/review-game` |
| Add gateable features (skins, continue, etc.) | `/scaffold-gateables` |
| Wire monetization (Play.fun) | `/monetize-game` |
| Deploy a build | `/game-deploy` |
| Record a promo video | `/record-promo` |
| Fix a clear, scoped bug | [`bug-fix.md`](../sub-pipelines/bug-fix.md) |
| Convert vague feedback into AC | [`playtest-repro.md`](../sub-pipelines/playtest-repro.md) |
| Design a state-driven system | [`state-machine.md`](../sub-pipelines/state-machine.md) |
| Add or organize assets | [`asset-pipeline.md`](../sub-pipelines/asset-pipeline.md) |

**5. Live iterate (mandatory after every code change)**

Run the [live-iterate sub-pipeline](../sub-pipelines/live-iterate.md). Do not skip — a change is not "done" until it has been verified through the live loop. This is the primary mechanism for tight, real-time feedback with the user. Live-iterate complements the automated tests from step 3: tests prove the AC; live-iterate catches the things tests can't see (feel, juice, surprise interactions, console warnings, regressions in adjacent features).

**6. Verify against the milestone**

Before considering the task complete:

- All AC tests written in step 3 are green. Run the full suite, not just the new tests — confirm no regressions.
- Milestone docs reflect the new state, with AC checkboxes ticked off. Each ticked AC should reference the test that covers it (or be explicitly marked "verified by user playtest" if it's a visual/feel AC).
- Any deliberate deviations are documented and were called out to the user.
- The exit condition is testable by the user (or has been tested live during step 5).

**7. Hand back to the user**

If the change includes visual or logical behavior the user can experience, give them clear, ordered testing instructions — one workflow at a time. Pair this with the screenshot or state snapshot from step 5 so they have something concrete to compare against. Use `AskUserQuestion` when the next decision is multiple choice. Mention which AC are now covered by automated tests so the user knows which behaviors are protected from regression and which still rely on manual playtest.

If the user surfaces new feature ideas or adjacent improvements during this hand-back ("oh, while we're at it, can you also…"), do **not** silently bundle them into the current session. Append them to `docs/backlog.md` immediately, then run scope triage at the start of the next session. The current session ends when its single feature is verified.

**8. Update `docs/STATE.md`**

Even one-line updates are better than nothing. Capture last action, current milestone, next step, and any blockers.

## Outputs

- New tests committed (red → green) covering every checkable AC for the milestone
- Code change scoped to the milestone
- Full test suite passing, no regressions
- Updated milestone (AC ticked, each tick referencing the test that covers it)
- Live-iterate verdict (state snapshot or screenshot)
- Updated `docs/STATE.md`

## Exit criteria

- The change satisfies the milestone AC the user agreed to (or the user has explicitly accepted a deviation).
- Every checkable AC has a corresponding green test; AC verified by user playtest are explicitly marked as such in the milestone.
- Full test suite green; console is error-free; no adjacent regressions surfaced in step 5.
- `docs/STATE.md` reflects the new state.
- The user has clear next-step testing instructions and knows which behaviors are now regression-protected.

## Figuring out what to work on next

When the user asks "what's next?":

1. Open milestone docs in `docs/milestones/`.
2. Pick the earliest milestone with incomplete acceptance criteria.
3. Within the milestone, choose the smallest missing requirement that unlocks later work.
4. Cross-check against the codebase. If AC has drifted from reality, update the AC and return to step 2.
5. If all open milestones are complete (or only have polish AC remaining) **and** `docs/gameplan.md` is not yet satisfied, hand off to the [milestone-planning sub-pipeline](../sub-pipelines/milestone-planning.md) to derive the next 1–3 milestones from the gameplan delta + backlog. Do not invent scope here.
6. If `docs/gameplan.md` *is* satisfied (loop, rules, win/lose, player goals all delivered), surface the highest value × ease item from `docs/backlog.md` via `AskUserQuestion` and ask the user whether it should be promoted into a stretch milestone or whether the gameplan itself needs to grow.

Priority rules:

- First, incomplete milestone acceptance criteria.
- Then, architecture-enabling work.
- Then, gaps that unblock core gameplay loops.
- Then, milestones derived from the gameplan delta via [milestone planning](../sub-pipelines/milestone-planning.md).
- Then, the best value × ease item from `docs/backlog.md`.
- Defer polish unless it closes a milestone exit condition.

Always present the chosen next step to the user via `AskUserQuestion` with one or two backlog runners-up as alternatives, so the user owns priority.
