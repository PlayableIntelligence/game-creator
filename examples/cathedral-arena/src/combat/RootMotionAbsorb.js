import * as THREE from 'three';

// Root-motion absorber — takes an animation's hip-bone drift and applies it
// to a "container" Object3D's position (vrm.scene in the tuner; the game's
// proxy mesh.position in Player/Boss). The goal is for the visual character
// to stay where the attack ended, NOT snap back to where it started when
// the idle clip replaces the attack and resets the hip.
//
// Three strategies for comparison:
//
//   'off'     — do nothing. Drift bakes into the skeleton but the
//               container doesn't move, so the idle fade-in snaps the
//               visual back to the pre-attack XZ. This is what happens
//               with no root-motion handling at all.
//
//   'instant' — at attack finish, read hip drift and add it to the
//               container in a single frame. **This is the current Player
//               behaviour and the source of the teleport the user is
//               reporting**. The attack clip is still clamped on its
//               final frame at the moment we commit, so the hip's local
//               offset is still fully drifted. For the one frame before
//               the crossfade to idle takes effect, we render:
//                   visual = container + hip_local_end
//                          = (container_start + delta) + delta
//                          = container_start + 2*delta
//               i.e. character appears TWO stride-lengths forward for a
//               single frame, then slides back as the hip blends toward
//               idle. That's the "teleport then slide" feel.
//
//   'gradual' — spread the container shift across the crossfade duration.
//               At any fraction f of the fade:
//                   visual = container_shifted_by(f * delta) +
//                            mix(hip_attack_end, hip_idle_start, f)
//               If delta ≈ (hip_attack_end - hip_idle_start) — which is
//               the definition of drift — the two terms sum to a constant
//               throughout the fade. No teleport, no slide. Visual stays
//               exactly at the end-of-attack position.
//
// Optional sanity cap: ignore implausibly large drifts (> MAX_DRIFT m).
// Guards against retarget NaNs or malformed clips teleporting the player
// halfway across the arena.
//
// The class does NOT auto-detect "when a clip finishes". The caller hooks
// mixer.addEventListener('finished', ...) and decides which clips this
// absorb applies to — different calling sites treat different clips.

const MAX_DRIFT = 8.0;
const _hipStartTmp = new THREE.Vector3();
const _hipEndTmp   = new THREE.Vector3();

export class RootMotionAbsorb {
  // vrmOrHumanoid can be a VRM or a VRM.humanoid. `target` is whatever
  // holds the XZ position the drift should absorb into — can be either:
  //   - an Object3D (we write to its `.position`): tuner's vrm.scene,
  //     game's Player.mesh.
  //   - a Vector3 (or any {x,y,z}): game's Boss.anchor.
  // THREE.Vector3 has `.isVector3 === true`, so we can disambiguate cleanly.
  constructor(vrmOrHumanoid, target, {
    strategy = 'gradual',
    fadeMs   = 250,
    onApply  = null,   // optional callback(dx, dz) — for debug readouts
  } = {}) {
    this._hum = vrmOrHumanoid.humanoid ?? vrmOrHumanoid;
    this._pos = target?.isVector3 ? target : target.position;
    this.strategy = strategy;
    this.fadeMs = fadeMs;
    this.onApply = onApply;
    this._start = null;      // Vector3 — hip world position at captureStart()
    this._pending = null;    // { dx, dz, elapsed, duration } during gradual fade
  }

  // Call right after you .play() an attack / roll clip. Snapshots hip
  // world position so the later commit() can compute drift = end - start.
  captureStart() {
    const hip = this._hum?.getRawBoneNode?.('hips');
    if (!hip) { this._start = null; return; }
    hip.updateWorldMatrix(true, false);
    if (!this._start) this._start = new THREE.Vector3();
    hip.getWorldPosition(this._start);
    // If a previous gradual absorb is still in flight, cancel it —
    // mid-absorb state would double-count against this new clip.
    this._pending = null;
  }

  // Call from the mixer.finished handler for the attack clip. Computes the
  // drift and applies it per-strategy.
  commit() {
    const hip = this._hum?.getRawBoneNode?.('hips');
    if (!hip || !this._start) return;
    hip.updateWorldMatrix(true, false);
    hip.getWorldPosition(_hipEndTmp);
    const dx = _hipEndTmp.x - this._start.x;
    const dz = _hipEndTmp.z - this._start.z;
    const mag = Math.hypot(dx, dz);
    this._start = null;
    if (mag < 0.001 || mag > MAX_DRIFT) return;

    if (this.strategy === 'off') return;

    if (this.strategy === 'instant') {
      this._pos.x += dx;
      this._pos.z += dz;
      this.onApply?.(dx, dz);
      return;
    }

    // 'gradual' — spread across fadeMs, in the per-frame update() tick.
    this._pending = {
      dx, dz,
      elapsed: 0,
      duration: Math.max(0.05, this.fadeMs / 1000),
    };
  }

  // Per-frame tick. Cheap no-op when idle. Caller integrates this into the
  // same animate loop that calls mixer.update.
  update(delta) {
    if (!this._pending) return;
    const p = this._pending;
    const remaining = p.duration - p.elapsed;
    const step = Math.min(delta, remaining) / p.duration;
    const dx = p.dx * step;
    const dz = p.dz * step;
    this._pos.x += dx;
    this._pos.z += dz;
    this.onApply?.(dx, dz);
    p.elapsed += delta;
    if (p.elapsed >= p.duration) this._pending = null;
  }

  reset() {
    this._start = null;
    this._pending = null;
  }
}
