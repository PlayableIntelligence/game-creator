# Expression Wiring (meme-game workflow)

This file describes how `/meme-game` wires reactive expressions to game events for public-figure characters. The static technique reference — `EXPRESSION` constants, the spritesheet loading pattern, the `setExpression(expression, holdMs)` helper, the Bobblehead body Pattern (Container layering, body components, `CHARACTER` scaling constants, head positioning, idle breathing tween, clothing palette) — lives in **`game-assets/character-pipeline.md`**. Load that file as a reference and follow it for the foundational wiring code.

This file covers only what is specific to running the wiring pass on an existing game.

## When to apply

Applies to public-figure characters resolved in Tiers 1–4 (those with a 4-frame spritesheet). Tier 5 (pixel-art caricature) skips this entire flow — no spritesheet, no expression timer, just a regular pixel-art entity.

## Game-event → expression mapping

After loading `game-assets/character-pipeline.md`'s patterns, read `src/core/EventBus.js` and the scene files to find the closest semantic match for each public-figure character. There is no universal event list — every game has different event names. Pick from this template:

| Game event semantic | Expression | Notes |
|---|---|---|
| Score / collect / hit target | `HAPPY` | Positive feedback. Default 600ms hold. |
| Take damage / lose life / die | `ANGRY` | Visceral reaction. Default 600ms hold. |
| Power-up / streak / milestone | `SURPRISED` | Excitement. Use a longer hold (1000ms) so milestones linger. |
| Idle / default | `NORMAL` | Auto-revert after `EXPRESSION_HOLD_MS`. Don't wire — `setExpression` handles it. |

For named opponents/NPCs, mirror the player's reactions with inverted polarity:

| Game event | Opponent expression | Why |
|---|---|---|
| `OPPONENT_HIT` / opponent loses life | `ANGRY` | Frustrated |
| `OPPONENT_SCORES` / opponent succeeds | `HAPPY` | Gloating |
| Near-miss / close call | `SURPRISED` | Tension |

Use the `setExpression(expression, holdMs)` helper from `character-pipeline.md` — do not reinvent the timer logic.

## Idle revert behavior

After `EXPRESSION_HOLD_MS` (default 600ms) elapses post-expression-change, the head sprite reverts to `NORMAL`. Pass a longer `holdMs` for milestone events you want to linger on (e.g. `setExpression(EXPRESSION.SURPRISED, 1000)` for a streak milestone).

The revert is built into the helper — don't add extra timers in event handlers.

## Optional: Expression Map in design-brief.md

If `design-brief.md` exists at the project root, append (do not overwrite) an Expression Map section so future agents understand the wiring intent. Skip this if there is no `design-brief.md` — don't create one just for the Expression Map.

```markdown
## Expression Map (added by /meme-game)

### Player: <Name>
| Game Event | Expression | Hold (ms) |
|---|---|---|
| Idle/default | normal | — |
| Score / collect | happy | 600 |
| Damage / death | angry | 600 |
| Streak / milestone | surprised | 1000 |

### Opponent: <Name>
| Game Event | Expression | Hold (ms) |
|---|---|---|
| Idle/default | normal | — |
| Player scores | angry | 600 |
| Opponent scores | happy | 600 |
| Near-miss | surprised | 600 |
```

## Self-check before returning

- For each public-figure character, at least three game events are wired (one each for `HAPPY`, `ANGRY`, `SURPRISED` semantics).
- The `setExpression` helper is imported and used everywhere — no manual `setFrame()` calls in event handlers.
- The bobblehead body Container layering matches `character-pipeline.md` (arms behind body, body in middle, head sprite on top). A floating head with no body is a bug.
- `EXPRESSION_HOLD_MS` is in `Constants.js` and is referenced by name — no magic 600 in the code.
