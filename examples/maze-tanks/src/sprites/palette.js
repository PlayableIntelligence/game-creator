import { COLORS } from '../core/Constants.js';

// Shared palette for maze-tanks. Index 0 is transparent. Colors are themed
// dark + gritty military — readable against the dark concrete floor.
//
// Indices 11/12/13 are the per-tank shades (shadow / body / highlight).
// The base PALETTE leaves them null; getTankPalette() clones the array and
// fills them based on the tank's color name from COLORS.
export const PALETTE = [
  null,             // 0: transparent
  0x0a0c10,         // 1: deep outline (matches COLORS.BG)
  0x2a313e,         // 2: steel shadow
  COLORS.WALL,      // 3: steel mid (0x444c5e)
  0x5a6378,         // 4: steel highlight
  COLORS.FLOOR,     // 5: floor dark (0x1a1d24)
  0x252932,         // 6: floor grit
  COLORS.BULLET,    // 7: bullet core glow (0xffe066)
  COLORS.MUZZLE,    // 8: muzzle flash bright (0xfff2a8)
  0x7a7a82,         // 9: smoke
  0xff7a3a,         // 10: explosion flame orange
  null,             // 11: tank shadow (per-tank)
  null,             // 12: tank body (per-tank)
  null,             // 13: tank highlight (per-tank)
];

const SHADOW_MIX = 0.55;
const HIGHLIGHT_MIX = 1.35;

function shade(hex, factor) {
  const r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((hex & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}

const _tankPaletteCache = {};

export function getTankPalette(colorName) {
  if (_tankPaletteCache[colorName]) return _tankPaletteCache[colorName];
  const base = COLORS[colorName];
  const p = PALETTE.slice();
  p[11] = shade(base, SHADOW_MIX);
  p[12] = base;
  p[13] = shade(base, HIGHLIGHT_MIX);
  _tankPaletteCache[colorName] = p;
  return p;
}
