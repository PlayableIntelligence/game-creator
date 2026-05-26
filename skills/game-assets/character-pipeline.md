# Character Pipeline — South Park System & Photo-Composite Characters

## South Park Character System

### Character Library

Location: `assets/characters/` (relative to plugin root)

The library contains pre-built characters with photo-realistic heads composited onto South Park-style cartoon bodies. Each character has:
- Multiple expression sprites (normal, happy, angry, surprised)
- A horizontal spritesheet with all expressions
- Metadata in `manifest.json`

**Check the library first** before creating any public-figure sprite. If the character exists, copy their sprites into the game — no pixel art needed.

```
assets/characters/
  manifest.json                    # Index of all built characters
  characters/
    donald-trump/
      sprites/
        normal.png                 # Individual expression sprites (200x300)
        happy.png
        angry.png
        surprised.png
        spritesheet.png            # 800x300 horizontal strip (all expressions)
    joe-biden/
      sprites/
        ...
    elon-musk/
      sprites/
        ...
```

### Expression Constants

Standard expression frame indices — must be consistent across all games:

```js
// In Constants.js
export const EXPRESSION = {
  NORMAL: 0,
  HAPPY: 1,
  ANGRY: 2,
  SURPRISED: 3,
};

export const EXPRESSION_HOLD_MS = 600;
```

### Loading Characters from the Library

During game build, copy character sprites into the game:
```
assets/characters/characters/<slug>/sprites/ → game-dir/public/assets/characters/<slug>/
```

In the Phaser preloader:
```js
preload() {
  this.load.spritesheet('sam-altman', 'assets/characters/sam-altman/spritesheet.png', {
    frameWidth: 200,
    frameHeight: 300,
  });
}
```

### Expression Wiring Pattern

Every public-figure character must have reactive expressions. Wire them to game events:

```js
// In the player/character entity constructor:
this.sprite = scene.physics.add.sprite(x, y, 'sam-altman', EXPRESSION.NORMAL);
this.expressionTimer = null;

setExpression(expression, holdMs = EXPRESSION_HOLD_MS) {
  this.sprite.setFrame(expression);
  if (this.expressionTimer) this.expressionTimer.remove();
  if (expression !== EXPRESSION.NORMAL) {
    this.expressionTimer = this.scene.time.delayedCall(holdMs, () => {
      this.sprite.setFrame(EXPRESSION.NORMAL);
    });
  }
}

// Wire to game events in the scene's create():
eventBus.on(Events.PLAYER_DAMAGED, () => {
  player.setExpression(EXPRESSION.ANGRY);
});

eventBus.on(Events.SCORE_CHANGED, () => {
  player.setExpression(EXPRESSION.HAPPY);
});

eventBus.on(Events.SPECTACLE_STREAK, ({ streak }) => {
  player.setExpression(EXPRESSION.SURPRISED, 1000);
});

// Opponents also react:
eventBus.on(Events.OPPONENT_HIT, ({ id }) => {
  opponents[id].setExpression(EXPRESSION.ANGRY);
});

eventBus.on(Events.OPPONENT_SCORES, ({ id }) => {
  opponents[id].setExpression(EXPRESSION.HAPPY);
});
```

### Bobblehead Body Pattern (Standard for Photo-Composite Characters)

Every photo-composite character **must** have a South Park-style cartoon body drawn with Phaser Graphics primitives. **Never display a floating head sprite alone** — always pair it with a drawn body. The "bobblehead" aesthetic (giant photo head on a tiny cartoon body) is the signature look.

**Architecture:** The body is rendered as a Phaser Graphics object inside a Container, with the head spritesheet sprite layered on top. Arms are separate Graphics objects for independent animation (raise, wave, cower).

**Body components** (drawn bottom-to-top):
1. **Shoes** — rounded rectangles at the bottom
2. **Legs (pants)** — two rounded rectangles with gap between
3. **Torso (jacket/shirt)** — trapezoidal polygon (wider shoulders, narrower waist)
4. **Jacket detail** — lighter panel for depth, lapels on each side
5. **Shirt/collar V** — V-shaped opening at neckline
6. **Tie** (if applicable) — knot + blade tapering down
7. **Buttons** — small circles on jacket front
8. **Neck** — rounded rectangle connecting body to head, skin-colored

**Arms** (separate Graphics for animation):
1. **Upper arm (sleeve)** — rounded rectangle matching jacket color
2. **Shirt cuff** — thin lighter rectangle
3. **Hand (mitten)** — rounded rectangle, skin-colored, no fingers (South Park convention)

**Scaling system:** All body dimensions derive from a single base unit `U`:
```js
// In Constants.js
const _U = GAME.WIDTH * 0.012;

export const CHARACTER = {
  U: _U,
  TORSO_H: _U * 5,
  SHOULDER_W: _U * 7,
  WAIST_W: _U * 5,
  NECK_W: _U * 2.5,
  NECK_H: _U * 1,
  HEAD_H: GAME.WIDTH * 0.25,  // Derive from WIDTH (not HEIGHT) to stay proportional on mobile portrait
  FRAME_W: 200,              // Spritesheet frame dimensions (200x300)
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
  // Character-specific colors (suit, tie, shirt, pants, shoes, skin)
};
```

**Container layer order:**
```js
this.container.add([
  this.leftArmGfx,   // Layer 0: behind body
  this.rightArmGfx,  // Layer 1: behind body
  this.bodyGfx,      // Layer 2: middle
  this.headSprite,   // Layer 3: on top (photo-composite head)
]);
```

**Head positioning:**
```js
const headY = -C.TORSO_H * 0.5 - C.NECK_H - C.HEAD_H * 0.35;
this.headSprite = scene.add.sprite(0, headY, sheetKey, EXPRESSION.NORMAL);
const headScale = C.HEAD_H / C.FRAME_H;
this.headSprite.setScale(headScale);
```

**Idle breathing** (adds life):
```js
scene.tweens.add({
  targets: container,
  y: y - 2 * PX,
  duration: 1400 + Math.random() * 400,
  yoyo: true,
  repeat: -1,
  ease: 'Sine.easeInOut',
});
```

**Clothing palette** — customize per character:
- **Dark suit characters** (philosophers, executives): dark navy/charcoal suit, white shirt, muted tie
- **Casual characters**: t-shirt (fill torso as single color, skip jacket detail/lapels/tie)
- **Branded characters**: use brand colors for suit/shirt

See `examples/trump-mog/src/entities/Character.js` for the complete reference implementation.

### Building New Characters

If a public figure is needed but not in the library, build them using the project-level pipeline scripts. Follow the **tiered fallback** — try each tier in order, stop at first success:

#### Tier 1: Full 4-expression build (best)

**Step 1: Find Expression Images via WebSearch**

Use WebSearch to find 4 distinct expression photos. **Any photo format works** (jpg, png, webp) — the pipeline has ML background removal (`process-head.mjs`) built in, so transparent PNGs are NOT required. Search broadly for real photographs:

| Expression | Search query |
|-----------|-------------|
| **normal** | `"<Person Name> portrait photo"` or `"<Person Name> face"` — neutral expression |
| **happy** | `"<Person Name> smiling"` or `"<Person Name> laughing"` |
| **angry** | `"<Person Name> angry"` or `"<Person Name> serious stern"` |
| **surprised** | `"<Person Name> surprised"` or `"<Person Name> shocked"` |

For each expression, look for:
- **normal** — neutral/calm face, slight smile OK
- **happy** — big grin, laughing, celebrating (close-up preferred)
- **angry** — grimacing, teeth-baring, scowling
- **surprised** — mouth open, wide eyes, shocked

**Image selection rules:**
- **Any photo works** — the pipeline removes backgrounds and crops to face automatically. Don't restrict searches to "transparent PNG" or specific image sites.
- Any composition works (head-only, half-body, full-body) — `crop-head.mjs` uses face detection to find and crop the face automatically. No manual `--ratio` tuning needed.
- Avoid illustrations/cartoons — use real photos for photo-composite characters.
- Download to `<outputDir>/raw/normal.jpg`, `happy.jpg`, `angry.jpg`, `surprised.jpg` (any image extension).

**Step 2: Run the Pipeline**

```bash
# If images already have transparent backgrounds:
node scripts/crop-head.mjs raw/normal.png cropped/normal.png
node scripts/crop-head.mjs raw/happy.png cropped/happy.png
# ... for each expression (face detection auto-finds the face)

# Build the spritesheet:
node scripts/build-spritesheet.mjs public/assets/<slug>-expressions.png \
  --normal cropped/normal.png --happy cropped/happy.png \
  --angry cropped/angry.png --surprised cropped/surprised.png
```

Or use the orchestrator (expects raw images with opaque backgrounds — runs ML bg removal + crop + spritesheet):
```bash
node scripts/build-character.mjs "<Full Name>" public/assets/<slug>/ --skip-find
```

`crop-head.mjs` uses face-api.js (SSD MobileNet v1) to detect the face bounding box and crops with 25% padding. Falls back to bounding-box heuristic if no face is detected. Use `--padding 0.40` to increase padding around the detected face.

#### Tier 2: Partial expressions (1-3 images found)

If WebSearch only finds 1-3 usable images, **duplicate the best image** (prefer normal) into the missing expression slots before running the pipeline:

```bash
# Example: only found normal.png and happy.png
cp raw/normal.png raw/angry.png
cp raw/normal.png raw/surprised.png
# Now run build-character.mjs as normal — all 4 raw slots are filled
```

Result: 4-frame spritesheet where some expressions share the same face. The expression wiring still works — character just shows the same face for missing expressions. Functional and recognizable.

#### Tier 3: Single image (minimum photo-composite)

If only 1 image is found, or the pipeline fails on all but one image:

```bash
# Duplicate the single image to all 4 slots
cp raw/normal.png raw/happy.png
cp raw/normal.png raw/angry.png
cp raw/normal.png raw/surprised.png
node scripts/build-character.mjs "<Name>" <outputDir>/ --skip-find
```

Result: All 4 frames are identical. Character is photo-recognizable but has no expression changes. Still loads as a spritesheet, still works with the expression wiring code (just no visible change).

#### Tier 4: Generative pixel art (worst case)

If NO usable images are found (WebSearch returns nothing, all downloads fail, pipeline crashes):

- Skip the photo-composite pipeline entirely
- Use the **Public-Figure Caricature archetype** — 32x48 pixel art grid at scale 4 (renders to 128x192px)
- Design the pixel art with recognizable features: signature hairstyle, glasses, facial hair, clothing color
- Create 2-4 animation frames (idle + walk minimum) using `renderSpriteSheet()`
- Wire as a standard pixel art entity — no expression system, no spritesheet loading

This is the **absolute last resort**. Always exhaust image search first — even a single photo produces a better result than pixel art for public-figure characters.
