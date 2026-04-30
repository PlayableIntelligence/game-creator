// --- Display ---

export const DPR = Math.min(window.devicePixelRatio || 1, 2);

const DESIGN_W = 1280;
const DESIGN_H = 720;
const DESIGN_ASPECT = DESIGN_W / DESIGN_H;

const _deviceW = window.innerWidth * DPR;
const _deviceH = window.innerHeight * DPR;

let _canvasW, _canvasH;
if (_deviceW / _deviceH > DESIGN_ASPECT) {
  _canvasW = Math.round(_deviceH * DESIGN_ASPECT);
  _canvasH = _deviceH;
} else {
  _canvasW = _deviceW;
  _canvasH = Math.round(_deviceW / DESIGN_ASPECT);
}

export const PX = _canvasW / DESIGN_W;

// Pixel art is rendered to canvas at 1px-per-source-pixel, then scaled at
// display time via Phaser. SPRITE_SCALE matches PX so the art lines up with
// design coordinates (a 32-design-px tile uses a 32-source-pixel matrix
// scaled by PX).
export const SPRITE_SCALE = PX;

export const GAME = {
  WIDTH: _canvasW,
  HEIGHT: _canvasH,
  DESIGN_W,
  DESIGN_H,
};

// --- Safe Zone (Play.fun SDK insets) ---
function _readSafeInsets() {
  const s = getComputedStyle(document.documentElement);
  const top = parseInt(s.getPropertyValue('--ogp-safe-top-inset')) || 0;
  const bottom = parseInt(s.getPropertyValue('--ogp-safe-bottom-inset')) || 0;
  return { top: top * DPR, bottom: bottom * DPR };
}
const _insets = _readSafeInsets();

export const SAFE_ZONE = {
  TOP: Math.max(GAME.HEIGHT * 0.05, _insets.top),
  BOTTOM: _insets.bottom,
  LEFT: 0,
  RIGHT: 0,
};

// --- Maze ---
// Tile size is in DESIGN pixels; multiply by PX when rendering.
export const MAZE = {
  TILE_SIZE: 32,
  COLS: 40,
  ROWS: 22,
  WALL_COLOR: 0x444c5e,
  FLOOR_COLOR: 0x1a1d24,
};

// --- Tank ---
// Speeds are in design pixels/sec; entities multiply by PX for rendering.
export const TANK = {
  WIDTH: 28,
  HEIGHT: 22,
  TURRET_LENGTH: 18,
  TURRET_WIDTH: 5,
  TURN_SPEED: 2.5,
  THRUST: 110,
  REVERSE_THRUST: 80,
  MAX_SPEED: 130,
  DRAG: 0.92,
  FIRE_COOLDOWN_MS: 600,
};

// --- Bullet ---
export const BULLET = {
  SPEED: 280,
  RADIUS: 3,
  MAX_BOUNCES: 2,
  LIFETIME_MS: 4000,
  SELF_HIT_GRACE_MS: 200,
};

// --- Round ---
export const ROUND = {
  COUNTDOWN_MS: 2000,
  RESTART_DELAY_MS: 3000,
};

// --- Colors ---
export const COLORS = {
  RED: 0xe74c3c,
  BLUE: 0x3498db,
  GREEN: 0x2ecc71,
  YELLOW: 0xf1c40f,
  BG: 0x0a0c10,
  WALL: 0x444c5e,
  WALL_HIGHLIGHT: 0x5a6378,
  FLOOR: 0x1a1d24,
  BULLET: 0xffe066,
  MUZZLE: 0xfff2a8,
  UI_TEXT: '#ffffff',
  UI_SHADOW: '#000000',
  MUTED_TEXT: '#8888aa',
};

const TILE = MAZE.TILE_SIZE;
const tileCenter = (col, row) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });

// Spawn positions are in DESIGN coordinates (pre-PX).
// Facing toward the maze center for visual fairness.
// Corners fill in join-order: 1st player → RED, 2nd → BLUE, etc.
// Empty corners stay empty (no NPCs).
export const SPAWNS = [
  { color: 'RED',    ...tileCenter(2, 2),                  facing: Math.PI / 4 },
  { color: 'BLUE',   ...tileCenter(MAZE.COLS - 3, 2),      facing: (3 * Math.PI) / 4 },
  { color: 'GREEN',  ...tileCenter(2, MAZE.ROWS - 3),      facing: -Math.PI / 4 },
  { color: 'YELLOW', ...tileCenter(MAZE.COLS - 3, MAZE.ROWS - 3), facing: (-3 * Math.PI) / 4 },
];

// --- UI sizing ---
export const UI = {
  FONT: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  TITLE_RATIO: 0.10,
  HEADING_RATIO: 0.06,
  BODY_RATIO: 0.035,
  SMALL_RATIO: 0.025,
};

// --- Transitions ---
export const TRANSITION = {
  FADE_DURATION: 300,
};

// --- Polish (Step 2 — visual juice) ---
// All values are tuned for the design coordinate system (multiply by PX where rendered).
export const POLISH = {
  // Muzzle flash
  MUZZLE_SCALE_BASE: 1.0,
  MUZZLE_SCALE_PEAK: 1.6,
  MUZZLE_GROW_MS: 30,
  MUZZLE_FADE_MS: 80,
  MUZZLE_SPARK_COUNT: 4,
  MUZZLE_SPARK_SPEED: 180,
  MUZZLE_SPARK_SPREAD_DEG: 28,
  MUZZLE_SPARK_LIFE_MS: 220,
  MUZZLE_SPARK_SIZE: 2,
  MUZZLE_SPARK_COLOR: 0xfff2a8,

  // Tank smoke trail (when thrusting)
  SMOKE_INTERVAL_MS: 80,
  SMOKE_SIZE: 4,
  SMOKE_LIFE_MS: 600,
  SMOKE_DRIFT: 18,
  SMOKE_ALPHA_START: 0.55,
  SMOKE_COLOR: 0x7a7a82,

  // Ricochet sparks
  RICOCHET_SPARK_COUNT: 5,
  RICOCHET_SPARK_SPEED: 220,
  RICOCHET_SPARK_SPREAD_DEG: 70,
  RICOCHET_SPARK_LIFE_MS: 200,
  RICOCHET_SPARK_SIZE: 2,
  RICOCHET_SPARK_COLOR_A: 0xffffff,
  RICOCHET_SPARK_COLOR_B: 0xffe066,
  RICOCHET_FLASH_RADIUS: 6,
  RICOCHET_FLASH_LIFE_MS: 90,

  // Tank death explosion
  EXPLOSION_FRAME_MS: 110,
  EXPLOSION_FRAMES: 4,
  EXPLOSION_DISPLAY_SIZE: 56,
  SHAKE_DURATION_MS: 140,
  SHAKE_INTENSITY: 0.006,
  DEATH_SMOKE_COUNT: 10,
  DEATH_SMOKE_LIFE_MS: 800,
  DEATH_SMOKE_SIZE: 4,
  DEATH_SMOKE_DRIFT_UP: 60,
  DEATH_SMOKE_DRIFT_LATERAL: 25,
  DEATH_SMOKE_COLOR: 0x222630,
  DEATH_FREEZE_TIMESCALE: 0.35,
  DEATH_FREEZE_MS: 90,

  // Crown for round winner
  CROWN_BOB_DISTANCE: 4,
  CROWN_BOB_MS: 800,
  CROWN_OFFSET_Y: -22,

  // Draw desaturate flash
  DRAW_TINT_COLOR: 0x556070,
  DRAW_TINT_MS: 600,

  // Round transition juice
  COUNTDOWN_GROW_FROM: 1.4,
  COUNTDOWN_GROW_MS: 300,
  GO_TEXT_LIFE_MS: 400,
  GO_TEXT_SCALE_FROM: 0.6,
  GO_TEXT_SCALE_TO: 2.0,
  WINNER_BANNER_HOLD_MS: 1800,
  WINNER_BANNER_SLIDE_MS: 350,

  // Bullet trail
  BULLET_TRAIL_LENGTH: 6,
  BULLET_TRAIL_ALPHA: 0.6,
  BULLET_TRAIL_WIDTH: 3,

  // Vignette
  VIGNETTE_INNER_ALPHA: 0,
  VIGNETTE_OUTER_ALPHA: 0.55,
};

// --- Multiplayer ---
// Deploy your own PartyKit server (`cd multiplayer-server && npx partykit deploy`)
// and replace this placeholder with the URL it prints. The placeholder lets the
// game build cleanly; offline-fallback runs when SERVER_URL is unreachable.
// Local dev: set VITE_MULTIPLAYER_SERVER_URL in .env to override (e.g.
// http://127.0.0.1:1999 for `npx partykit dev`).
export const MULTIPLAYER = {
  SERVER_URL: 'https://YOUR-PROJECT.YOUR-USER.partykit.dev',
  DEFAULT_ROOM: 'lobby',
  MAX_PLAYERS: 4,
  TICK_RATE_HZ: 20,
  RECONNECT_BASE_BACKOFF_MS: 500,
  RECONNECT_MAX_BACKOFF_MS: 8000,
  RECONNECT_MAX_ATTEMPTS: 10,
  STALE_PLAYER_MS: 3000,
  PROTOCOL_VERSION: 1,
};
