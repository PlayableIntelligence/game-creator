# Milestone planning

Use this sub-pipeline when the user needs help deciding **which milestones to author next** based on the gap between `docs/gameplan.md` (where the game is going) and the current state (open milestones + the codebase + `docs/backlog.md`). Output: a small, ordered set of milestone proposals that the user can confirm before any files are written.

This is a distinct activity from [scope-triage](scope-triage.md):

- **Scope triage** narrows a single user request into one in-scope feature.
- **Milestone planning** looks across the whole project and proposes the next 1–3 milestones to add to `docs/milestones/`.

Both can run back-to-back: triage handles "what should this session do?", planning handles "what should the next several sessions do?".

## When to use

- The user asks "what milestones should we have next?" / "what's the roadmap from here?" / "what's left before we can ship?".
- All open milestones are complete (or only have polish AC remaining) and the project still doesn't satisfy the gameplan.
- The gameplan changed materially (new loop, new mode, new win condition) and existing milestones no longer cover the delta.
- A backlog item is large enough that it warrants being broken into several milestones rather than absorbed into one.
- During [doc-drift audit](doc-drift-audit.md) when the audit finds gameplan capabilities with no covering milestone.

Do **not** use this sub-pipeline for a single in-flight feature or a clear bug — those go through `development.md` directly.

## Inputs

- `docs/gameplan.md` (target state — the game the user actually wants to ship)
- `docs/milestones/` (every milestone, including done, in-progress, and planned)
- `docs/backlog.md` (deferred items and open questions)
- `docs/architectural-decisions/` (locked-in constraints — engine, language, art style, etc.)
- The codebase itself (what's actually been built, regardless of what AC says)

## Steps

**1. Restate the target state from the gameplan**

In your own words, list the gameplay capabilities `docs/gameplan.md` requires — the verbs in the core loop, the rules, the win/lose conditions, the player goals. Keep it short (one bullet per capability). This is the **target inventory**.

If a capability in the gameplan is vague enough that it can't be turned into a checkable AC ("combat should feel snappy"), flag it for the [playtest / repro](playtest-repro.md) sub-pipeline rather than trying to plan it as a milestone — vague targets produce vague milestones.

**2. Inventory current state**

Walk three sources and produce a flat list of what's covered:

- **Done milestones:** every milestone with all AC ticked. List the capability each delivered.
- **Open milestones:** for each, list the capabilities it *will* deliver when complete and the AC still outstanding. Spot-check the codebase — if an AC is unchecked but the code clearly satisfies it, note the drift; if the code is missing despite an AC being ticked, also note that.
- **Codebase reality:** capabilities that exist in code but aren't claimed by any milestone (common in projects that started outside the skill).

**3. Compute the gameplan delta**

Subtract step 2 from step 1. The remainder is the **delta**: gameplay capabilities the gameplan requires that no done or open milestone covers.

Cross-check the delta against `docs/backlog.md`. For each delta item:

- If the backlog already has an entry, link to it rather than restating.
- If the backlog has notes (constraints, dependencies, references), pull them in — they are the user's prior thinking and should not be re-litigated.
- If the delta is *not* in the backlog and *not* in any milestone, it's a brand-new gap.

**4. Slice the delta into milestone-sized pieces**

A good milestone has all of these properties:

- **One shippable capability.** A single thing the user can play and verify in a session. If the milestone needs multiple unrelated playtests to verify, it's two milestones.
- **A testable exit condition.** "User does X → observes Y." If you can't phrase the exit this way, the milestone isn't ready — the underlying capability needs more thought first (push to backlog "Open questions").
- **Sized to fit a focused session.** Roughly 1–3 live-iterate cycles of work. Bigger milestones hide progress; smaller milestones are usually ACs of a parent milestone, not standalone ones.
- **Independent of polish.** Polish (juice, particles, transitions, audio refinement) belongs in its own milestone or in `docs/backlog.md` "Polish & juice", not bundled with mechanics work.

If a delta item is too big, split it. If it's too small, group it with adjacent items into one milestone. The right grain is "the smallest thing that is independently meaningful to the player".

**5. Order by dependency and architecture-enabling first**

Apply these priority rules in order:

1. **Architecture-enabling work first.** State machines, save/load, multiplayer scaffolding, asset loading pipelines — anything later milestones will read from or build on. Do these before content or polish.
2. **Core loop second.** Until the player can play one full loop start-to-finish, nothing else matters. If the loop is already shippable, skip.
3. **Loop refinements third.** Difficulty, balancing, content depth — anything that makes the loop feel finished.
4. **Polish, audio, juice fourth.** Only after the loop is mechanically solid.
5. **Stretch and meta-features last.** Achievements, cosmetics, leaderboards, monetization integration, etc. These often live in `docs/backlog.md` permanently and only graduate to milestones once the user explicitly wants to ship them.

For each proposed milestone, write down:

- **Depends on:** earlier milestones or ADRs it requires.
- **Blocks:** later milestones that need it first.

If a proposed milestone depends on a decision the user hasn't made yet (engine extension, multiplayer transport, monetization model), surface that as an **open question** rather than guessing — open questions belong in the backlog, and the milestone waits.

**6. Right-size and sanity-check the proposal set**

Aim for **the next 1–3 milestones**, not the whole roadmap.

- More than 3 proposals at a time is hard for the user to reason about and almost always wrong on items 4+. Future milestones will look different once 1–3 are shipped — don't over-commit.
- Less than 1 proposal means there's nothing to plan; either the gameplan is satisfied (suggest the user update the gameplan, ship, or move to a stretch goal from the backlog) or you missed delta in step 3.

For each proposed milestone, draft (do not yet write to disk):

- Title (verb-led, short — e.g. "Player can wall-jump", not "Wall jump system").
- One-paragraph objective.
- 3–6 acceptance criteria (concrete, checkable; copy the shape from [`templates/milestone.md`](../templates/milestone.md)).
- Exit condition in "User does X → observes Y" form.
- Dependencies (`Depends on` / `Blocks`).
- Rough size: S / M / L (so the user can compare cost vs. value).

**7. Confirm with the user via `AskUserQuestion`**

Present the proposal as a multiple-choice question. Recommended option set:

- **Adopt the proposed set as-is** — write all proposed milestones in order.
- **Adopt only milestone NN-... first** — write just the first one, defer the rest until it ships.
- **Reorder or revise** — let the user move items, drop items, or pull in a backlog item that didn't make the cut.
- **Pick a different scope entirely** — escape hatch if the user disagrees with the gap analysis itself.

Show the user:

- The capability delta you computed in step 3 (so they can challenge it).
- The runners-up from the backlog you considered but didn't propose (so nothing visibly disappeared).

**8. Write the confirmed milestones to `docs/milestones/`**

Only after the user confirms:

- Use [`templates/milestone.md`](../templates/milestone.md) for each file.
- Number them sequentially after the highest existing milestone (`05-...`, `06-...`, etc.); never reuse numbers.
- Set `Status: planned`.
- Fill in **every** section — empty `Test plan` and `Out of scope` sections invite drift later.
- Tick promoted backlog items in `docs/backlog.md` and append `→ milestone NN-<slug>.md`.
- Update `docs/STATE.md` with the new "next milestone" pointer.

If a milestone you proposed depends on an unresolved open question, write the milestone with `Status: blocked` and a clear `Blockers` note rather than starting it. The user must resolve the question before it leaves `blocked`.

**9. Hand back to the development pipeline**

The first proposed milestone now becomes the active scope. Return to [`development.md`](../phase-pipelines/development.md) step 1 with that milestone — do not start coding inside this sub-pipeline.

## Outputs

- 1–3 new milestone documents in `docs/milestones/`, in dependency order, all sections filled.
- `docs/backlog.md` updated: promoted items ticked with milestone links; nothing silently removed.
- `docs/STATE.md` updated: next-milestone pointer reflects the new state.
- A clear "why these, why now, why in this order" justification, written into each milestone's Objective section and confirmed by the user.

## Exit criteria

- The proposed set covers the most pressing gameplan delta the user agreed to address now.
- Each milestone has a testable exit condition and is independently shippable.
- Dependencies form a DAG, not a cycle.
- The user has explicitly approved the order and scope.
- The next active milestone is unambiguous and pointed to from `docs/STATE.md`.

## Anti-patterns to avoid

- **Roadmap padding.** Proposing 6+ milestones to look thorough. Future you will rewrite items 4+ once 1–3 ship; the planning effort is wasted.
- **Mechanics-and-polish bundles.** "Implement combat *and* add hit feedback" is two milestones. Polish always slips, and bundling it makes the mechanic milestone look incomplete.
- **Architecture-enabling milestones with no consumer.** If a state machine or asset pipeline isn't consumed by an *immediately* following milestone, it's speculative — defer it to the backlog with a `Why:` note.
- **Skipping the gameplan re-read.** If you don't restate the target state in step 1, the proposal is just a re-shuffle of the backlog. The gameplan is what makes planning purposeful.
- **Inventing scope the user didn't ask for.** This sub-pipeline turns *existing* gameplan + backlog content into milestones. New gameplay ideas come from the user; if you find yourself wanting to propose one, write it to the backlog and surface it as an open question instead.
- **Writing files before confirmation.** The proposal is a draft until step 7 succeeds. Files written prematurely create churn if the user rejects the plan.
