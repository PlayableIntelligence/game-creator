import { renderPixelArt, renderSpriteSheet } from '../core/PixelRenderer.js';
import { PALETTE, getTankPalette } from './palette.js';
import { TANK_BODY } from './tank.js';
import { BULLET_PELLET } from './bullet.js';
import { WALL_TILE, FLOOR_TILE } from './walls.js';
import { EXPLOSION_FRAMES, MUZZLE_FLASH, CROWN_SPRITE, SPEAKER_ON, SPEAKER_OFF } from './effects.js';
import { PX } from '../core/Constants.js';

const TANK_COLORS = ['RED', 'BLUE', 'GREEN', 'YELLOW'];

export function tankTextureKey(colorName) {
  return `tank_body_${colorName.toLowerCase()}`;
}

// Render at an integer scale that approximates PX. Phaser then displays the
// texture via setDisplaySize() at the exact design-coord size, so sprites
// align with the maze grid regardless of viewport DPR. Integer-scaled
// canvases keep the pixel grid crisp; the final GPU step is a small fractional
// rescale (renderScale → PX) which produces minimal blur with antialiasing on.
const renderScale = Math.max(1, Math.round(PX));

export function registerSprites(scene) {
  TANK_COLORS.forEach((c) => {
    renderPixelArt(scene, TANK_BODY, getTankPalette(c), tankTextureKey(c), renderScale);
  });

  renderPixelArt(scene, BULLET_PELLET, PALETTE, 'bullet', renderScale);
  renderPixelArt(scene, WALL_TILE, PALETTE, 'wall_tile', renderScale);
  renderPixelArt(scene, FLOOR_TILE, PALETTE, 'floor_tile', renderScale);
  renderSpriteSheet(scene, EXPLOSION_FRAMES, PALETTE, 'explosion', renderScale);
  renderPixelArt(scene, MUZZLE_FLASH, PALETTE, 'muzzle_flash', renderScale);
  renderPixelArt(scene, CROWN_SPRITE, PALETTE, 'crown', renderScale);
  renderPixelArt(scene, SPEAKER_ON, PALETTE, 'speaker_on', renderScale);
  renderPixelArt(scene, SPEAKER_OFF, PALETTE, 'speaker_off', renderScale);
}
