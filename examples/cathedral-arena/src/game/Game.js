import * as THREE from 'three';
import { NetworkManager } from '../multiplayer/NetworkManager.js';
import { RemotePlayer } from '../multiplayer/RemotePlayer.js';
import { ARENA, COMBAT, MULTIPLAYER } from '../core/Constants.js';

/**
 * Cathedral Arena — multiplayer souls-style PvP demo.
 *
 *   - Local player: VRM character (already loaded by Capsule via plus-template).
 *     Click to attack — broadcasts network:attack and runs a 2m / 60° cone
 *     hitbox check against every RemotePlayer.
 *   - Remote players: lit by NetworkManager `network:player-joined` events,
 *     re-positioned each `network:state-received`. They have their own VRM
 *     loaded and a slim animation cycle (idle / walking / hit).
 *   - HP / death / respawn: tracked locally, server is just a relay
 *     (last-write-wins). Damage: receiver applies damage → broadcasts
 *     state with new HP → death triggers a 3s respawn at next spawn point.
 *
 * Keys:
 *   - LMB              — light attack (1.0m reach, 60° cone, 25 damage)
 *   - WASD + Shift     — locomotion (handled by plus-template Capsule)
 *   - Space            — jump (Capsule)
 */

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Game {
  constructor() {
    // Plus-template runtime refs
    this.scene = null; this.world = null; this.physics = null;
    this.camera = null; this.hud = null; this.capsule = null;

    // Combat state for the local player
    this.hp = COMBAT.MAX_HP;
    this.alive = true;
    this.lastAttackAt = 0;
    this.respawnAt = 0;

    // Multiplayer
    this.net = null;
    this.remotePlayers = new Map();   // playerId -> RemotePlayer
    this.spawnPoints = [];            // computed in onWorldLoaded
    this.lastTickAt = 0;

    // HUD elements (created in onWorldLoaded)
    this.hpBar = null;
    this.netStatus = null;
  }

  // -------------------------------------------------------------------------
  // Lifecycle hooks
  // -------------------------------------------------------------------------

  async onWorldLoaded({ scene, world, physics, camera, hud }) {
    this.scene = scene; this.world = world; this.physics = physics;
    this.camera = camera; this.hud = hud;

    // Compute 4 spawn points around the cathedral floor
    const ctr = world.collider.bbox.getCenter(new THREE.Vector3());
    const r = ARENA.SPAWN_RADIUS;
    this.spawnPoints = [0, 1, 2, 3].map((i) => {
      const angle = (i / 4) * Math.PI * 2;
      return new THREE.Vector3(
        ctr.x + Math.cos(angle) * r,
        world.fakeFloor.topY,
        ctr.z + Math.sin(angle) * r,
      );
    });

    // HUD widgets
    this._installHud(hud);

    // Multiplayer — NetworkManager wires partysocket + emits state-received,
    // player-joined, etc. on its EventBus. We listen via callbacks below.
    this.net = new NetworkManager({
      url: MULTIPLAYER.SERVER_URL,
      room: MULTIPLAYER.DEFAULT_ROOM,
      onConnected:    (id) => this._onConnected(id),
      onDisconnected: () => this._onDisconnected(),
      onPlayerJoined: (peer) => this._onPlayerJoined(peer),
      onPlayerLeft:   (id) => this._onPlayerLeft(id),
      onState:        (id, state) => this._onRemoteState(id, state),
      onAttack:       (id, evt) => this._onRemoteAttack(id, evt),
      onDamage:       (id, hp) => this._onRemoteDamage(id, hp),
    });
    this.net.connect();
  }

  onPlayerSpawn({ capsule, character }) {
    this.capsule = capsule;
    this.character = character;
    // Spawn local player at a random spawn point
    const sp = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
    capsule.body.setTranslation({ x: sp.x, y: sp.y + 0.5, z: sp.z }, true);
  }

  onClick(_hit) {
    if (!this.alive) return;
    const now = performance.now();
    if (now - this.lastAttackAt < COMBAT.ATTACK_COOLDOWN_MS) return;
    this.lastAttackAt = now;
    this._performLocalAttack();
  }

  onKeyDown(_code) { /* reserved for future block / roll */ }

  onUpdate(dt) {
    // Lerp remote players toward their last-known network state
    for (const rp of this.remotePlayers.values()) rp.update(dt);

    // Death → respawn timer
    if (!this.alive && performance.now() >= this.respawnAt) {
      this._respawn();
    }

    this._renderHud();
  }

  onFixedUpdate(_dt) {
    // Broadcast our state at TICK_RATE_HZ
    if (!this.net?.connected || !this.capsule?.body) return;
    const now = performance.now();
    if (now - this.lastTickAt < (1000 / MULTIPLAYER.TICK_RATE_HZ)) return;
    this.lastTickAt = now;

    const t = this.capsule.body.translation();
    const yaw = this.capsule.cameraMode?.getCapsuleYaw?.() ?? 0;
    this.net.sendState({
      x: t.x, y: t.y, z: t.z,
      yaw,
      hp: this.hp,
      alive: this.alive,
    });
  }

  // -------------------------------------------------------------------------
  // Local combat
  // -------------------------------------------------------------------------

  _performLocalAttack() {
    if (!this.capsule?.body) return;

    // Hitbox = 60° cone in front of local player, reach COMBAT.ATTACK_REACH.
    // Check every remote player and collect IDs that are inside the cone.
    const t = this.capsule.body.translation();
    const yaw = this.capsule.cameraMode?.getCapsuleYaw?.() ?? 0;
    const facing = _v.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
    const origin = _v2.set(t.x, t.y + 1.0, t.z);   // chest height

    const hits = [];
    for (const [id, rp] of this.remotePlayers) {
      if (!rp.alive) continue;
      const dx = rp.position.x - origin.x;
      const dz = rp.position.z - origin.z;
      const dist = Math.hypot(dx, dz);
      if (dist > COMBAT.ATTACK_REACH) continue;
      // Angle between facing and hit vector
      const dirX = dx / Math.max(dist, 0.0001);
      const dirZ = dz / Math.max(dist, 0.0001);
      const dot = facing.x * dirX + facing.z * dirZ;
      const cosThreshold = Math.cos(COMBAT.ATTACK_CONE_RAD * 0.5);
      if (dot < cosThreshold) continue;
      hits.push(id);
    }

    // Broadcast attack so remotes can play hit FX even on other clients
    this.net?.sendAttack({
      origin: { x: origin.x, y: origin.y, z: origin.z },
      facing: { x: facing.x, z: facing.z },
      reach: COMBAT.ATTACK_REACH,
      hits,
      damage: COMBAT.ATTACK_DAMAGE,
    });

    // Apply local visual feedback
    for (const id of hits) {
      const rp = this.remotePlayers.get(id);
      if (rp) rp.flashHit();
    }
  }

  _takeDamage(amount, fromId) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.alive = false;
      this.respawnAt = performance.now() + COMBAT.RESPAWN_DELAY_MS;
      this._showDeathOverlay(fromId);
    }
  }

  _respawn() {
    this.hp = COMBAT.MAX_HP;
    this.alive = true;
    this._hideDeathOverlay();
    const sp = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
    this.capsule.body.setTranslation({ x: sp.x, y: sp.y + 0.5, z: sp.z }, true);
  }

  // -------------------------------------------------------------------------
  // Network event handlers
  // -------------------------------------------------------------------------

  _onConnected(id) {
    this.netStatus.textContent = `online · id ${id.slice(0, 6)}`;
    this.netStatus.style.color = '#4ade80';
  }

  _onDisconnected() {
    this.netStatus.textContent = 'offline (single-player)';
    this.netStatus.style.color = '#888';
  }

  _onPlayerJoined(peer) {
    if (this.remotePlayers.has(peer.playerId)) return;
    const rp = new RemotePlayer(this.scene, {
      playerId: peer.playerId,
      floorY: this.world.fakeFloor.topY,
    });
    this.remotePlayers.set(peer.playerId, rp);
    if (peer.state) rp.applyState(peer.state);
  }

  _onPlayerLeft(id) {
    const rp = this.remotePlayers.get(id);
    if (rp) {
      rp.dispose();
      this.remotePlayers.delete(id);
    }
  }

  _onRemoteState(id, state) {
    let rp = this.remotePlayers.get(id);
    if (!rp) {
      // Late-arriving state for an unknown peer — auto-create
      this._onPlayerJoined({ playerId: id, state });
      rp = this.remotePlayers.get(id);
    }
    rp?.applyState(state);
  }

  _onRemoteAttack(attackerId, evt) {
    // If our local id is in the attacker's hit list, take damage
    if (Array.isArray(evt.hits) && evt.hits.includes(this.net?.playerId)) {
      this._takeDamage(evt.damage ?? COMBAT.ATTACK_DAMAGE, attackerId);
    }
    // Also flash any remote player in the hit list
    for (const targetId of (evt.hits ?? [])) {
      const rp = this.remotePlayers.get(targetId);
      if (rp) rp.flashHit();
    }
  }

  _onRemoteDamage(_id, _hp) {
    // Reserved — currently we infer damage from attacks. Could use this for
    // server-authoritative HP later.
  }

  // -------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------

  _installHud(hud) {
    // HP bar — bottom-left
    const slotBL = hud.getSlot('bl');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-width:280px';
    const hpLabel = document.createElement('div');
    hpLabel.style.cssText = 'font-size:11px;color:#888;letter-spacing:1px;text-transform:uppercase';
    hpLabel.textContent = 'HP';
    const hpOuter = document.createElement('div');
    hpOuter.style.cssText = 'height:14px;background:rgba(0,0,0,0.5);border:1px solid #333;border-radius:2px;overflow:hidden';
    const hpInner = document.createElement('div');
    hpInner.style.cssText = 'height:100%;width:100%;background:linear-gradient(90deg,#c01010,#ff4444);transition:width 0.15s';
    hpOuter.appendChild(hpInner);
    wrap.append(hpLabel, hpOuter);
    slotBL?.appendChild(wrap);
    this.hpBar = hpInner;

    // Net status — top-right
    const slotTR = hud.getSlot('tr');
    const status = document.createElement('div');
    status.style.cssText = 'font-size:12px;color:#888;font-family:ui-monospace,monospace';
    status.textContent = 'connecting…';
    slotTR?.appendChild(status);
    this.netStatus = status;
  }

  _renderHud() {
    if (this.hpBar) {
      const pct = (this.hp / COMBAT.MAX_HP) * 100;
      this.hpBar.style.width = `${pct}%`;
    }
  }

  _showDeathOverlay(_fromId) {
    if (this._deathDiv) return;
    const div = document.createElement('div');
    div.style.cssText = `
      position: fixed; inset: 0; background: rgba(20,0,0,0.6);
      display: flex; align-items: center; justify-content: center;
      font-family: serif; font-size: 80px; color: #ff4444;
      letter-spacing: 8px; text-transform: uppercase;
      pointer-events: none; z-index: 1000;
      text-shadow: 0 0 20px rgba(255,68,68,0.6);
    `;
    div.textContent = 'You Died';
    document.body.appendChild(div);
    this._deathDiv = div;
  }

  _hideDeathOverlay() {
    if (this._deathDiv) {
      this._deathDiv.remove();
      this._deathDiv = null;
    }
  }
}
