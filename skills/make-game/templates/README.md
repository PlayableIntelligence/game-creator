# Templates

Skeletons for the documents the make-games skill mandates. Copy these when creating new docs — do not improvise structure. Consistent structure across sessions is the single highest-leverage anti-drift mechanism.

## When to use which

| Template | Lives at | Created during |
|----------|----------|----------------|
| [`gameplan.md`](gameplan.md) | `docs/gameplan.md` | Idea phase |
| [`tech.md`](tech.md) | `docs/tech.md` | Idea phase |
| [`milestone.md`](milestone.md) | `docs/milestones/<NN>-<slug>.md` | Per milestone |
| [`adr.md`](adr.md) | `docs/architectural-decisions/<NNNN>-<slug>.md` | Per architectural decision |
| [`state.md`](state.md) | `docs/STATE.md` | First time you make session-level progress |
| [`backlog.md`](backlog.md) | `docs/backlog.md` | First time [scope-triage](../sub-pipelines/scope-triage.md) defers an item, or first time the user mentions a deferred idea |
| [`agents.md`](agents.md) | `AGENTS.md` (project root) | End of scaffold phase — see [agents-bootstrap sub-pipeline](../sub-pipelines/agents-bootstrap.md) |

## Naming

- **Milestones:** zero-padded number prefix (`01-core-loop.md`, `02-combat.md`). Order is meaningful — milestones are intended to be completed in order unless dependencies say otherwise.
- **ADRs:** four-digit number prefix (`0001-engine-choice.md`, `0002-state-machine-pattern.md`). Numbers are never reused, never reordered. Superseded ADRs stay with `Status: superseded by ADR-NNNN`.

## When to write the first ADR

The very first ADR (`0001`) should be written at the end of the idea phase and capture the engine / language / art-style decisions. Locking those in early prevents the most common form of cross-session drift.
