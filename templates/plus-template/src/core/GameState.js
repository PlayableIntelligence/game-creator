/**
 * GameState — single centralized state object. Systems read; events trigger
 * mutations. reset() is idempotent.
 *
 * Step 1 scope: just boot state. Player / world state added in later steps.
 */
export const GameState = {
  booted: false,
  bootError: null,
  worldLoaded: false,
  worldMeta: null,
  worldBbox: null,                  // THREE.Box3 — set after collider peek
  worldFloorY: 0,                   // raycast hit y from bbox centre
  fakeFloorTopY: 0,                 // top of the smooth slab — spawn ref height
  colliderTriangles: 0,
  // Player state (populated when Capsule is spawned in step 5)
  player: null,

  reset() {
    this.booted = false;
    this.bootError = null;
    this.worldLoaded = false;
    this.worldMeta = null;
    this.worldBbox = null;
    this.worldFloorY = 0;
    this.fakeFloorTopY = 0;
    this.colliderTriangles = 0;
    this.player = null;
  },
};
