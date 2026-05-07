# Milestone <NN>: <Title>

## Status

<planned | in-progress | done>

## Objective

<One paragraph. What this milestone delivers and why it's being done now.>

## Scope

- <In-scope item>
- <In-scope item>

## Out of scope

- <Explicitly deferred item — write down what you considered but chose to leave out>

## Dependencies

- **Depends on:** <milestone NN, ADR NNNN, or "none">
- **Blocks:** <milestone NN, or "none">

## Acceptance criteria

> Every checkable AC must reference the test that proves it. Format: `- [ ] <AC> — test: <path/to/test.spec.js::test name>`. AC that can only be verified by user playtest (juice, feel, polish) must be tagged `— verified by user playtest` so the absence of an automated test is intentional, not an oversight.

- [ ] <Concrete, checkable AC> — test: `<path/to/test>::<test name>`
- [ ] <Concrete, checkable AC> — verified by user playtest

## Exit condition

<A single observable result a user can test. Format: "User does X → observes Y." If you can't write the exit condition this way, the milestone is not yet ready to start.>

## Test plan

<How the user (and you) will verify the exit condition. List the failing tests written up front (red-then-green), the manual playtest steps for any AC verified by user playtest, and the regression-suite command (e.g. `npm run test`) the next session should run before declaring the milestone done.>

## Notes

<Implementation notes, decisions made during the milestone, links to ADRs that govern this work. Update as the milestone progresses.>
