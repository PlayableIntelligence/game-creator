import * as THREE from 'three';
import { NetworkManager } from '../multiplayer/NetworkManager.js';
import { RemotePlayer } from '../multiplayer/RemotePlayer.js';
import { CombatController } from './CombatController.js';
import { ARENA, COMBAT, MULTIPLAYER } from '../core/Constants.js';

/**
 * Cathedral Arena — multiplayer souls-style PvP demo.
 *
 *   - Local player: VRM character (loaded by plus-template Capsule) with a
 *     greatsword attached to the right-hand bone, driven by the souls-style
 *     CombatController state machine (light/heavy/roll/block/hit/death +
 *     stamina + i-frames).
 *   - Remote players: lit by NetworkManager `network:player-joined` events,
 *     re-positioned each `network:state-received`, and animated from the
 *     broadcast `animState` so remote swings/blocks/rolls all play.
 *   - HP / death / respawn: tracked locally, server is just a relay
 *     (last-write-wins). Damage: receiver applies damage from incoming attack
 *     events → broadcasts state with new HP → death triggers a 3s respawn at
 *     the next spawn point.
 *
 * Controls:
 *   - LMB              — light attack
 *   - RMB              — heavy attack
 *   - F (held)         — block (mitigates 75% of incoming damage)
 *   - Space            — dodge roll (i-frames during 60% of the roll)
 *   - WASD + Shift     — locomotion (handled by plus-template Capsule)
 */

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Game {
  constructor() {
    // Plus-template runtime refs
    this.scene = null; this.world = null; this.physics = null;
    this.camera = null; this.hud = null; this.capsule = null;

    // Combat state for the local player
    this.hp = COMBAT.MAX_HP;
    this.alive = true;
    this.respawnAt = 0;

    // Souls-style combat state machine — wired in onPlayerSpawn once the
    // character has loaded.
    this.combat = null;
    this._swordAttached = false;
    // Per-swing flag — set on swing start, fires hits at the start of the
    // active-frames window (30%-70% of the animation), cleared at swing end.
    this._swingHitsFired = false;

    // Multiplayer
    this.net = null;
    this.remotePlayers = new Map();   // playerId -> RemotePlayer
    this.spawnPoints = [];            // computed in onWorldLoaded
    this.lastTickAt = 0;

    // HUD elements (created in onWorldLoaded)
    this.hpBar = null;
    this.staminaBar = null;
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

    // Combat controller — owns sword + state machine. AttachSword runs once
    // the VRM is loaded; we poll because the character load is async and
    // doesn't currently emit a "ready" event.
    this.combat = new CombatController({
      capsule,
      scene: this.scene,
      onStateChange: (s) => this._onLocalAnimChanged(s),
      isAlive: () => this.alive,
    });
    // Tell the capsule to defer animation control to the combat controller
    // (so locked action anims like lightAttack don't get stomped by the
    // locomotion picker every frame).
    capsule.combat = this.combat;
    this._waitForCharacterAndAttachSword();
  }

  async _waitForCharacterAndAttachSword() {
    const start = performance.now();
    while (performance.now() - start < 30000) {
      if (this.capsule?.character?.loaded) {
        await this.combat.attachSword();
        this._swordAttached = true;
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    console.warn('[Game] character never loaded — sword not attached');
  }

  /** Right-mouse / left-mouse attack input. button: 0 = LMB, 2 = RMB. */
  onMouseDown(button) {
    if (!this.alive || !this.combat) return;
    if (button === 0) {
      if (this.combat.lightAttack()) this._swingHitsFired = false;
    } else if (button === 2) {
      if (this.combat.heavyAttack()) this._swingHitsFired = false;
    }
  }

  /** Old click hook — Game.js used to use this for LMB attacks. We now route
   *  attacks through onMouseDown so we can tell LMB from RMB; keep the hook
   *  as a no-op for compatibility with main.js's pointer-down listener. */
  onClick(_hit) { /* superseded by onMouseDown */ }

  /** Discrete keypress events from main.js (KeyF, Space, etc.). */
  onKeyDown(code) {
    if (!this.alive || !this.combat) return;
    if (code === 'KeyF') this.combat.setBlocking(true);
    else if (code === 'Space') this.combat.roll();
  }

  /** Key release events (block-on-release). */
  onKeyUp(code) {
    if (!this.combat) return;
    if (code === 'KeyF') this.combat.setBlocking(false);
  }

  onUpdate(dt) {
    // Lerp remote players toward their last-known network state
    for (const rp of this.remotePlayers.values()) rp.update(dt);

    // Tick the combat state machine — drives stamina regen + lock expiry
    this.combat?.update(dt);

    // Once we're inside the active-frames window of a swing, fire the hitbox
    // check exactly once per swing — feels in-sync with the animation rather
    // than the input frame.
    if (this.combat && !this._swingHitsFired && this.combat.isAttackActive()) {
      this._swingHitsFired = true;
      const isHeavy = this.combat._lock === 'heavyAttack';
      this._performLocalAttackHit(isHeavy);
    }

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
    const animState = this.combat?.getBroadcastState?.() ?? 'idle';
    this.net.sendState({
      x: t.x, y: t.y, z: t.z,
      yaw,
      hp: this.hp,
      alive: this.alive,
      animState,
    });
  }

  // -------------------------------------------------------------------------
  // Local combat
  // -------------------------------------------------------------------------

  _performLocalAttackHit(isHeavy) {
    if (!this.capsule?.body) return;

    const damage = isHeavy ? COMBAT.HEAVY_DAMAGE : COMBAT.ATTACK_DAMAGE;
    const reach = COMBAT.ATTACK_REACH * (isHeavy ? 1.15 : 1.0);

    // Hitbox = 60° cone in front of local player at chest height.
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
      if (dist > reach) continue;
      const dirX = dx / Math.max(dist, 0.0001);
      const dirZ = dz / Math.max(dist, 0.0001);
      const dot = facing.x * dirX + facing.z * dirZ;
      const cosThreshold = Math.cos(COMBAT.ATTACK_CONE_RAD * 0.5);
      if (dot < cosThreshold) continue;
      hits.push(id);
    }

    // Broadcast the swing — remotes flash, victims subtract HP locally.
    this.net?.sendAttack({
      origin: { x: origin.x, y: origin.y, z: origin.z },
      facing: { x: facing.x, z: facing.z },
      reach,
      hits,
      damage,
      kind: isHeavy ? 'heavy' : 'light',
    });

    // Apply local visual feedback
    for (const id of hits) {
      const rp = this.remotePlayers.get(id);
      if (rp) rp.flashHit();
    }
  }

  _takeDamage(amount, fromId) {
    if (!this.alive) return;
    // Block mitigation — passively soaked when F is held
    const mit = this.combat?.blockMitigation?.() ?? 0;
    const final = Math.max(0, amount * (1 - mit));
    if (this.combat && !this.combat.invulnerable && final > 0) this.combat.takeHit();
    this.hp = Math.max(0, this.hp - final);
    if (this.hp <= 0) {
      this.alive = false;
      this.combat?.die?.();
      this.respawnAt = performance.now() + COMBAT.RESPAWN_DELAY_MS;
      this._showDeathOverlay(fromId);
    }
  }

  _respawn() {
    this.hp = COMBAT.MAX_HP;
    this.alive = true;
    this.combat?.reset?.();
    this._hideDeathOverlay();
    const sp = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
    this.capsule.body.setTranslation({ x: sp.x, y: sp.y + 0.5, z: sp.z }, true);
  }

  _onLocalAnimChanged(_state) {
    // Animation state bubbles up to the next sendState() call via
    // combat.getBroadcastState() — no immediate broadcast needed.
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
      this._onPlayerJoined({ playerId: id, state });
      rp = this.remotePlayers.get(id);
    }
    rp?.applyState(state);
  }

  _onRemoteAttack(attackerId, evt) {
    if (Array.isArray(evt.hits) && evt.hits.includes(this.net?.playerId)) {
      this._takeDamage(evt.damage ?? COMBAT.ATTACK_DAMAGE, attackerId);
    }
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
    // HP + stamina bars — bottom-left
    const slotBL = hud.getSlot('bl');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;min-width:280px';

    const hpLabel = document.createElement('div');
    hpLabel.style.cssText = 'font-size:11px;color:#888;letter-spacing:1px;text-transform:uppercase';
    hpLabel.textContent = 'HP';
    const hpOuter = document.createElement('div');
    hpOuter.style.cssText = 'height:14px;background:rgba(0,0,0,0.5);border:1px solid #333;border-radius:2px;overflow:hidden';
    const hpInner = document.createElement('div');
    hpInner.style.cssText = 'height:100%;width:100%;background:linear-gradient(90deg,#c01010,#ff4444);transition:width 0.15s';
    hpOuter.appendChild(hpInner);

    const stLabel = document.createElement('div');
    stLabel.style.cssText = 'font-size:11px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-top:4px';
    stLabel.textContent = 'Stamina';
    const stOuter = document.createElement('div');
    stOuter.style.cssText = 'height:8px;background:rgba(0,0,0,0.5);border:1px solid #333;border-radius:2px;overflow:hidden';
    const stInner = document.createElement('div');
    stInner.style.cssText = 'height:100%;width:100%;background:linear-gradient(90deg,#208020,#60d060);transition:width 0.1s';
    stOuter.appendChild(stInner);

    wrap.append(hpLabel, hpOuter, stLabel, stOuter);
    slotBL?.appendChild(wrap);
    this.hpBar = hpInner;
    this.staminaBar = stInner;

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
    if (this.staminaBar && this.combat) {
      const pct = (this.combat.stamina / 100) * 100;
      this.staminaBar.style.width = `${pct}%`;
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
