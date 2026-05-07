# Scope triage

Use this sub-pipeline whenever the user's request would balloon a single session's scope: a multi-feature dump ("add inventory, crafting, and a shop"), a vague ambition ("make combat feel better, add bosses, and balance the early game"), or a bug fix that keeps growing into adjacent features. The job is to land on **one focused next step**, write everything else into the backlog, and confirm the choice with the user before touching code.

Sessions that try to carry two or more independent features at once cause:

- **Context drift** — the agent loses track of which file change belongs to which feature.
- **Iteration paralysis** — the user can't tell which feature broke when the live-iterate loop fails.
- **Doc drift** — milestones get half-completed and AC checkboxes lie about the state of the code.

Narrow scope per session is the cheapest defense.

## When to use

- The user's request mentions more than one independent feature or change.
- The user is brainstorming open-endedly ("here's a bunch of stuff I want to do").
- The current milestone's AC is still open but the user is asking for something orthogonal.
- A bug fix has surfaced adjacent improvements the user wants "while you're in there".
- During milestone creation in the [development pipeline](../phase-pipelines/development.md) step 2.

Skip this sub-pipeline only when the request is already a single, scoped feature that fits the current milestone.

## Inputs

- The user's full request (read it carefully — list every distinct feature or change it implies)
- `docs/STATE.md` (current phase, current milestone, next AC)
- `docs/milestones/` (open milestones and their AC)
- `docs/backlog.md` (existing deferred items — must not be duplicated)
- `docs/gameplan.md` (so the prioritization is grounded in the actual game)

## Steps

**1. Enumerate every distinct ask**

Restate the user's request as a flat, numbered list of independent features or changes — one bullet per thing that could ship on its own. Resist combining items "because they're related"; the point is to make hidden scope visible.

If two items truly cannot be tested independently (e.g. "add a weapon slot" and "add a weapon"), call that out explicitly and treat them as one.

**2. Cross-check against the backlog and open milestones**

For each item:

- If it already exists in `docs/backlog.md`, link to that entry rather than re-listing.
- If it's already covered by an open milestone's AC, point at that AC.
- If it's brand new, it's a backlog candidate.

This step prevents the backlog from accumulating duplicates and surfaces items that were already deferred in a previous session.

**3. Score each new item on value × ease**

Tag each new item with rough **value** (S / M / L: how much it moves the game forward toward the gameplan) and rough **ease** (S / M / L: how cheap it is to implement and verify). These are gut estimates, not formal estimates — the goal is to make the trade-off legible to the user.

**4. Recommend the single next feature**

Pick the one item with the best balance of **important enough to matter** and **easy enough to ship in one focused session**. Bias toward:

- Items that unblock later work (architecture-enabling > polish).
- Items that close out the current milestone's exit condition.
- Items the user can verify in 30 seconds via `live-iterate`.

Avoid:

- Items requiring a top-level architecture change without an ADR conversation first.
- Items that span multiple systems and would need parallel changes in art, audio, and gameplay code in one go.
- Items the user hasn't decided the design of yet (push those to "Open questions" in the backlog).

**5. Write the deferred items to `docs/backlog.md`**

For every other item, append an entry to `docs/backlog.md` under the appropriate section using the shape from [`templates/backlog.md`](../templates/backlog.md). Include:

- Short title and one-sentence description
- Source (today's date and a phrase from the user's message)
- Rough size and value tags from step 3
- Notes (constraints, dependencies, references the user mentioned)

If `docs/backlog.md` does not exist yet, create it from the template now.

**6. Confirm with the user via `AskUserQuestion`**

Present the recommendation as a multiple-choice question with at least these options:

- **Recommended:** the single feature you chose, with a one-line "why this one first" justification.
- **Pick a different deferred item:** list 2–3 of the runners-up so the user can override.
- **All-in:** acknowledge the user can ask to bundle items, but warn explicitly that the session will lose focus and live-iterate verification will be harder. Only take this path if the user insists.

Show the user the deferred-items list you wrote to the backlog so they can sanity-check that nothing was lost.

**7. Promote the chosen item into the milestone flow**

Once the user confirms:

- If the chosen item fits an existing open milestone, append AC to that milestone (use the **append vs spawn** rule from `SKILL.md` §3).
- If it doesn't fit, spawn a new milestone using [`templates/milestone.md`](../templates/milestone.md).
- If the chosen item is large enough to span more than one milestone (multi-system feature, new mode, big refactor), hand off to the [milestone-planning sub-pipeline](milestone-planning.md) to slice it into ordered milestones rather than authoring one mega-milestone.
- Either way, return to [`development.md`](../phase-pipelines/development.md) step 3 with that single feature as the scope.

Do not start coding until this step is done — the milestone is what gives live-iterate something to verify against.

## Outputs

- `docs/backlog.md` updated with every deferred item (created if it didn't exist)
- A single chosen feature, confirmed by the user, written into a milestone
- A clear "why this one first" justification logged in the milestone's Objective section
- Runners-up still discoverable in the backlog for future sessions

## Exit criteria

- Exactly one feature is in scope for the rest of the session.
- Every other item from the user's request is in `docs/backlog.md` (or already linked from there).
- The user has confirmed the chosen scope.
- The next step is a concrete AC inside a real milestone document.

## Anti-patterns to avoid

- **Silently dropping items.** If the user mentioned five features and you only address one without writing the other four to the backlog, the user has to remember them — that's a recipe for the same dump landing again next session.
- **Calling everything "small enough to bundle".** Two features in one session is already a smell. Three is almost always wrong.
- **Skipping the user confirmation.** The recommendation is a *proposal*, not a unilateral decision. The user owns priority.
- **Treating the backlog as a graveyard.** Backlog entries must be re-read at the start of every milestone-creation conversation (step 2). If items rot for many sessions in a row, ask the user whether they should be rejected (struck through with a reason) rather than living forever.
