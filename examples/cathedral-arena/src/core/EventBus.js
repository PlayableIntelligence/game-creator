/**
 * EventBus — pub/sub singleton for cross-module communication.
 * Modules NEVER import each other directly; they emit/listen on the bus.
 *
 * Naming convention: `domain:action` (e.g., `world:loaded`, `player:moved`).
 */
class _EventBus {
  constructor() {
    this._listeners = new Map();
  }

  /** Subscribe. Returns an unsubscribe function. */
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this._listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    const fns = this._listeners.get(event);
    if (!fns) return;
    for (const fn of fns) {
      try { fn(payload); }
      catch (err) { console.error(`[EventBus] listener for "${event}" threw`, err); }
    }
  }

  /** Subscribe to the next emit only. */
  once(event, fn) {
    const off = this.on(event, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }
}

export const EventBus = new _EventBus();

// Reserved event names — subsystems add their own. Keeping them centralised
// here makes typos easy to catch.
export const EVENTS = {
  // Core lifecycle (more added per step)
  BOOT_READY:    'boot:ready',
  BOOT_FAILED:   'boot:failed',
  // World loading
  WORLD_LOADING: 'world:loading',
  WORLD_LOADED:  'world:loaded',
  WORLD_FAILED:  'world:failed',
  SPLAT_MESH_READY: 'splat:mesh-ready',  // fires for each tier (mini, low, full)
};
