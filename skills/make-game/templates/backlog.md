# Backlog

> Out-of-scope ideas, feature requests, and follow-ups captured during sessions but **not** worked on in the session that captured them. Read at the start of every milestone-creation conversation. Append-only — promoted items get a checkbox tick and a link to the milestone that absorbed them, not a deletion.
>
> If an item turns out to be wrong / no longer wanted, mark it `~~struck through~~` with a one-line reason rather than removing it; future sessions need to see that it was considered and rejected.

## How to write a backlog entry

Each entry is a bullet under one of the sections below with this shape:

```
- [ ] <short title> — <one-sentence description of the desired behavior or change>
  - Source: <session date or user message that introduced it>
  - Rough size: <S | M | L> · Rough value: <S | M | L>
  - Notes: <optional — constraints, dependencies, related milestones, references>
```

Keep titles short enough to scan in one pass. Put the detail in the description and notes.

When an entry is **promoted into a milestone**, replace `[ ]` with `[x]` and append `→ milestone NN-<slug>.md` so the trail is preserved.

When an entry is **rejected**, wrap the title in `~~strikethrough~~` and add a one-line `Rejected: <reason>` note.

## Gameplay & features

<append new ideas here — gameplay loops, mechanics, modes, levels, characters, content>

## Polish & juice

<visual polish, particles, transitions, screen shake, audio cues that aren't load-bearing for the loop>

## Tech & refactors

<refactors, architecture clean-up, dependency upgrades, perf work that isn't a current bottleneck>

## Tooling & QA

<test coverage, dev ergonomics, CI, debugging affordances>

## Open questions

<things the user hasn't decided yet — design questions, scoping questions, monetization questions. Not features, but things that need an answer before related features can be planned.>
