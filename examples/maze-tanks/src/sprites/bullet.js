// Bullet pellet — 8x8 glowing yellow.
// Palette legend:
//   1 = deep outline
//   7 = bullet core (COLORS.BULLET)
//   8 = muzzle bright (COLORS.MUZZLE)

const _ = 0;
const O = 1;
const Y = 7;
const W = 8;

export const BULLET_PELLET = [
  [_,_,O,O,O,O,_,_],
  [_,O,Y,Y,Y,Y,O,_],
  [O,Y,W,W,Y,Y,Y,O],
  [O,Y,W,W,Y,Y,Y,O],
  [O,Y,Y,Y,Y,Y,Y,O],
  [O,Y,Y,Y,Y,Y,Y,O],
  [_,O,Y,Y,Y,Y,O,_],
  [_,_,O,O,O,O,_,_],
];
