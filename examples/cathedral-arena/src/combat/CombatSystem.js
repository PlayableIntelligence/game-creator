import * as THREE from 'three';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { COMBAT } from '../core/Constants.js';

// Central arbiter for sword-swings and damage.
//
// Hit detection:
//   1. When Player or Boss starts a swing, they register it with the action +
//      spec + a reference to their sword prop.
//   2. Each frame during the clip's normalised-time `hitWindow`, we read the
//      sword's world position (updateWorldMatrix first — bone pose was just
//      flushed by the mixer, but matrixWorld propagation only happens during
//      renderer.render by default) and test distance against the target's
//      body sphere center.
//   3. First frame the distance falls inside (bladeRadius + bodyRadius), we
//      fire damage ONCE for this swing. `fired` guard prevents re-hitting
//      on subsequent frames inside the same window.
//
// The previous version did ONE facing-cone check at the moment the hit
// window opened. That's why hits felt unreliable: if the player reoriented
// by a frame, or the boss stepped sideways during the wind-up, the single
// sample missed even when the sword visibly passed through. Per-frame
// tracking of the actual sword position fixes it.
//
// Event payloads now carry `point` (world-space impact) so feedback layers
// (HitFX, DamageFloaters, camera shake) know where to spawn.

const _tmpVec = new THREE.Vector3();
const _bodyCenter = new THREE.Vector3();
const _swordWorld = new THREE.Vector3();

// Body hurtbox approximations. The boss VRM at 3.5× scale reads as a
// barrel-chested humanoid ~6m tall — centre-mass at waist height, chest
// width ~1m, so a 1.3m sphere at mid-body catches sword passes that look
// like they should land. Player capsule is 0.35 × 0.9, sphere 0.55 around
// the waist (mesh.position, centre-of-capsule) is a match.
const BOSS_BODY = { yOffset: 1.75, radius: 1.3 };
const PLAYER_BODY = { yOffset: 0.0,  radius: 0.55 };
// Blade sphere — generous enough that grazing passes read as hits, tight
// enough that a clear miss reads as a miss.
const BLADE_RADIUS = 0.55;

export class CombatSystem {
  constructor() {
    this.player = null;
    this.boss   = null;
    this._active = new Map();   // attacker id → { action, spec, fired, sword, attacker }
  }

  bind({ player, boss }) {
    this.player = player;
    this.boss   = boss;
  }

  registerPlayerAttack(action, spec) {
    this._active.set('player', {
      action, spec,
      fired: false,
      attacker: 'player',
      sword: this.player?.sword ?? null,
    });
  }

  registerBossAttack(action, spec) {
    this._active.set('boss', {
      action, spec,
      fired: false,
      attacker: 'boss',
      sword: this.boss?.sword ?? null,
    });
  }

  update(delta) {
    if (this._active.size === 0) return;
    for (const [key, a] of this._active) {
      if (!a.action || !a.action.isRunning()) {
        this._active.delete(key);
        continue;
      }
      const progress = a.action.time / a.action.getClip().duration;
      const [open, close] = a.spec.hitWindow;
      if (!a.fired && progress >= open && progress <= close) {
        const hit = a.attacker === 'player'
          ? this._checkPlayerHit(a)
          : this._checkBossHit(a);
        if (hit) a.fired = true;
      }
      // Drop once the swing has fully played out so we don't leak entries.
      if (progress >= 0.98) this._active.delete(key);
    }
  }

  // Returns true if a hit was registered + damage dealt.
  _checkPlayerHit(a) {
    if (!this.player || !this.boss || !this.boss._vrmRoot) return false;
    if (gameState.bossHP <= 0) return false;
    // Boss body centre in world space.
    _bodyCenter.copy(this.boss._vrmRoot.position);
    _bodyCenter.y += BOSS_BODY.yOffset;
    const reach = BOSS_BODY.radius + BLADE_RADIUS;
    const point = this._swordTestAgainst(a.sword, _bodyCenter, reach);
    if (!point) {
      // Fallback: no sword ref (sword not loaded yet?). Use the old cone test
      // so gameplay still works in the edge case.
      return this._fallbackPlayerConeHit(a.spec);
    }
    this.dealBossDamage(a.spec.damage, point);
    return true;
  }

  _checkBossHit(a) {
    if (!this.player || !this.boss || !this.boss._vrmRoot) return false;
    if (gameState.playerHP <= 0) return false;
    _bodyCenter.copy(this.player.mesh.position);
    _bodyCenter.y += PLAYER_BODY.yOffset;
    const reach = PLAYER_BODY.radius + BLADE_RADIUS;
    const point = this._swordTestAgainst(a.sword, _bodyCenter, reach);
    if (!point) {
      return this._fallbackBossConeHit(a.spec);
    }
    this.dealPlayerDamage(a.spec.damage, a.spec.blockedDamage, point);
    return true;
  }

  // Returns the sword world position on hit, or null on miss/no-ref. Forces
  // a matrixWorld update up the bone chain so the check uses the CURRENT
  // frame's pose — player.update / boss.update ran just before us but only
  // the mixer+humanoid stages, not the matrixWorld cascade.
  _swordTestAgainst(sword, center, reach) {
    if (!sword) return null;
    sword.updateWorldMatrix(true, false);
    sword.getWorldPosition(_swordWorld);
    const dx = _swordWorld.x - center.x;
    const dy = _swordWorld.y - center.y;
    const dz = _swordWorld.z - center.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > reach * reach) return null;
    // Return the midpoint between sword and body as the impact point —
    // looks right for FX regardless of which side the blade came from.
    return _tmpVec.set(
      (_swordWorld.x + center.x) * 0.5,
      (_swordWorld.y + center.y) * 0.5,
      (_swordWorld.z + center.z) * 0.5,
    );
  }

  // Legacy fall-through — only fires if the swing has no sword reference,
  // which in practice means the prop FBX hasn't loaded yet on first frames.
  _fallbackPlayerConeHit(spec) {
    const pPos = this.player.mesh.position;
    const bPos = this.boss._vrmRoot.position;
    const dx = bPos.x - pPos.x, dz = bPos.z - pPos.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > spec.hitRange * spec.hitRange) return false;
    const dist = Math.sqrt(distSq);
    const fx = Math.sin(this.player.mesh.rotation.y);
    const fz = Math.cos(this.player.mesh.rotation.y);
    const dot = (dx * fx + dz * fz) / Math.max(0.001, dist);
    if (dot < 0.35) return false;
    this.dealBossDamage(spec.damage, _bodyCenter);
    return true;
  }

  _fallbackBossConeHit(spec) {
    const bPos = this.boss._vrmRoot.position;
    const pPos = this.player.mesh.position;
    const dx = pPos.x - bPos.x, dz = pPos.z - bPos.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > spec.hitRange * spec.hitRange) return false;
    const dist = Math.sqrt(distSq);
    const facing = this.boss.facingVec ? this.boss.facingVec() : _tmpVec.set(0, 0, -1);
    const cosTheta = (dx * facing.x + dz * facing.z) / Math.max(0.001, dist);
    const coneCos = Math.cos((spec.hitConeDegrees * Math.PI / 180) / 2);
    if (cosTheta < coneCos) return false;
    this.dealPlayerDamage(spec.damage, spec.blockedDamage, _bodyCenter);
    return true;
  }

  // Public APIs — boss AI can call dealPlayerDamage directly for non-animated
  // damage sources (e.g. future AoE pulse). Both funnel into the same
  // mitigation + event emit path so UI reacts identically.
  dealPlayerDamage(raw, blockedRaw, point) {
    if (gameState.gameOver || gameState.playerHP <= 0) return;
    if (this.player?.isInvulnerable?.()) {
      eventBus.emit(Events.PLAYER_DAMAGE, { damage: 0, blocked: false, iframed: true, point });
      return;
    }
    let dmg = raw;
    let blocked = false;
    if (this.player?.isBlockingToward?.(this.boss?._vrmRoot?.position)) {
      dmg = blockedRaw ?? Math.round(raw * (1 - COMBAT.PLAYER.blockMitigation));
      blocked = true;
    }
    gameState.playerHP = Math.max(0, gameState.playerHP - dmg);
    eventBus.emit(Events.PLAYER_DAMAGE, { damage: dmg, blocked, hp: gameState.playerHP, point });
    if (gameState.playerHP <= 0) {
      gameState.gameOver = true;
      gameState.deaths += 1;
      eventBus.emit(Events.PLAYER_DEATH, {});
    }
  }

  dealBossDamage(raw, point) {
    if (gameState.bossHP <= 0) return;
    gameState.bossHP = Math.max(0, gameState.bossHP - raw);
    eventBus.emit(Events.BOSS_DAMAGE, { damage: raw, hp: gameState.bossHP, point });
    const frac = gameState.bossHP / gameState.bossMaxHP;
    if (gameState.bossPhase === 1 && frac <= COMBAT.AI.phase2HPThreshold) {
      gameState.bossPhase = 2;
    }
    if (gameState.bossHP <= 0) {
      eventBus.emit(Events.BOSS_DEFEAT, {});
    }
  }
}
