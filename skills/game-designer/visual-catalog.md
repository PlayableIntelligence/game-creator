# Visual Improvement Catalog

Reference patterns for visual improvements in browser games. Apply what fits the game.

## Character Prominence

If the main character (especially a named public figure) is smaller than 25% of screen height, it's too hard to recognize:

**Fix**: Re-render the character sprite at a higher scale, or redesign using the Public-Figure Caricature archetype — 32x48 grid at scale 4 (128x192px rendered, ~35% of 540px canvas). The character should be the largest entity on screen. Reduce surrounding entity sizes if needed to maintain visual hierarchy.

## Backgrounds & Atmosphere

### Sky Gradient (Phaser)
```js
// In Constants.js
export const SKY_CONFIG = {
  topColor: 0x4ec0ca,
  bottomColor: 0xa2d9e7,
  cloudCount: 6,
  cloudSpeed: 20,
  cloudAlpha: 0.6,
  cloudColors: [0xffffff, 0xf0f0f0, 0xe8e8e8],
};

// Background system - create gradient + clouds
const bg = scene.add.graphics();
const { width, height } = GAME_CONFIG;
for (let y = 0; y < height; y++) {
  const t = y / height;
  const r = Phaser.Math.Interpolation.Linear([(topColor >> 16) & 0xff, (bottomColor >> 16) & 0xff], t);
  const g = Phaser.Math.Interpolation.Linear([(topColor >> 8) & 0xff, (bottomColor >> 8) & 0xff], t);
  const b = Phaser.Math.Interpolation.Linear([topColor & 0xff, bottomColor & 0xff], t);
  bg.fillStyle(Phaser.Display.Color.GetColor(r, g, b), 1);
  bg.fillRect(0, y, width, 1);
}
```

### Parallax Scrolling Clouds
```js
// Cloud entity — simple ellipse clusters that scroll
class Cloud extends Phaser.GameObjects.Graphics {
  constructor(scene, x, y, scale) {
    super(scene);
    this.speed = SKY_CONFIG.cloudSpeed * scale;
    const color = Phaser.Utils.Array.GetRandom(SKY_CONFIG.cloudColors);
    this.fillStyle(color, SKY_CONFIG.cloudAlpha * scale);
    // Draw cloud as overlapping ellipses
    this.fillEllipse(0, 0, 60 * scale, 30 * scale);
    this.fillEllipse(25 * scale, -5 * scale, 50 * scale, 25 * scale);
    this.fillEllipse(-20 * scale, 5 * scale, 40 * scale, 20 * scale);
    this.setPosition(x, y);
    scene.add.existing(this);
  }
  update(delta) {
    this.x -= this.speed * (delta / 1000);
    if (this.x < -80) this.x = GAME_CONFIG.width + 80;
  }
}
```

### Starfield Background (Three.js)
```js
// For space/night games
const starGeometry = new THREE.BufferGeometry();
const starPositions = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i++) {
  starPositions[i * 3] = (Math.random() - 0.5) * 200;
  starPositions[i * 3 + 1] = (Math.random() - 0.5) * 200;
  starPositions[i * 3 + 2] = -50 - Math.random() * 100;
}
starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
```

## Color Palette Design

Use these approaches to create cohesive palettes:

```js
// In Constants.js — define palette as a system, not individual colors
export const PALETTE = {
  // Primary mood colors
  sky:        { top: 0x4ec0ca, bottom: 0xa2d9e7 },
  // Game object colors with highlight/shadow variants
  primary:    { base: 0xf5d742, light: 0xfce878, dark: 0xc4a820 },
  secondary:  { base: 0x73bf2e, light: 0x8ad432, dark: 0x5a9a23 },
  danger:     { base: 0xe84040, light: 0xff6060, dark: 0xb82020 },
  // UI colors
  ui:         { text: '#ffffff', stroke: '#000000', panel: 0xdeb858, panelBorder: 0x846830 },
  // Ambient/atmosphere
  ambient:    { cloud: 0xffffff, cloudShadow: 0xe0e0e0, ground: 0xded895, groundDark: 0xb8a850 },
};
```

## Juice & Game Feel

### Screen Shake
```js
// Trigger via EventBus
eventBus.on(Events.SCREEN_SHAKE, ({ intensity, duration }) => {
  scene.cameras.main.shake(duration, intensity);
});
```

### Floating Score Text
```js
// On score change — floating "+1" text near the action (score HUD is handled by Play.fun widget)
eventBus.on(Events.SCORE_CHANGED, ({ score }) => {
  const floater = scene.add.text(playerX + 30, playerY - 20, '+1', {
    fontSize: '20px', fontFamily: 'Arial Black',
    color: '#ffff00', stroke: '#000000', strokeThickness: 3,
  }).setOrigin(0.5);
  scene.tweens.add({
    targets: floater,
    y: floater.y - 40,
    alpha: 0,
    duration: 600,
    ease: 'Quad.easeOut',
    onComplete: () => floater.destroy(),
  });
});
```

### Death Flash & Slow-Mo
```js
// On game over — white flash + brief time scale dip
eventBus.on(Events.GAME_OVER, () => {
  scene.cameras.main.flash(200, 255, 255, 255);
  scene.cameras.main.shake(300, 0.015);
  // Brief slow-mo for dramatic effect
  scene.time.timeScale = 0.3;
  scene.time.delayedCall(400, () => { scene.time.timeScale = 1; });
});
```

### Button Hover / Press Feel
```js
// Make buttons feel alive
button.on('pointerover', () => {
  scene.tweens.add({ targets: button, scaleX: 1.08, scaleY: 1.08, duration: 100 });
});
button.on('pointerout', () => {
  scene.tweens.add({ targets: button, scaleX: 1, scaleY: 1, duration: 100 });
});
button.on('pointerdown', () => {
  scene.tweens.add({ targets: button, scaleX: 0.95, scaleY: 0.95, duration: 50 });
});
button.on('pointerup', () => {
  scene.tweens.add({ targets: button, scaleX: 1.08, scaleY: 1.08, duration: 50 });
});
```

## Particle Effects

### Simple Particle Burst (Phaser -- No Plugin)
```js
// For games without the particle plugin, use tweened sprites
function emitBurst(scene, x, y, count, color) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const speed = 60 + Math.random() * 80;
    const particle = scene.add.circle(x, y, 3 + Math.random() * 3, color, 1);
    scene.tweens.add({
      targets: particle,
      x: x + Math.cos(angle) * speed,
      y: y + Math.sin(angle) * speed,
      alpha: 0,
      scale: 0.2,
      duration: 400 + Math.random() * 200,
      ease: 'Quad.easeOut',
      onComplete: () => particle.destroy(),
    });
  }
}
```

## Scene Transitions

### Fade Transition
```js
// Fade out current scene, start next
scene.cameras.main.fadeOut(300, 0, 0, 0);
scene.cameras.main.once('camerafadeoutcomplete', () => {
  scene.scene.start('NextScene');
});

// In the new scene's create():
this.cameras.main.fadeIn(300, 0, 0, 0);
```

### Curtain Wipe
```js
// Black rectangle that slides across
const curtain = scene.add.rectangle(0, GAME_CONFIG.height / 2, 0, GAME_CONFIG.height, 0x000000).setOrigin(0, 0.5).setDepth(1000);
scene.tweens.add({
  targets: curtain,
  width: GAME_CONFIG.width,
  duration: 300,
  onComplete: () => scene.scene.start('NextScene'),
});
```

## Ground & Terrain Detail

### Scrolling Ground with Texture Lines
```js
// Add visual detail to flat ground
const ground = scene.add.graphics();
ground.fillStyle(GROUND_CONFIG.color, 1);
ground.fillRect(0, groundY, width, GROUND_CONFIG.height);
// Grass tufts along the top edge
ground.fillStyle(0x8ec63f, 1);
for (let x = 0; x < width; x += 12) {
  const h = 4 + Math.random() * 6;
  ground.fillTriangle(x, groundY, x + 4, groundY - h, x + 8, groundY);
}
// Dirt line
ground.lineStyle(2, GROUND_CONFIG.darkColor, 1);
ground.lineBetween(0, groundY, width, groundY);
```
