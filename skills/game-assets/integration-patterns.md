# Integration Patterns — Replacing Entities, Animation, External Assets

## Replacing fillCircle Entities

Current pattern (procedural circle):
```js
// OLD: in entity constructor
const gfx = scene.add.graphics();
gfx.fillStyle(cfg.color, 1);
gfx.fillCircle(cfg.size, cfg.size, cfg.size);
gfx.generateTexture(texKey, cfg.size * 2, cfg.size * 2);
gfx.destroy();
this.sprite = scene.physics.add.sprite(x, y, texKey);
```

New pattern (pixel art):
```js
// NEW: in entity constructor
import { renderPixelArt } from '../core/PixelRenderer.js';
import { ZOMBIE_IDLE } from '../sprites/enemies.js';
import { PALETTE } from '../sprites/palette.js';

const texKey = `enemy-${typeKey}`;
renderPixelArt(scene, ZOMBIE_IDLE, PALETTE.DARK, texKey, 2);
this.sprite = scene.physics.add.sprite(x, y, texKey);
```

## Adding Animation

```js
import { renderSpriteSheet } from '../core/PixelRenderer.js';
import { PLAYER_FRAMES, PLAYER_PALETTE } from '../sprites/player.js';

// In entity constructor or BootScene
renderSpriteSheet(scene, PLAYER_FRAMES, PLAYER_PALETTE, 'player-sheet', 2);

// Create animation
scene.anims.create({
  key: 'player-walk',
  frames: scene.anims.generateFrameNumbers('player-sheet', { start: 0, end: 3 }),
  frameRate: 8,
  repeat: -1,
});

// Play animation
this.sprite = scene.physics.add.sprite(x, y, 'player-sheet', 0);
this.sprite.play('player-walk');

// Stop animation (idle)
this.sprite.stop();
this.sprite.setFrame(0);
```

## Multiple Enemy Types

When a game has multiple enemy types (like Vampire Survivors), define each type's sprite data alongside its config:

```js
// sprites/enemies.js
import { PALETTE } from './palette.js';

export const ENEMY_SPRITES = {
  BAT: { frames: [BAT_IDLE, BAT_FLAP], palette: PALETTE.DARK, animRate: 6 },
  ZOMBIE: { frames: [ZOMBIE_IDLE, ZOMBIE_WALK], palette: PALETTE.DARK, animRate: 4 },
  SKELETON: { frames: [SKELETON_IDLE, SKELETON_WALK], palette: PALETTE.DARK, animRate: 5 },
  GHOST: { frames: [GHOST_IDLE, GHOST_FADE], palette: PALETTE.DARK, animRate: 3 },
  DEMON: { frames: [DEMON_IDLE, DEMON_WALK], palette: PALETTE.DARK, animRate: 6 },
};

// In Enemy constructor:
const spriteData = ENEMY_SPRITES[typeKey];
const texKey = `enemy-${typeKey}`;
renderSpriteSheet(scene, spriteData.frames, spriteData.palette, texKey, 2);

this.sprite = scene.physics.add.sprite(x, y, texKey, 0);
scene.anims.create({
  key: `${typeKey}-anim`,
  frames: scene.anims.generateFrameNumbers(texKey, { start: 0, end: spriteData.frames.length - 1 }),
  frameRate: spriteData.animRate,
  repeat: -1,
});
this.sprite.play(`${typeKey}-anim`);
```

## External Asset Download

Use this workflow for downloading real images (logos, meme references, sprite sheets). Logos and meme images from the source tweet are downloaded by default (see Asset Tiers in SKILL.md). Full sprite sheet replacements are optional and used when pixel art isn't sufficient.

### Reliable Free Sources

| Source | License | Format | URL |
|--------|---------|--------|-----|
| Kenney.nl | CC0 (public domain) | PNG sprite sheets | kenney.nl/assets |
| OpenGameArt.org | Various (check each) | PNG, SVG | opengameart.org |
| itch.io (free assets) | Various (check each) | PNG | itch.io/game-assets/free |

### Download Workflow

1. **Search** for assets matching the game theme using WebSearch
2. **Verify license** — only CC0 or CC-BY are safe for any project
3. **Download** the sprite sheet PNG using `curl` or `wget`
4. **Place** in `public/assets/sprites/` (Vite serves `public/` as static)
5. **Load** in a Preloader scene:
   ```js
   // scenes/PreloaderScene.js
   preload() {
     this.load.spritesheet('player', 'assets/sprites/player.png', {
       frameWidth: 32,
       frameHeight: 32,
     });
   }
   ```
6. **Create animations** in the Preloader scene
7. **Add fallback** — if the asset fails to load, fall back to `renderPixelArt()`

### Graceful Fallback Pattern

```js
// Check if external asset loaded, otherwise use pixel art
if (scene.textures.exists('player-external')) {
  this.sprite = scene.physics.add.sprite(x, y, 'player-external');
} else {
  renderPixelArt(scene, PLAYER_IDLE, PLAYER_PALETTE, 'player-fallback', 2);
  this.sprite = scene.physics.add.sprite(x, y, 'player-fallback');
}
```

### Logo Download Workflow

When a game features a named company, download and use the real logo. SVG preferred (scales cleanly), PNG acceptable.

**Steps:**
1. Search for the company's official logo (SVG or high-res PNG)
2. Download to `public/assets/logos/<company>.svg` (or `.png`)
3. Load in Phaser: `this.load.image('logo-openai', 'assets/logos/openai.svg')`
4. Use for branding elements (splash, HUD icons, entity overlays)
5. Keep pixel art fallback for the character sprite itself — logos complement public-figure sprites, they don't replace them

**Well-known logo sources** (search for these when needed):
- Company press kits and brand pages typically host official logo files
- Use WebSearch to find `"<company> logo SVG press kit"` or `"<company> brand assets"`

**In Phaser preload:**
```js
preload() {
  this.load.image('logo-openai', 'assets/logos/openai.png');
  this.load.image('logo-anthropic', 'assets/logos/anthropic.png');
}
```

**Fallback if logo fails to load:**
```js
this.load.on('loaderror', (file) => {
  console.warn(`Failed to load ${file.key}, using pixel art fallback`);
});
```

### Meme Image Integration

When `thread.json` includes an `image_url`, download and incorporate it:

1. Download the image: `curl -o public/assets/meme-ref.png "<image_url>"`
2. Load in Phaser: `this.load.image('meme-ref', 'assets/meme-ref.png')`
3. Use appropriately — as a background element, game-over splash, or visual reference for character design
4. Study the image for character appearances, visual style, and meme elements before designing sprites
