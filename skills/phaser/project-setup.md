# Project Setup

## Quick Start

```bash
npx degit phaserjs/template-vite-ts my-game
cd my-game
npm install
npm run dev
```

## Directory Structure

```
src/
├── scenes/
│   ├── Boot.ts           # Minimal setup, start Game scene
│   ├── Preloader.ts      # Load all assets, show progress bar
│   ├── Game.ts           # Main gameplay (starts immediately, no title screen)
│   └── GameOver.ts       # End screen with restart
├── objects/
│   ├── Player.ts         # Custom game objects
│   └── Enemy.ts
├── systems/              # ECS systems or managers
│   ├── AudioManager.ts
│   └── SaveManager.ts
├── utils/
│   └── helpers.ts
├── config.ts             # Phaser.Types.Core.GameConfig
└── main.ts               # Entry point
assets/
├── images/
├── audio/
├── tilemaps/
└── atlases/              # Texture atlas JSON + PNGs
```

## Game Configuration

```typescript
// src/config.ts
import Phaser from 'phaser';
import { Boot } from './scenes/Boot';
import { Preloader } from './scenes/Preloader';
import { Game } from './scenes/Game';
import { GameOver } from './scenes/GameOver';

export const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-container',
    backgroundColor: '#000000',
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { x: 0, y: 300 },
            debug: false,
        },
    },
    scene: [Boot, Preloader, Game, GameOver],
};
```

```typescript
// src/main.ts
import Phaser from 'phaser';
import { config } from './config';

new Phaser.Game(config);
```

## TypeScript Configuration

The template provides a working `tsconfig.json`. Key settings:

```json
{
    "compilerOptions": {
        "target": "ESNext",
        "module": "ESNext",
        "moduleResolution": "bundler",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true
    },
    "include": ["src"]
}
```

## Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    phaser: ['phaser'],
                },
            },
        },
    },
    server: {
        port: 8080,
    },
});
```

Splitting Phaser into its own chunk improves caching — the framework rarely changes between deploys.

## Asset Pipeline

- Use **TexturePacker** or **free-tex-packer** to create atlases
- Export as JSON Hash format (Phaser's default atlas format)
- Place atlas JSON + PNG pairs in `assets/atlases/`
- For audio, prefer `.ogg` (wide support) with `.mp3` fallback

## NPM Scripts

```json
{
    "scripts": {
        "dev": "vite",
        "build": "tsc && vite build",
        "preview": "vite preview"
    }
}
```

## Responsive Canvas Config (Retina/High-DPI)

For pixel-perfect rendering on any display, size the canvas to match the user's device pixel area (not a fixed base resolution). This prevents CSS-upscaling blur on high-DPI screens.

```typescript
// Constants.ts
export const DPR = Math.min(window.devicePixelRatio || 1, 2);
const isPortrait = window.innerHeight > window.innerWidth;
const designW = isPortrait ? 540 : 960;
const designH = isPortrait ? 960 : 540;
const designAspect = designW / designH;

// Canvas = device pixel area, maintaining design aspect ratio
const deviceW = window.innerWidth * DPR;
const deviceH = window.innerHeight * DPR;
let canvasW, canvasH;
if (deviceW / deviceH > designAspect) {
  canvasW = deviceW;
  canvasH = Math.round(deviceW / designAspect);
} else {
  canvasW = Math.round(deviceH * designAspect);
  canvasH = deviceH;
}

// PX = canvas pixels per design pixel. Scale ALL absolute values by PX.
export const PX = canvasW / designW;

export const GAME = {
  WIDTH: canvasW,      // e.g., 3456 on a 1728×1117 @2x display
  HEIGHT: canvasH,
  GRAVITY: 800 * PX,
};

// GameConfig.ts
scale: {
  mode: Phaser.Scale.FIT,
  autoCenter: Phaser.Scale.CENTER_BOTH,
  zoom: 1 / DPR,
},
roundPixels: true,
antialias: true,

// All absolute pixel values use PX (not DPR). Proportional values use ratios.
const groundH = 30 * PX;
const buttonY = GAME.HEIGHT * 0.55;
```

### Entity Sizing

Character dimensions must preserve their spritesheet aspect ratio across all orientations. Derive HEIGHT from WIDTH using the sprite's native aspect ratio (200×300 spritesheets = 1.5):

```js
const SPRITE_ASPECT = 1.5;

// Good — HEIGHT derived from WIDTH, correct in both landscape and portrait
PLAYER: {
  WIDTH: GAME.WIDTH * 0.08,
  HEIGHT: GAME.WIDTH * 0.08 * SPRITE_ASPECT,
}

// Bad — independent GAME.HEIGHT ratio squishes characters in portrait mode
PLAYER: {
  WIDTH: GAME.WIDTH * 0.08,
  HEIGHT: GAME.HEIGHT * 0.12,
}

// Bad — fixed size regardless of screen
PLAYER: {
  WIDTH: 40 * PX,
  HEIGHT: 40 * PX,
}
```

For **character-driven games** (named characters, mascots, or public figures via `/meme-game`), make characters prominent — use 12–15% of `GAME.WIDTH` for the player width. Use **caricature proportions** (large head ~40–50% of sprite height with exaggerated features, compact body) for public-figure games to maximize character recognition at any scale. Never define character HEIGHT as `GAME.HEIGHT * ratio` — on mobile portrait, `GAME.HEIGHT` is much larger than `GAME.WIDTH`, breaking the aspect ratio and squishing heads vertically.

**HTML boilerplate** (required for proper scaling):

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
  #game-container { width: 100%; height: 100%; }
</style>
```

### Portrait-First Games

For vertical game types (dodgers, runners, collectors, endless fallers), force portrait mode regardless of device orientation. Set `FORCE_PORTRAIT = true` in Constants.js — this locks `_isPortrait = true` and uses fixed 540×960 design dimensions. On desktop, `Scale.FIT + CENTER_BOTH` automatically pillarboxes with black bars (no CSS changes needed when `background: #000` is set on body).

```js
// Constants.js — force portrait for vertical games
const FORCE_PORTRAIT = true;
const _isPortrait = FORCE_PORTRAIT || window.innerHeight > window.innerWidth;
const _designW = 540;
const _designH = 960;
```

Without this, desktop browsers stretch the game to landscape, ruining the vertical layout. The template default is `FORCE_PORTRAIT = false` (auto-detect orientation).
