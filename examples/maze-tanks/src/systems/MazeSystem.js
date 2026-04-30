import { MAZE, PX } from '../core/Constants.js';

// Symmetric handcrafted layout. 40 cols x 22 rows.
// '#' = wall, '.' = floor.
// 4-fold symmetric (horizontal + vertical mirror) so every corner spawn has
// identical lanes and chokepoints. 6 distinct interior wall blocks (2 per
// quadrant, mirrored) form a pinwheel of lanes around an open central plaza.
const MAZE_LAYOUT = [
  '########################################',
  '#......................................#',
  '#......................................#',
  '#......##......................##......#',
  '#......##..####..........####..##......#',
  '#......##..####..........####..##......#',
  '#......##......................##......#',
  '#......................................#',
  '#......................................#',
  '#............####......####............#',
  '#............####......####............#',
  '#............####......####............#',
  '#............####......####............#',
  '#......................................#',
  '#......................................#',
  '#......##......................##......#',
  '#......##..####..........####..##......#',
  '#......##..####..........####..##......#',
  '#......##......................##......#',
  '#......................................#',
  '#......................................#',
  '########################################',
];

export class MazeSystem {
  constructor(scene, container) {
    this.scene = scene;
    this.container = container;
    this.tileSize = MAZE.TILE_SIZE * PX;
    this.layout = MAZE_LAYOUT;
    this.cols = MAZE.COLS;
    this.rows = MAZE.ROWS;
    this.draw();
  }

  draw() {
    const ts = this.tileSize;
    const added = [];

    // Floor: tile every cell. Per-tile images keep the grit pattern crisp at
    // any DPR — tileSprite would shrink the source canvas and lose the speckle.
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = c * ts + ts / 2;
        const y = r * ts + ts / 2;
        const floor = this.scene.add.image(x, y, 'floor_tile');
        floor.setDisplaySize(ts, ts);
        added.push(floor);
      }
    }

    // Walls layered on top of the floor.
    for (let r = 0; r < this.rows; r++) {
      const row = this.layout[r];
      for (let c = 0; c < this.cols; c++) {
        if (row[c] !== '#') continue;
        const x = c * ts + ts / 2;
        const y = r * ts + ts / 2;
        const wall = this.scene.add.image(x, y, 'wall_tile');
        wall.setDisplaySize(ts, ts);
        added.push(wall);
      }
    }

    if (this.container) {
      this.container.add(added);
    } else {
      added.forEach((img, i) => img.setDepth(i < this.rows * this.cols ? -100 : -50));
    }
  }

  isWallTile(col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return true;
    return this.layout[row][col] === '#';
  }

  isWallAtPixel(x, y) {
    const col = Math.floor(x / this.tileSize);
    const row = Math.floor(y / this.tileSize);
    return this.isWallTile(col, row);
  }

  // Resolve a circle-vs-walls collision by axis separation.
  // Mutates entity {x, y} so it sits flush against any wall it overlapped.
  // Returns { collidedX, collidedY } so callers can react (e.g., tanks zero velocity).
  resolveCircle(entity, radius) {
    const ts = this.tileSize;
    let collidedX = false;
    let collidedY = false;

    // Check 3x3 neighborhood for the entity's center tile
    const cCol = Math.floor(entity.x / ts);
    const cRow = Math.floor(entity.y / ts);

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const col = cCol + dc;
        const row = cRow + dr;
        if (!this.isWallTile(col, row)) continue;
        const wx = col * ts;
        const wy = row * ts;
        // Closest point on tile rectangle
        const closestX = Math.max(wx, Math.min(entity.x, wx + ts));
        const closestY = Math.max(wy, Math.min(entity.y, wy + ts));
        const dx = entity.x - closestX;
        const dy = entity.y - closestY;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < radius * radius) {
          // Edge case: entity center is exactly on the wall surface (e.g. a
          // forced-spawn position). dx == dy == 0 → would yield NaN normals
          // and leave the entity embedded. Push out along the shortest of
          // the four wall edges instead.
          if (dist2 === 0) {
            const left = entity.x - wx;
            const right = wx + ts - entity.x;
            const top = entity.y - wy;
            const bottom = wy + ts - entity.y;
            const minPen = Math.min(left, right, top, bottom);
            if      (minPen === left)   { entity.x = wx - radius;       collidedX = true; }
            else if (minPen === right)  { entity.x = wx + ts + radius;  collidedX = true; }
            else if (minPen === top)    { entity.y = wy - radius;       collidedY = true; }
            else                        { entity.y = wy + ts + radius;  collidedY = true; }
            continue;
          }
          const dist = Math.sqrt(dist2);
          const overlap = radius - dist;
          const nx = dx / dist;
          const ny = dy / dist;
          if (Math.abs(nx) > Math.abs(ny)) {
            entity.x += nx * overlap;
            collidedX = true;
          } else {
            entity.y += ny * overlap;
            collidedY = true;
          }
        }
      }
    }

    return { collidedX, collidedY };
  }

  // For bullets: return collision normal (axis-aligned) or null if none.
  // Caller reflects velocity around the normal.
  bulletCollision(x, y, radius) {
    const ts = this.tileSize;
    const cCol = Math.floor(x / ts);
    const cRow = Math.floor(y / ts);

    let bestOverlap = 0;
    let nx = 0, ny = 0;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const col = cCol + dc;
        const row = cRow + dr;
        if (!this.isWallTile(col, row)) continue;
        const wx = col * ts;
        const wy = row * ts;
        const closestX = Math.max(wx, Math.min(x, wx + ts));
        const closestY = Math.max(wy, Math.min(y, wy + ts));
        const dx = x - closestX;
        const dy = y - closestY;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < radius * radius) {
          const dist = Math.sqrt(dist2) || 0.0001;
          const overlap = radius - dist;
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            // Snap normal to dominant axis for clean Atari-style ricochets
            if (Math.abs(dx) > Math.abs(dy)) {
              nx = Math.sign(dx) || 1;
              ny = 0;
            } else {
              nx = 0;
              ny = Math.sign(dy) || 1;
            }
          }
        }
      }
    }

    if (bestOverlap > 0) {
      return { nx, ny, overlap: bestOverlap };
    }
    return null;
  }

  // DDA raycast from (x1,y1) to (x2,y2). Returns true if a wall blocks the segment.
  raycastBlocked(x1, y1, x2, y2) {
    const ts = this.tileSize;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return false;
    const steps = Math.ceil(dist / (ts * 0.4));
    const sx = dx / steps;
    const sy = dy / steps;
    let cx = x1;
    let cy = y1;
    for (let i = 0; i < steps; i++) {
      cx += sx;
      cy += sy;
      if (this.isWallAtPixel(cx, cy)) return true;
    }
    return false;
  }

  getLayoutAscii() {
    return this.layout.join('\n');
  }
}

export { MAZE_LAYOUT };
