import { TANK, BULLET, COLORS, PX } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { tankTextureKey } from '../sprites/registerSprites.js';
import {
  TANK_SPRITE_WIDTH,
  TANK_SPRITE_HEIGHT,
  TANK_SPRITE_ORIGIN_X,
  TANK_SPRITE_ORIGIN_Y,
} from '../sprites/tank.js';

export class Tank {
  constructor(scene, { id, color, x, y, rotation, mazeSystem }) {
    this.scene = scene;
    this.id = id;
    this.colorName = color;
    this.color = COLORS[color];
    this.maze = mazeSystem;

    this.x = x;
    this.y = y;
    this.rotation = rotation;
    this.vx = 0;
    this.vy = 0;
    this.alive = true;
    this.lastFireMs = 0;
    this._thrusting = false;

    // Collision radius (slightly inset from chassis)
    this.radius = (Math.min(TANK.WIDTH, TANK.HEIGHT) / 2) * PX;

    this.container = scene.add.container(x, y);
    this.container.setDepth(10);
    this.draw();

    eventBus.emit(Events.TANK_SPAWNED, {
      id, color, x, y, rotation,
    });
  }

  draw() {
    // The tank body sprite includes chassis, treads, turret, and barrel.
    // Sprite barrel points along +x in local space; the container rotates to
    // face this.rotation. The sprite is wider than TANK.WIDTH because the
    // barrel protrudes past the chassis — origin is set to the chassis center
    // (not the sprite center) so collision/physics align with TANK.WIDTH.
    const w = TANK_SPRITE_WIDTH * PX;
    const h = TANK_SPRITE_HEIGHT * PX;
    const sprite = this.scene.add.image(0, 0, tankTextureKey(this.colorName));
    sprite.setOrigin(TANK_SPRITE_ORIGIN_X, TANK_SPRITE_ORIGIN_Y);
    sprite.setDisplaySize(w, h);

    this.container.add(sprite);
    this.container.setRotation(this.rotation);
  }

  update(dt, input) {
    if (!this.alive) return;

    if (input) {
      if (input.turnLeft) this.rotation -= TANK.TURN_SPEED * dt;
      if (input.turnRight) this.rotation += TANK.TURN_SPEED * dt;

      const forward = input.thrustForward;
      const back = input.thrustBack;
      const isThrusting = forward || back;
      if (isThrusting) {
        const accel = forward ? TANK.THRUST : -TANK.REVERSE_THRUST;
        const ax = Math.cos(this.rotation) * accel * dt;
        const ay = Math.sin(this.rotation) * accel * dt;
        this.vx += ax * PX;
        this.vy += ay * PX;
      }

      this._setThrusting(isThrusting);

      if (input.fire) this.tryFire();
    } else {
      this._setThrusting(false);
    }

    // Drag (frame-independent approximation)
    const dragFactor = Math.pow(TANK.DRAG, dt * 60);
    this.vx *= dragFactor;
    this.vy *= dragFactor;

    // Clamp speed
    const maxSpeed = TANK.MAX_SPEED * PX;
    const speed2 = this.vx * this.vx + this.vy * this.vy;
    if (speed2 > maxSpeed * maxSpeed) {
      const speed = Math.sqrt(speed2);
      this.vx = (this.vx / speed) * maxSpeed;
      this.vy = (this.vy / speed) * maxSpeed;
    }

    // Integrate
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Wall collision (separating-axis push-out)
    const result = this.maze.resolveCircle(this, this.radius);
    if (result.collidedX) this.vx = 0;
    if (result.collidedY) this.vy = 0;

    this.container.setPosition(this.x, this.y);
    this.container.setRotation(this.rotation);
  }

  _setThrusting(on) {
    if (on === this._thrusting) return;
    this._thrusting = on;
    eventBus.emit(on ? Events.TANK_THRUST_START : Events.TANK_THRUST_END, {
      tankId: this.id,
      color: this.colorName,
    });
  }

  tryFire() {
    const now = performance.now();
    if (now - this.lastFireMs < TANK.FIRE_COOLDOWN_MS) return;
    this.lastFireMs = now;

    const turretLen = (TANK.TURRET_LENGTH + TANK.WIDTH / 2) * PX;
    const muzzleX = this.x + Math.cos(this.rotation) * turretLen;
    const muzzleY = this.y + Math.sin(this.rotation) * turretLen;
    const speed = BULLET.SPEED * PX;
    const vx = Math.cos(this.rotation) * speed;
    const vy = Math.sin(this.rotation) * speed;

    eventBus.emit(Events.TANK_FIRED, {
      shooterId: this.id,
      shooterColor: this.colorName,
      x: muzzleX,
      y: muzzleY,
      vx,
      vy,
      rotation: this.rotation,
    });
    eventBus.emit(Events.SPECTACLE_ACTION, {
      kind: 'fire',
      x: muzzleX,
      y: muzzleY,
      color: this.color,
    });
  }

  kill(killerId) {
    if (!this.alive) return;
    this.alive = false;
    this._setThrusting(false);
    this.container.setAlpha(0.25);
    eventBus.emit(Events.TANK_DIED, {
      tankId: this.id,
      color: this.colorName,
      killerId,
      x: this.x,
      y: this.y,
    });
    eventBus.emit(Events.SPECTACLE_HIT, {
      kind: 'tank_died',
      x: this.x,
      y: this.y,
      color: this.color,
    });
  }

  destroy() {
    this.container.destroy();
  }
}

