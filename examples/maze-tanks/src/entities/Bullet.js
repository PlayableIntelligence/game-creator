import { BULLET, PX } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';

let _bulletIdSeq = 0;

export class Bullet {
  constructor(scene, { shooterId, shooterColor, x, y, vx, vy, mazeSystem, nonAuthoritative = false, networkBulletId = null }) {
    this.scene = scene;
    // Cross-client unique: prefix with shooterId + timestamp so two clients
    // can't both claim id `b0`. Multiplayer dedupe keys on this.
    this.id = networkBulletId ?? `${shooterId}:${Date.now().toString(36)}:${_bulletIdSeq++}`;
    this.shooterId = shooterId;
    this.shooterColor = shooterColor;
    this.maze = mazeSystem;
    this.nonAuthoritative = nonAuthoritative;

    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.bounces = 0;
    this.alive = true;
    this.spawnedAt = performance.now();
    this.radius = BULLET.RADIUS * PX;

    // Bullet sprite is 8 source-px wide; display at 8*PX so the visible pellet
    // is the same size as the original circle (radius 3 → diameter 6, but a
    // pixel pellet reads cleaner at 8). Collision radius stays at BULLET.RADIUS.
    const displaySize = 8 * PX;
    this.sprite = scene.add.image(x, y, 'bullet');
    this.sprite.setDisplaySize(displaySize, displaySize);
    this.sprite.setDepth(20);
  }

  update(dt) {
    if (!this.alive) return;

    // Lifetime check
    if (performance.now() - this.spawnedAt > BULLET.LIFETIME_MS) {
      this.expire('lifetime');
      return;
    }

    // Step in 2 substeps to reduce tunneling at high speed
    const substeps = 2;
    const sdt = dt / substeps;
    for (let i = 0; i < substeps; i++) {
      this.x += this.vx * sdt;
      this.y += this.vy * sdt;

      const hit = this.maze.bulletCollision(this.x, this.y, this.radius);
      if (hit) {
        // Push out by overlap, reflect velocity
        this.x += hit.nx * hit.overlap;
        this.y += hit.ny * hit.overlap;
        if (hit.nx !== 0) this.vx = -this.vx;
        if (hit.ny !== 0) this.vy = -this.vy;

        this.bounces++;
        eventBus.emit(Events.BULLET_RICOCHET, {
          bulletId: this.id,
          x: this.x,
          y: this.y,
          bounceCount: this.bounces,
          nx: hit.nx,
          ny: hit.ny,
          vx: this.vx,
          vy: this.vy,
        });

        if (this.bounces > BULLET.MAX_BOUNCES) {
          this.expire('bounce_limit');
          return;
        }
      }
    }

    this.sprite.setPosition(this.x, this.y);
  }

  ageMs() {
    return performance.now() - this.spawnedAt;
  }

  canHit(tank) {
    if (!tank.alive) return false;
    // Self-hit grace prevents point-blank suicide on first muzzle frames
    if (tank.id === this.shooterId && this.ageMs() < BULLET.SELF_HIT_GRACE_MS) {
      return false;
    }
    const dx = tank.x - this.x;
    const dy = tank.y - this.y;
    const r = this.radius + tank.radius;
    return dx * dx + dy * dy < r * r;
  }

  hit() {
    this.expire('hit');
  }

  expire(reason) {
    if (!this.alive) return;
    this.alive = false;
    eventBus.emit(Events.BULLET_EXPIRED, { bulletId: this.id, reason });
    this.sprite.destroy();
  }

  destroy() {
    this.alive = false;
    if (this.sprite) this.sprite.destroy();
  }
}
