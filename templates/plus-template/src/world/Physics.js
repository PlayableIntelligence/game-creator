import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS } from '../core/Constants.js';

/**
 * Physics — Rapier 3D wrapper with fixed-timestep integration.
 *
 * Rapier ships as a WASM module that requires async init. Call:
 *   const physics = await Physics.create();
 *
 * Then step() each render frame. The accumulator pattern decouples physics
 * cadence (60 Hz fixed) from render rate (whatever the display gives us);
 * onStep is the place to drive kinematic character controllers so they see
 * consistent timesteps regardless of FPS.
 */
export class Physics {
  static async create() {
    await RAPIER.init();
    return new Physics();
  }

  constructor() {
    this.world = new RAPIER.World(PHYSICS.gravity);
    this.world.timestep = PHYSICS.timestep;
    this._accumulator = 0;
  }

  /**
   * Step physics with a render-loop dt. Spirals are bounded by maxSubsteps —
   * if we fall behind, we drop frames rather than freeze the tab.
   *
   * onStep fires once per fixed step (not per render frame), with the fixed
   * dt as its argument. Use it for kinematic character controllers.
   */
  step(dt, onStep) {
    this._accumulator += Math.min(dt, 0.25);   // clamp huge dt (tab refocus)
    let n = 0;
    while (this._accumulator >= PHYSICS.timestep && n < PHYSICS.maxSubsteps) {
      onStep?.(PHYSICS.timestep);
      this.world.step();
      this._accumulator -= PHYSICS.timestep;
      n++;
    }
  }
}

export { RAPIER };
