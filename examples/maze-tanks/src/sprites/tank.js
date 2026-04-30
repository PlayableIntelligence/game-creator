// Tank body sprite — 36 wide × 22 tall, top-down view.
//
// The chassis occupies cols 0-27 (matching TANK.WIDTH = 28). The barrel
// extends from the turret outward to col 33 — sticking out past the chassis,
// matching the original Graphics-rendered tank silhouette in Step 1.
//
// Sprite origin is the chassis center (0.5, 0.5 in display space). Game logic
// rotates the sprite around this origin. Displayed at TANK_VISUAL_WIDTH ×
// TANK.HEIGHT design pixels (see Tank.draw()).
//
// Palette legend:
//   1  = deep outline
//   2  = steel shadow (tread dark)
//   3  = steel mid (tread mid)
//   4  = steel highlight (tread rivets, barrel highlight)
//   11 = tank shadow (per-color)
//   12 = tank body (per-color)
//   13 = tank highlight (per-color)

const _ = 0;
const O = 1;
const S = 2;
const M = 3;
const H = 4;
const a = 11;
const b = 12;
const c = 13;

// Width: 36, Height: 22. Chassis = cols 0..27 (28 wide). Barrel = cols 22..33.
export const TANK_BODY = [
  // 36 columns
  [_,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,_,_,_,_,_,_,_,_,_], // 0
  [O,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,O,_,_,_,_,_,_,_,_], // 1
  [O,S,M,H,M,M,H,M,M,H,M,M,H,M,M,H,M,M,H,M,M,H,M,M,H,M,S,O,_,_,_,_,_,_,_,_], // 2 rivets
  [O,S,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,S,O,_,_,_,_,_,_,_,_], // 3
  [_,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,_,_,_,_,_,_,_,_,_], // 4
  [_,_,O,c,c,c,c,c,c,c,c,c,c,c,c,c,c,c,c,c,c,c,c,c,c,O,_,_,_,_,_,_,_,_,_,_], // 5 hull highlight
  [_,_,O,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,O,_,_,_,_,_,_,_,_,_,_], // 6
  [_,_,O,b,b,b,b,b,b,b,b,O,O,O,O,b,b,b,b,b,b,b,b,b,b,O,_,_,_,_,_,_,_,_,_,_], // 7
  [_,_,O,b,b,b,b,b,b,b,O,c,c,c,c,O,b,b,b,b,b,b,b,b,b,O,_,_,_,_,_,_,_,_,_,_], // 8
  [_,_,O,b,b,b,b,b,b,O,c,c,c,c,c,c,O,b,b,b,b,b,b,b,b,O,_,_,_,_,_,_,_,_,_,_], // 9 turret base
  [_,_,O,b,b,b,b,b,b,O,c,b,b,b,b,c,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,_,_], //10 barrel top
  [_,_,O,b,b,b,b,b,b,O,c,b,b,b,b,c,O,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,O,_,_], //11 barrel core
  [_,_,O,b,b,b,b,b,b,O,a,b,b,b,b,a,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,_,_], //12 barrel bottom
  [_,_,O,b,b,b,b,b,b,O,a,a,a,a,a,a,O,b,b,b,b,b,b,b,b,O,_,_,_,_,_,_,_,_,_,_], //13
  [_,_,O,b,b,b,b,b,b,b,O,a,a,a,a,O,b,b,b,b,b,b,b,b,b,O,_,_,_,_,_,_,_,_,_,_], //14
  [_,_,O,b,b,b,b,b,b,b,b,O,O,O,O,b,b,b,b,b,b,b,b,b,b,O,_,_,_,_,_,_,_,_,_,_], //15
  [_,_,O,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,b,O,_,_,_,_,_,_,_,_,_,_], //16
  [_,_,O,a,a,a,a,a,a,a,a,a,a,a,a,a,a,a,a,a,a,a,a,a,a,O,_,_,_,_,_,_,_,_,_,_], //17 hull shadow
  [_,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,O,_,_,_,_,_,_,_,_,_], //18
  [O,S,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,M,S,O,_,_,_,_,_,_,_,_], //19
  [O,S,M,H,M,M,H,M,M,H,M,M,H,M,M,H,M,M,H,M,M,H,M,M,H,M,S,O,_,_,_,_,_,_,_,_], //20 rivets
  [O,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,S,O,_,_,_,_,_,_,_,_], //21
];

// Sprite spans 36 design-px wide, but the chassis (and physics body) is only
// the original 28 px. The sprite is positioned with its origin at the chassis
// center, so the barrel naturally protrudes to the +x side.
export const TANK_SPRITE_WIDTH = 36;
export const TANK_SPRITE_HEIGHT = 22;
export const TANK_SPRITE_ORIGIN_X = 14 / 36; // chassis center within the 36-wide sprite
export const TANK_SPRITE_ORIGIN_Y = 0.5;
