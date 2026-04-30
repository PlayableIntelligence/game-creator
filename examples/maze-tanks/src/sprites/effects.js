// Explosion (4-frame 32x32 spritesheet) + muzzle flash (16x16 single frame).
// Step 1.5 only registers these textures; Step 2 wires the animations.
//
// Palette legend:
//   1  = deep outline / dark smoke
//   8  = bright flash core (COLORS.MUZZLE)
//   7  = yellow glow (COLORS.BULLET)
//   10 = orange flame
//   9  = mid smoke
//
// Frames: 0 bright core flash → 1 expanded ring + smoke → 2 smoke only → 3 wisp.

const _ = 0;
const O = 1; // dark
const W = 8; // bright
const Y = 7; // yellow
const R = 10; // orange
const G = 9; // smoke

// Helpers — build a 32x32 frame from a center-distance test
function buildFrame(testFn) {
  const rows = [];
  const cx = 15.5, cy = 15.5;
  for (let y = 0; y < 32; y++) {
    const row = [];
    for (let x = 0; x < 32; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      row.push(testFn(d, x, y));
    }
    rows.push(row);
  }
  return rows;
}

const FRAME_0 = buildFrame((d) => {
  if (d <= 4) return W;
  if (d <= 7) return Y;
  if (d <= 10) return R;
  if (d <= 12) return O;
  return _;
});

const FRAME_1 = buildFrame((d) => {
  if (d <= 3) return Y;
  if (d <= 7) return R;
  if (d <= 11) return O;
  if (d <= 14) return G;
  if (d <= 15) return O;
  return _;
});

const FRAME_2 = buildFrame((d, x, y) => {
  if (d > 14) return _;
  if (d <= 5) return G;
  if (d <= 12) return O;
  // Outer wisp: scattered smoke pixels
  if ((x + y) % 2 === 0 && d <= 14) return G;
  return O;
});

const FRAME_3 = buildFrame((d, x, y) => {
  if (d > 14) return _;
  // Sparse smoke wisps only
  if (d <= 8 && (x + y) % 3 === 0) return G;
  if (d <= 13 && (x * 3 + y) % 5 === 0) return G;
  return _;
});

export const EXPLOSION_FRAMES = [FRAME_0, FRAME_1, FRAME_2, FRAME_3];

// Muzzle flash — 16x16, bright yellow/orange burst.
const M_ = 0;
const M_O = 1;
const M_W = 8;
const M_Y = 7;
const M_R = 10;

// Speaker icon — 16x16. Two states (on / off). Body uses palette index 4
// (steel highlight) for a soft white that doesn't compete with HUD text;
// the OFF state adds a red "X" via a fresh palette index that the speaker
// registration injects (we reuse index 10 — orange flame — close enough to
// red against the dark UI corner).
//
//   0 transparent
//   1 deep outline
//   4 speaker body (steel highlight)
//   8 sound waves (muzzle bright)
//   10 mute X (orange/red)
// Use existing module-scope `_` (transparent) along with new aliases.
const SPK_K = 1;  // outline
const SPK_B = 4;  // body (steel highlight)
const SPK_S = 8;  // sound waves (muzzle bright)
const SPK_X = 10; // mute X (orange/red)
export const SPEAKER_ON = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,SPK_K,_,_,_,_,_,SPK_S,_,_],
  [_,_,_,_,_,_,SPK_K,SPK_B,_,_,_,_,_,SPK_S,SPK_S,_],
  [_,_,_,SPK_K,SPK_K,SPK_K,SPK_B,SPK_B,_,_,_,_,SPK_S,_,_,SPK_S],
  [_,_,SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,_,_,SPK_S,_,SPK_S,SPK_S,_],
  [_,SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,_,_,SPK_S,SPK_S,_,_,_],
  [SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,_,_,SPK_S,SPK_S,_,SPK_S,_],
  [SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,_,_,SPK_S,SPK_S,_,SPK_S,_],
  [SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,_,_,SPK_S,SPK_S,_,SPK_S,_],
  [SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,_,_,SPK_S,SPK_S,_,SPK_S,_],
  [_,SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,_,_,SPK_S,SPK_S,_,_,_],
  [_,_,SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,_,_,SPK_S,_,SPK_S,SPK_S,_],
  [_,_,_,SPK_K,SPK_K,SPK_K,SPK_B,SPK_B,_,_,_,_,SPK_S,_,_,SPK_S],
  [_,_,_,_,_,_,SPK_K,SPK_B,_,_,_,_,_,SPK_S,SPK_S,_],
  [_,_,_,_,_,_,_,SPK_K,_,_,_,_,_,SPK_S,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];
export const SPEAKER_OFF = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,SPK_K,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,SPK_K,SPK_B,_,SPK_X,_,_,_,SPK_X,_,_],
  [_,_,_,SPK_K,SPK_K,SPK_K,SPK_B,SPK_B,_,_,SPK_X,_,SPK_X,_,_,_],
  [_,_,SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,_,_,SPK_X,_,_,_,_],
  [_,SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,_,_,SPK_X,_,_,_,_],
  [SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,_,SPK_X,_,SPK_X,_,_,_],
  [SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,SPK_X,_,_,_,SPK_X,_,_],
  [SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,SPK_X,_,_,_,SPK_X,_,_],
  [SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,_,SPK_X,_,SPK_X,_,_,_],
  [_,SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,_,_,SPK_X,_,_,_,_],
  [_,_,SPK_K,SPK_B,SPK_B,SPK_B,SPK_B,SPK_B,_,_,_,SPK_X,_,_,_,_],
  [_,_,_,SPK_K,SPK_K,SPK_K,SPK_B,SPK_B,_,_,SPK_X,_,SPK_X,_,_,_],
  [_,_,_,_,_,_,SPK_K,SPK_B,_,SPK_X,_,_,_,SPK_X,_,_],
  [_,_,_,_,_,_,_,SPK_K,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

// Crown — 12x8 pixel art for the round winner. Gold body, black outline,
// 3 peaks with bright highlights.
//
//   0 transparent
//   1 outline (deep dark)
//   7 bullet yellow / gold body
//   8 muzzle bright / gold highlight
export const CROWN_SPRITE = [
  [0,0,0,0,0,0,0,0,0,0,0,0],
  [0,1,0,0,0,1,1,0,0,0,1,0],
  [0,1,7,0,1,7,7,1,0,7,1,0],
  [0,1,7,1,7,7,7,7,1,7,1,0],
  [0,1,7,8,7,7,7,7,8,7,1,0],
  [0,1,7,7,7,8,8,7,7,7,1,0],
  [0,1,1,1,1,1,1,1,1,1,1,0],
  [0,0,0,0,0,0,0,0,0,0,0,0],
];

export const MUZZLE_FLASH = [
  [M_,M_,M_,M_,M_,M_,M_,M_O,M_O,M_,M_,M_,M_,M_,M_,M_],
  [M_,M_,M_,M_,M_,M_,M_O,M_R,M_R,M_O,M_,M_,M_,M_,M_,M_],
  [M_,M_,M_,M_,M_,M_O,M_R,M_Y,M_Y,M_R,M_O,M_,M_,M_,M_,M_],
  [M_,M_,M_,M_,M_O,M_R,M_Y,M_W,M_W,M_Y,M_R,M_O,M_,M_,M_,M_],
  [M_,M_,M_,M_O,M_R,M_Y,M_W,M_W,M_W,M_W,M_Y,M_R,M_O,M_,M_,M_],
  [M_,M_,M_O,M_R,M_Y,M_W,M_W,M_W,M_W,M_W,M_W,M_Y,M_R,M_O,M_,M_],
  [M_,M_O,M_R,M_Y,M_W,M_W,M_W,M_W,M_W,M_W,M_W,M_W,M_Y,M_R,M_O,M_],
  [M_O,M_R,M_Y,M_W,M_W,M_W,M_W,M_W,M_W,M_W,M_W,M_W,M_W,M_Y,M_R,M_O],
  [M_O,M_R,M_Y,M_W,M_W,M_W,M_W,M_W,M_W,M_W,M_W,M_W,M_W,M_Y,M_R,M_O],
  [M_,M_O,M_R,M_Y,M_W,M_W,M_W,M_W,M_W,M_W,M_W,M_W,M_Y,M_R,M_O,M_],
  [M_,M_,M_O,M_R,M_Y,M_W,M_W,M_W,M_W,M_W,M_W,M_Y,M_R,M_O,M_,M_],
  [M_,M_,M_,M_O,M_R,M_Y,M_W,M_W,M_W,M_W,M_Y,M_R,M_O,M_,M_,M_],
  [M_,M_,M_,M_,M_O,M_R,M_Y,M_W,M_W,M_Y,M_R,M_O,M_,M_,M_,M_],
  [M_,M_,M_,M_,M_,M_O,M_R,M_Y,M_Y,M_R,M_O,M_,M_,M_,M_,M_],
  [M_,M_,M_,M_,M_,M_,M_O,M_R,M_R,M_O,M_,M_,M_,M_,M_,M_],
  [M_,M_,M_,M_,M_,M_,M_,M_O,M_O,M_,M_,M_,M_,M_,M_,M_],
];
