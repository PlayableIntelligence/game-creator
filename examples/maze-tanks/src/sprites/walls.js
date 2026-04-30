// Wall + floor tiles — both 32x32, tile seamlessly when placed adjacently.
//
// Wall: steel/concrete bunker block with bevel edges and four corner rivets.
//   - Top-left: highlight bevel (lighter)
//   - Bottom-right: shadow bevel (darker)
//   - Mid fill: steel mid (COLORS.WALL)
//   - Corner rivets: dark with light center (read as bolts)
//
// Floor: dusty concrete. Mostly FLOOR (very dark) with low-contrast grit
// speckle pattern. Speckles avoid the outermost rows/cols so the tile reads
// "seamless" when stamped adjacently — the apparent grain is interior only.
//
// Palette legend:
//   2 = steel shadow (wall bevel dark)
//   3 = steel mid   (wall fill, COLORS.WALL)
//   4 = steel highlight (wall bevel light + rivet pop)
//   5 = floor dark  (COLORS.FLOOR)
//   6 = floor grit  (slightly lighter speckle)

const W_S = 2;
const W_M = 3;
const W_H = 4;
const F_D = 5;
const F_G = 6;

function makeWall() {
  const rows = [];
  for (let y = 0; y < 32; y++) {
    const row = [];
    for (let x = 0; x < 32; x++) {
      // Top-left bevel (1px highlight on top + left edges)
      if (y === 0 || x === 0) row.push(W_H);
      // Bottom-right bevel (1px shadow on bottom + right edges)
      else if (y === 31 || x === 31) row.push(W_S);
      else row.push(W_M);
    }
    rows.push(row);
  }
  // Corner rivets — 2x2 darker squares with a 1px highlight pop, set 3px in
  const placeRivet = (cx, cy) => {
    rows[cy][cx] = W_S;
    rows[cy][cx + 1] = W_S;
    rows[cy + 1][cx] = W_S;
    rows[cy + 1][cx + 1] = W_H; // light pop = bolt head
  };
  placeRivet(3, 3);
  placeRivet(27, 3);
  placeRivet(3, 27);
  placeRivet(27, 27);

  return rows;
}

function makeFloor() {
  const rows = [];
  for (let y = 0; y < 32; y++) {
    const row = [];
    for (let x = 0; x < 32; x++) {
      row.push(F_D);
    }
    rows.push(row);
  }
  // Hand-placed grit/scratch pixels — interior only (cols 2..29, rows 2..29)
  // so seams between adjacent floor tiles don't form visible grid lines.
  const grit = [
    [4, 7], [9, 5], [14, 11], [20, 4], [25, 9], [28, 14],
    [3, 17], [11, 19], [17, 15], [22, 21], [27, 24],
    [6, 26], [13, 27], [19, 26], [24, 28],
    [8, 12], [15, 22], [21, 16], [26, 6],
  ];
  grit.forEach(([x, y]) => { rows[y][x] = F_G; });
  // A couple of 2px scratch lines for variety
  rows[10][16] = F_G; rows[10][17] = F_G;
  rows[23][8] = F_G; rows[23][9] = F_G;
  return rows;
}

export const WALL_TILE = makeWall();
export const FLOOR_TILE = makeFloor();
