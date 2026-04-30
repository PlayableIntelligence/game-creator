import { Events } from '../core/EventBus.js';
import { PX } from '../core/Constants.js';
import { Bullet } from '../entities/Bullet.js';

let _netBulletSeq = 0;

export class BulletNetSync {
  constructor({ scene, eventBus, networkManager, gameState }) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.networkManager = networkManager;
    this.gameState = gameState;
    this._handlers = {};
    this._wire();
  }

  destroy() {
    this.eventBus.off(Events.TANK_FIRED, this._handlers.fired);
    this.eventBus.off(Events.TANK_DIED, this._handlers.died);
    this.eventBus.off('network:bullet:fired', this._handlers.netFired);
    this.eventBus.off('network:tank:died', this._handlers.netDied);
  }

  _wire() {
    this._handlers.fired = (data) => this._onLocalTankFired(data);
    this._handlers.died = (data) => this._onLocalTankDied(data);
    this._handlers.netFired = (msg) => this._onNetworkBulletFired(msg);
    this._handlers.netDied = (msg) => this._onNetworkTankDied(msg);

    this.eventBus.on(Events.TANK_FIRED, this._handlers.fired);
    this.eventBus.on(Events.TANK_DIED, this._handlers.died);
    this.eventBus.on('network:bullet:fired', this._handlers.netFired);
    this.eventBus.on('network:tank:died', this._handlers.netDied);
  }

  _localPlayerId() {
    return this.gameState.multiplayer?.playerId ?? null;
  }

  _isLocalAuthoritativeShooter(shooterId) {
    const player = this.scene.player;
    if (!player) return false;
    return player.id === shooterId;
  }

  _onLocalTankFired(data) {
    if (!this.networkManager?.isConnected?.()) return;
    if (!this._isLocalAuthoritativeShooter(data.shooterId)) return;
    const bulletId = `${this._localPlayerId() ?? 'local'}:${_netBulletSeq++}`;
    // Wire format is design pixels (PX-independent). Receivers multiply by
    // their own PX. Without this, clients with different window sizes / DPRs
    // see bullets spawn at offset positions and travel at offset speeds.
    this.networkManager.sendCustom('bullet:fired', {
      bulletId,
      shooterCornerId: data.shooterId,
      shooterColor: data.shooterColor,
      x: data.x / PX,
      y: data.y / PX,
      vx: data.vx / PX,
      vy: data.vy / PX,
      t: Date.now(),
    });
  }

  _onLocalTankDied(data) {
    if (!this.networkManager?.isConnected?.()) return;
    const player = this.scene.player;
    if (!player) return;

    // Live-players-only: every tank is a human. Broadcast when the local
    // player died (so others see them dead) OR when the local player made the
    // kill (shooter-authoritative — we own our bullets).
    const victimIsLocal = player.id === data.tankId;
    const localIsKiller = player.id === data.killerId;
    if (!victimIsLocal && !localIsKiller) return;

    this.networkManager.sendCustom('tank:died', {
      victimCornerId: data.tankId,
      killerCornerId: data.killerId,
      t: Date.now(),
    });
  }

  _onNetworkBulletFired({ payload, fromPlayerId }) {
    if (!payload) return;
    const { x: dx, y: dy, vx: dvx, vy: dvy, bulletId, shooterCornerId, shooterColor } = payload;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dvx) || !Number.isFinite(dvy)) {
      return;
    }
    if (!this.scene.mazeSystem) return;
    const existing = this.scene.bullets?.find(b => b.id === bulletId);
    if (existing) return;
    // Wire format → canvas pixels using THIS client's PX.
    const x = dx * PX;
    const y = dy * PX;
    const vx = dvx * PX;
    const vy = dvy * PX;
    const bullet = new Bullet(this.scene, {
      shooterId: shooterCornerId ?? `remote:${fromPlayerId}`,
      shooterColor: shooterColor ?? 'RED',
      x, y, vx, vy,
      mazeSystem: this.scene.mazeSystem,
      nonAuthoritative: true,
      networkBulletId: bulletId,
    });
    bullet.sprite.setPosition(x, y);
    this.scene.world.add(bullet.sprite);
    this.scene.bullets.push(bullet);
  }

  _onNetworkTankDied({ payload }) {
    if (!payload) return;
    const { victimCornerId, killerCornerId } = payload;
    const victim = this.scene.tanks?.find(t => t.id === victimCornerId);
    if (!victim || !victim.alive) return;
    victim.kill(killerCornerId);
  }
}
