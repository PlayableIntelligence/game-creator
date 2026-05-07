# State machine

Canonical pattern for any state-driven gameplay system: player controllers, enemy AI, UI screens, game flow, dialog systems.

## When to use

- Adding a system whose behavior depends on what mode or state it's in
- Refactoring a system that uses booleans (`isJumping && !isFalling && canMove`) to track state
- Adding a new state to an existing state-driven system

## Inputs

- The system being designed
- Any existing FSM utilities or libraries already in use in the project (`docs/tech.md`)

## Steps

1. **Check for an existing FSM convention in the project.** If one is already in use (XState, Unity Animator, custom enum-switch, behavior tree library), follow it. Do not introduce a second pattern in the same project — that's the drift you're trying to prevent.
2. **If no convention exists**, propose one to the user before coding. Default recommendations:
   - **Small systems** (3–5 states): typed enum + switch in an `update()` / tick.
   - **Medium systems** (5–10 states with side effects): explicit `State` interface with `enter` / `update` / `exit` methods.
   - **Large or branching systems** (parallel states, hierarchical states, AI): a real FSM library — XState in JS/TS, Unity Animator state machines, or behavior trees / GOAP for NPC AI.
3. **Define states and transitions in data, not control flow.** A list of `(from, event, to)` triples is far easier to reason about than nested ifs. This is what a future agent will read first.
4. **Forbid implicit state.** Booleans like `isJumping`, `isAttacking`, `isStunned` are a smell — they multiply combinatorially. If you find them, replace with a single state enum.
5. **Document the state graph.** A short markdown table or mermaid diagram in the system's milestone file or in `docs/systems/<system>.md`. Future agents will reach for this before reading code.
6. **Add at least one invalid-transition log.** When the state machine receives an event from a state that doesn't accept it, log it. This catches drift fast during playtests when new states are added without updating transitions.

## Outputs

- The system implemented as an FSM following the project's chosen pattern
- The state graph captured in docs (table or diagram)
- (If introducing a new convention) `docs/tech.md` updated to mention the FSM pattern in use

## Exit criteria

- All state for the system lives in a single named field, not scattered across booleans
- Every transition is a named event with a single source state and target state
- An agent reading only the state graph can predict behavior without reading the implementation
