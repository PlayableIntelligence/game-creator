# Bug fix

A focused pipeline for fixing reported bugs. Use this instead of the full development phase pipeline only when the bug is unambiguous and small in scope.

## When to use

- The user reports unexpected behavior
- A test or playtest surfaced a regression
- An exception or crash is reproducible

## Inputs

- A bug description from the user (may be vague)
- Access to the relevant code

## Steps

1. **Get a repro.** If the description is vague, run the [Playtest / repro](playtest-repro.md) sub-pipeline first. Do not start fixing until you can describe the bug as: `given <state>, doing <action> produces <wrong result> instead of <right result>`.
2. **Locate the smallest scope of the bug.** Read the relevant module(s). Do not refactor surrounding code on the way through.
3. **Confirm root cause before changing code.** Especially for timing, physics, and state bugs, the visible symptom is often distant from the cause. State your hypothesis to the user first.
4. **Apply the minimal change.** No collateral cleanup. No new abstractions. No "while I'm here" edits.
5. **Verify the repro is gone.** Run the exact repro steps from step 1. If you cannot run them yourself, give the user a clear set of steps to run.
6. **Regression check.** Look at code that touches the same state or system and confirm you haven't broken it. If a test exists for the affected behavior, run it.
7. **Decide if a milestone update is needed.** Most bug fixes do not warrant milestone changes. If the bug reveals a flawed AC or a missing exit condition in an existing milestone, update that milestone.

## Outputs

- A code change scoped to the bug
- (Optional) A new regression test if the system already has tests
- (Optional) An updated milestone AC if the bug exposed a documentation gap

## Exit criteria

- The original repro no longer reproduces
- No adjacent behavior is broken
- The user has been told what to test
