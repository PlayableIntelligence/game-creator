# Expression Wiring & Bobblehead Body Pattern

This file describes how to wire reactive expressions to game events and how to pair photo-composite heads with cartoon bodies. Applies to characters resolved in Tiers 1–4 (those with a 4-frame spritesheet). Tier 5 (pixel-art caricature) skips this entire flow.

## Expression constants

Add to `Constants.js`:

```js
export const EXPRESSION = {
  NORMAL: 0,
  HAPPY: 1,
  ANGRY: 2,
  SURPRISED: 3,
};

export const EXPRESSION_HOLD_MS = 600;
```

The frame indices are stable across the entire `assets/characters/` library — every spritesheet uses the same order.

## Loading the spritesheet

In the Phaser preloader (typically `BootScene.js` or `GameScene.preload()`):

```js
preload() {
  this.load.spritesheet('trump', 'assets/characters/trump/spritesheet.png', {
    frameWidth: 200,
    frameHeight: 300,
  });
}
```

## Expression-hold pattern

Every reactive expression is held for `EXPRESSION_HOLD_MS` and then reverts to `NORMAL`. Implement on the entity:

```js
setExpression(expression, holdMs = EXPRESSION_HOLD_MS) {
  this.headSprite.setFrame(expression);
  if (this.expressionTimer) this.expressionTimer.remove();
  if (expression !== EXPRESSION.NORMAL) {
    this.expressionTimer = this.scene.time.delayedCall(holdMs, () => {
      this.headSprite.setFrame(EXPRESSION.NORMAL);
    });
  }
}
```

Use `headSprite.setFrame()` (not `sprite.setFrame()`) once the bobblehead body is in place — the head is a child sprite of the character Container, not the root.

## Event → expression mapping

Wire in the entity's constructor (or in the scene's `create()` for shared events):

```js
// Player reactions
eventBus.on(Events.SCORE_CHANGED, () => {
  player.setExpression(EXPRESSION.HAPPY);
});
eventBus.on(Events.PLAYER_DAMAGED, () => {
  player.setExpression(EXPRESSION.ANGRY);
});
eventBus.on(Events.SPECTACLE_STREAK, ({ streak }) => {
  player.setExpression(EXPRESSION.SURPRISED, 1000);  // longer hold for milestones
});

// Opponent reactions (for named opponents/NPCs)
eventBus.on(Events.OPPONENT_HIT, ({ id }) => {
  opponents[id].setExpression(EXPRESSION.ANGRY);
});
eventBus.on(Events.OPPONENT_SCORES, ({ id }) => {
  opponents[id].setExpression(EXPRESSION.HAPPY);
});
```

The exact event names depend on the game. Read `src/core/EventBus.js` and pick the closest semantic match. Common patterns:

| Game event | Player expression | Why |
|---|---|---|
| Score / collect / hit target | HAPPY | Positive feedback |
| Take damage / lose life / die | ANGRY | Visceral reaction |
| Power-up / streak / milestone | SURPRISED | Excitement |
| Idle / default | NORMAL | Resting state (auto-revert) |

## Bobblehead body pattern

**Never display a floating head sprite alone.** Always pair the photo-composite head with a South Park-style cartoon body drawn in Phaser Graphics. The bobblehead aesthetic (giant photo head on a tiny cartoon body) is the signature look — and it scales cleanly to any device because the body is vector, not pixel.

### Architecture

The character is a Phaser `Container` holding:
- Two `Graphics` objects for arms (separately animatable)
- One `Graphics` object for the body (shoes/legs/torso/neck)
- One `Sprite` for the photo-composite head, layered on top

```js
this.container.add([
  this.leftArmGfx,    // Layer 0: behind body
  this.rightArmGfx,   // Layer 1: behind body
  this.bodyGfx,       // Layer 2: middle (shoes, legs, torso, neck)
  this.headSprite,    // Layer 3: on top (photo-composite head)
]);
```

### Body components (drawn bottom-to-top)

1. **Shoes** — rounded rectangles at the bottom
2. **Legs (pants)** — two rounded rectangles with gap between
3. **Torso (jacket/shirt)** — trapezoidal polygon, wider shoulders, narrower waist
4. **Jacket detail** — lighter panel for depth, lapels on each side
5. **Shirt/collar V** — V-shape at neckline
6. **Tie** (optional) — knot + blade tapering down
7. **Buttons** — small circles on jacket front
8. **Neck** — rounded rectangle, skin-colored, connects body to head

### Arms (separate Graphics for animation)

1. **Upper arm (sleeve)** — rounded rectangle in jacket color
2. **Shirt cuff** — thin lighter rectangle
3. **Hand (mitten)** — rounded rectangle in skin color, no fingers (South Park convention)

### Scaling system

All dimensions derive from a single base unit `U`:

```js
const _U = GAME.WIDTH * 0.012;

export const CHARACTER = {
  U: _U,
  TORSO_H: _U * 5,
  SHOULDER_W: _U * 7,
  WAIST_W: _U * 5,
  NECK_W: _U * 2.5,
  NECK_H: _U * 1,
  HEAD_H: GAME.WIDTH * 0.25,   // Derive from WIDTH (not HEIGHT) to stay proportional in mobile portrait
  FRAME_W: 200,                // Spritesheet frame dimensions
  FRAME_H: 300,
  UPPER_ARM_W: _U * 1.8,
  UPPER_ARM_H: _U * 3,
  HAND_W: _U * 1.8,
  HAND_H: _U * 1.5,
  LEG_W: _U * 2.4,
  LEG_H: _U * 3,
  LEG_GAP: _U * 1.2,
  SHOE_W: _U * 3,
  SHOE_H: _U * 1.2,
  TIE_W: _U * 1,
  BUTTON_R: _U * 0.3,
  OUTLINE: Math.max(1, Math.round(_U * 0.3)),
};
```

### Head positioning

```js
const headY = -C.TORSO_H * 0.5 - C.NECK_H - C.HEAD_H * 0.35;
this.headSprite = scene.add.sprite(0, headY, sheetKey, EXPRESSION.NORMAL);
const headScale = C.HEAD_H / C.FRAME_H;
this.headSprite.setScale(headScale);
```

### Idle breathing tween (adds life)

```js
scene.tweens.add({
  targets: this.container,
  y: y - 2 * PX,
  duration: 1400 + Math.random() * 400,
  yoyo: true,
  repeat: -1,
  ease: 'Sine.easeInOut',
});
```

### Per-character clothing palette

Customize the body Graphics colors per character:

- **Suit characters** (executives, politicians): dark navy/charcoal suit, white shirt, themed tie color
- **Casual characters**: t-shirt as a single torso color, skip jacket detail/lapels/tie
- **Branded characters**: incorporate brand colors

See `examples/trump-mog/src/entities/Character.js` for a complete reference implementation if it exists in this repo.

## Optional: Expression Map in design-brief.md

If `design-brief.md` exists at the project root, append (don't overwrite) an Expression Map section so future agents understand the wiring intent:

```markdown
## Expression Map (added by /meme-game)

### Player: <Name>
| Game Event | Expression | Why |
|---|---|---|
| Idle/default | normal | Resting |
| Score / collect | happy | Positive feedback |
| Damage / death | angry | Visceral reaction |
| Streak / milestone | surprised | Excitement |

### Opponent: <Name>
| Game Event | Expression | Why |
|---|---|---|
| Idle/default | normal | Resting |
| Player scores | angry | Frustrated |
| Opponent scores | happy | Gloating |
| Near-miss | surprised | Tension |
```

Skip this if there's no `design-brief.md` — don't create one just for the Expression Map.
