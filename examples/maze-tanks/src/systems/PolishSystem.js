import Phaser from 'phaser';
import { POLISH, COLORS, GAME, UI, TANK, PX } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';

// Visual juice layer. Listens to existing gameplay events and paints
// reactive effects on top — no gameplay influence. All particles are
// pooled (Graphics objects reused) and live in either the world container
// (so they ride the maze offset) or the camera-fixed UI layer.

export class PolishSystem {
  constructor(scene) {
    this.scene = scene;

    // World-relative effects layer (rides maze offset + scaling)
    this.worldFx = scene.add.container(scene.mazeOffsetX, scene.mazeOffsetY);
    this.worldFx.setDepth(50);

    // Camera-fixed overlay (vignette, GO! text, banners)
    this.uiFx = scene.add.container(0, 0);
    this.uiFx.setDepth(900);

    // Active particles: each is { gfx, ttl, lifeMs, vx, vy, size, fromAlpha, type }
    this.particles = [];
    this._particlePool = [];

    // Bullet trail tracking: id -> { positions: [{x,y}] }
    this._bulletTrails = new Map();
    this._trailGfx = scene.add.graphics();
    this.worldFx.add(this._trailGfx);

    // Tank smoke timers: id -> last emit time
    this._tankSmokeNextEmit = new Map();
    this._tankPrevPos = new Map();

    // Crown sprite (single, reused across rounds)
    this._crown = null;
    this._crownTween = null;

    // Pending winner banner timeline
    this._winnerBanner = null;
    this._winnerBannerTween = null;

    // GO text
    this._goText = null;

    // Last seen muzzle flash sprites (for orientation)
    // (not strictly needed — created on demand)

    this._buildVignette();
    this._wireEvents();

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());
  }

  // --- Vignette --------------------------------------------------------------

  _buildVignette() {
    // Procedural radial vignette baked into a canvas texture and displayed
    // at full screen size. A radial gradient is the cleanest way to get a
    // smooth dark-to-clear falloff; a stack of Phaser fillCircles compounds
    // alpha multiplicatively and produces ringy banding at low step counts.
    const w = GAME.WIDTH;
    const h = GAME.HEIGHT;
    const key = 'vignette';
    if (!this.scene.textures.exists(key)) {
      const canvas = document.createElement('canvas');
      const tw = 256, th = 256;
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d');
      const cx = tw / 2, cy = th / 2;
      const innerR = Math.max(tw, th) * 0.25;
      const outerR = Math.sqrt(cx * cx + cy * cy);
      const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
      grad.addColorStop(0, `rgba(0,0,0,${POLISH.VIGNETTE_INNER_ALPHA})`);
      grad.addColorStop(0.5, 'rgba(0,0,0,0.18)');
      grad.addColorStop(1, `rgba(0,0,0,${POLISH.VIGNETTE_OUTER_ALPHA})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, tw, th);
      this.scene.textures.addCanvas(key, canvas);
    }
    const img = this.scene.add.image(w / 2, h / 2, key);
    img.setDisplaySize(w, h);
    img.setDepth(800);
    img.setBlendMode(Phaser.BlendModes.NORMAL);
    this._vignette = img;
  }

  // --- Event wiring ---------------------------------------------------------

  _wireEvents() {
    this._onTankFired = (data) => this._spawnMuzzleFlash(data);
    this._onTankDied = (data) => this._spawnExplosion(data);
    this._onBulletRicochet = (data) => this._spawnRicochetSparks(data);
    this._onBulletExpired = (data) => this._removeBulletTrail(data);
    this._onRoundCountdown = (data) => this._pulseCountdown(data);
    this._onRoundStarted = () => this._showGoText();
    this._onRoundEnded = (data) => this._showWinnerBanner(data);

    eventBus.on(Events.TANK_FIRED, this._onTankFired);
    eventBus.on(Events.TANK_DIED, this._onTankDied);
    eventBus.on(Events.BULLET_RICOCHET, this._onBulletRicochet);
    eventBus.on(Events.BULLET_EXPIRED, this._onBulletExpired);
    eventBus.on(Events.ROUND_COUNTDOWN, this._onRoundCountdown);
    eventBus.on(Events.ROUND_STARTED, this._onRoundStarted);
    eventBus.on(Events.ROUND_ENDED, this._onRoundEnded);
  }

  // --- Particle pool --------------------------------------------------------

  _acquireParticle() {
    let p = this._particlePool.pop();
    if (!p) {
      const gfx = this.scene.add.graphics();
      this.worldFx.add(gfx);
      p = { gfx, ttl: 0, lifeMs: 1, vx: 0, vy: 0, x: 0, y: 0, size: 1, color: 0xffffff, fromAlpha: 1, drag: 1 };
    }
    p.gfx.setVisible(true);
    this.particles.push(p);
    return p;
  }

  _releaseParticle(p) {
    p.gfx.clear();
    p.gfx.setVisible(false);
    this._particlePool.push(p);
  }

  _drawParticle(p) {
    p.gfx.clear();
    p.gfx.fillStyle(p.color, 1);
    const half = p.size / 2;
    p.gfx.fillRect(p.x - half, p.y - half, p.size, p.size);
  }

  // --- Muzzle flash + sparks ------------------------------------------------

  _spawnMuzzleFlash(data) {
    const { x, y, rotation } = data;
    const sprite = this.scene.add.image(x, y, 'muzzle_flash');
    const baseSize = 16 * PX * POLISH.MUZZLE_SCALE_BASE;
    sprite.setDisplaySize(baseSize, baseSize);
    sprite.setRotation(rotation || 0);
    sprite.setDepth(60);
    this.worldFx.add(sprite);

    // Quick scale-up then fade
    this.scene.tweens.add({
      targets: sprite,
      scale: POLISH.MUZZLE_SCALE_PEAK,
      duration: POLISH.MUZZLE_GROW_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (!sprite.active) return;
        this.scene.tweens.add({
          targets: sprite,
          alpha: 0,
          scale: POLISH.MUZZLE_SCALE_PEAK * 0.7,
          duration: POLISH.MUZZLE_FADE_MS,
          ease: 'Quad.easeIn',
          onComplete: () => sprite.destroy(),
        });
      },
    });

    // Yellow sparks shooting out along the firing direction
    const spreadRad = Phaser.Math.DegToRad(POLISH.MUZZLE_SPARK_SPREAD_DEG);
    const baseRot = rotation || 0;
    for (let i = 0; i < POLISH.MUZZLE_SPARK_COUNT; i++) {
      const angle = baseRot + (Math.random() - 0.5) * 2 * spreadRad;
      const speed = POLISH.MUZZLE_SPARK_SPEED * PX * (0.7 + Math.random() * 0.6);
      const p = this._acquireParticle();
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.size = POLISH.MUZZLE_SPARK_SIZE * PX;
      p.color = POLISH.MUZZLE_SPARK_COLOR;
      p.fromAlpha = 1.0;
      p.lifeMs = POLISH.MUZZLE_SPARK_LIFE_MS;
      p.ttl = p.lifeMs;
      p.drag = 0.92;
      p.type = 'spark';
      this._drawParticle(p);
      p.gfx.setAlpha(p.fromAlpha);
    }
  }

  // --- Ricochet sparks ------------------------------------------------------

  _spawnRicochetSparks(data) {
    const { x, y, nx, ny } = data;
    // Compute outward angle (away from wall) using normal; fallback to
    // post-bounce velocity if normal is missing.
    let baseAngle;
    if (nx != null && ny != null && (nx !== 0 || ny !== 0)) {
      baseAngle = Math.atan2(ny, nx);
    } else if (data.vx != null && data.vy != null) {
      baseAngle = Math.atan2(data.vy, data.vx);
    } else {
      baseAngle = -Math.PI / 2;
    }

    const spreadRad = Phaser.Math.DegToRad(POLISH.RICOCHET_SPARK_SPREAD_DEG);
    for (let i = 0; i < POLISH.RICOCHET_SPARK_COUNT; i++) {
      const angle = baseAngle + (Math.random() - 0.5) * 2 * spreadRad;
      const speed = POLISH.RICOCHET_SPARK_SPEED * PX * (0.6 + Math.random() * 0.7);
      const p = this._acquireParticle();
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.size = POLISH.RICOCHET_SPARK_SIZE * PX;
      p.color = i % 2 === 0 ? POLISH.RICOCHET_SPARK_COLOR_A : POLISH.RICOCHET_SPARK_COLOR_B;
      p.fromAlpha = 1.0;
      p.lifeMs = POLISH.RICOCHET_SPARK_LIFE_MS;
      p.ttl = p.lifeMs;
      p.drag = 0.9;
      p.type = 'spark';
      this._drawParticle(p);
      p.gfx.setAlpha(1);
    }

    // Brief white flash circle at the impact point
    const flash = this.scene.add.graphics();
    flash.fillStyle(0xffffff, 0.85);
    flash.fillCircle(0, 0, POLISH.RICOCHET_FLASH_RADIUS * PX);
    flash.setPosition(x, y);
    flash.setDepth(55);
    this.worldFx.add(flash);
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.6,
      duration: POLISH.RICOCHET_FLASH_LIFE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  // --- Tank death -----------------------------------------------------------

  _spawnExplosion(data) {
    const { x, y } = data;

    // Spritesheet animation — 4 frames swapped manually via setFrame()
    const sprite = this.scene.add.image(x, y, 'explosion', 0);
    const size = POLISH.EXPLOSION_DISPLAY_SIZE * PX;
    sprite.setDisplaySize(size, size);
    sprite.setDepth(70);
    this.worldFx.add(sprite);

    let frame = 0;
    const advance = () => {
      frame++;
      if (frame >= POLISH.EXPLOSION_FRAMES || !sprite.active) {
        sprite.destroy();
        return;
      }
      sprite.setFrame(frame);
      this.scene.time.delayedCall(POLISH.EXPLOSION_FRAME_MS, advance);
    };
    this.scene.time.delayedCall(POLISH.EXPLOSION_FRAME_MS, advance);

    // Screen shake — short and felt, not jarring
    this.scene.cameras.main.shake(POLISH.SHAKE_DURATION_MS, POLISH.SHAKE_INTENSITY);

    // Dark smoke drifting upward
    for (let i = 0; i < POLISH.DEATH_SMOKE_COUNT; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.0;
      const speed = (0.4 + Math.random() * 0.8);
      const p = this._acquireParticle();
      p.x = x + (Math.random() - 0.5) * 8 * PX;
      p.y = y + (Math.random() - 0.5) * 8 * PX;
      p.vx = Math.cos(angle) * POLISH.DEATH_SMOKE_DRIFT_LATERAL * PX * speed * (Math.random() < 0.5 ? -1 : 1) * 0.6;
      p.vy = -POLISH.DEATH_SMOKE_DRIFT_UP * PX * speed * 0.5;
      p.size = POLISH.DEATH_SMOKE_SIZE * PX * (1 + Math.random() * 0.6);
      p.color = POLISH.DEATH_SMOKE_COLOR;
      p.fromAlpha = 0.7;
      p.lifeMs = POLISH.DEATH_SMOKE_LIFE_MS * (0.7 + Math.random() * 0.6);
      p.ttl = p.lifeMs;
      p.drag = 0.96;
      p.type = 'smoke';
      this._drawParticle(p);
      p.gfx.setAlpha(p.fromAlpha);
    }

    // Brief slow-mo for satisfaction (timeScale, not physics tick rate change)
    if (POLISH.DEATH_FREEZE_MS > 0) {
      const prev = this.scene.time.timeScale;
      this.scene.time.timeScale = POLISH.DEATH_FREEZE_TIMESCALE;
      this.scene.tweens.timeScale = POLISH.DEATH_FREEZE_TIMESCALE;
      // Use real wall-clock setTimeout so we restore even while scene timeScale is depressed
      window.setTimeout(() => {
        this.scene.time.timeScale = prev;
        this.scene.tweens.timeScale = 1;
      }, POLISH.DEATH_FREEZE_MS);
    }
  }

  // --- Round transitions ----------------------------------------------------

  _pulseCountdown(data) {
    // RoundSystem manages the actual countdown text — we add a transient
    // pulse overlay synced to the countdown second change.
    if (data && data.secondsLeft != null && this.scene.roundSystem && this.scene.roundSystem.subBanner) {
      const sub = this.scene.roundSystem.subBanner;
      sub.setScale(POLISH.COUNTDOWN_GROW_FROM);
      sub.setAlpha(0);
      this.scene.tweens.add({
        targets: sub,
        scale: 1,
        alpha: 1,
        duration: POLISH.COUNTDOWN_GROW_MS,
        ease: 'Quad.easeOut',
      });
    }
  }

  _showGoText() {
    if (this._goText) {
      this._goText.destroy();
      this._goText = null;
    }
    const cx = GAME.WIDTH / 2;
    const cy = GAME.HEIGHT / 2;
    const size = Math.round(GAME.HEIGHT * UI.HEADING_RATIO);
    const t = this.scene.add.text(cx, cy, 'GO!', {
      fontSize: size + 'px',
      fontFamily: UI.FONT,
      color: COLORS.UI_TEXT,
      fontStyle: 'bold',
      stroke: '#000',
      strokeThickness: 6,
    }).setOrigin(0.5).setDepth(1100);
    t.setScale(POLISH.GO_TEXT_SCALE_FROM);
    this._goText = t;
    this.scene.tweens.add({
      targets: t,
      scale: POLISH.GO_TEXT_SCALE_TO,
      alpha: 0,
      duration: POLISH.GO_TEXT_LIFE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        t.destroy();
        if (this._goText === t) this._goText = null;
      },
    });

    // Remove crown if present (next round started)
    this._removeCrown();
  }

  _showWinnerBanner(data) {
    const winner = data && data.winnerColor;

    // The RoundSystem already shows its banner — we add the slide-in juice
    // by tweening RoundSystem.banner from below the screen up to its position.
    if (this.scene.roundSystem && this.scene.roundSystem.banner) {
      const banner = this.scene.roundSystem.banner;
      const finalY = banner.y;
      banner.y = GAME.HEIGHT + banner.height;
      banner.setAlpha(1);
      if (this._winnerBannerTween) this._winnerBannerTween.stop();
      this._winnerBannerTween = this.scene.tweens.add({
        targets: banner,
        y: finalY,
        duration: POLISH.WINNER_BANNER_SLIDE_MS,
        ease: 'Bounce.easeOut',
      });
    }

    if (winner) {
      this._spawnCrown(winner);
    } else {
      this._desaturatePulse();
    }
  }

  _spawnCrown(winnerColor) {
    this._removeCrown();
    const winnerTank = (this.scene.tanks || []).find(t => t.colorName === winnerColor && t.alive);
    if (!winnerTank) return;
    const crown = this.scene.add.image(0, 0, 'crown');
    const crownW = 12 * PX * 2;
    const crownH = 8 * PX * 2;
    crown.setDisplaySize(crownW, crownH);
    crown.setDepth(80);
    // Position above the tank in world space
    crown.setPosition(winnerTank.x, winnerTank.y + POLISH.CROWN_OFFSET_Y * PX);
    this.worldFx.add(crown);
    this._crown = crown;
    this._crownTank = winnerTank;
    this._crownTween = this.scene.tweens.add({
      targets: crown,
      y: crown.y - POLISH.CROWN_BOB_DISTANCE * PX,
      duration: POLISH.CROWN_BOB_MS,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });
  }

  _removeCrown() {
    if (this._crownTween) {
      this._crownTween.stop();
      this._crownTween = null;
    }
    if (this._crown) {
      this._crown.destroy();
      this._crown = null;
    }
    this._crownTank = null;
  }

  _desaturatePulse() {
    // Camera tint pulse — quick darken-and-restore on draw
    const cam = this.scene.cameras.main;
    cam.flash(POLISH.DRAW_TINT_MS, 80, 96, 112, false);
  }

  // --- Bullet trails --------------------------------------------------------

  _removeBulletTrail(data) {
    if (data && data.bulletId) {
      this._bulletTrails.delete(data.bulletId);
    }
  }

  _updateBulletTrails() {
    const bullets = this.scene.bullets || [];
    // Record the current position for each live bullet; cull dead ones
    const seen = new Set();
    for (const b of bullets) {
      if (!b.alive) continue;
      seen.add(b.id);
      let entry = this._bulletTrails.get(b.id);
      if (!entry) {
        entry = { positions: [] };
        this._bulletTrails.set(b.id, entry);
      }
      entry.positions.push({ x: b.x, y: b.y });
      if (entry.positions.length > POLISH.BULLET_TRAIL_LENGTH) {
        entry.positions.shift();
      }
    }
    // Drop trails for bullets that no longer exist
    for (const id of this._bulletTrails.keys()) {
      if (!seen.has(id)) this._bulletTrails.delete(id);
    }

    // Draw all trails
    const g = this._trailGfx;
    g.clear();
    for (const [, entry] of this._bulletTrails) {
      const pts = entry.positions;
      if (pts.length < 2) continue;
      for (let i = 1; i < pts.length; i++) {
        const t = i / pts.length;
        g.lineStyle(POLISH.BULLET_TRAIL_WIDTH * PX, COLORS.BULLET, POLISH.BULLET_TRAIL_ALPHA * t);
        g.beginPath();
        g.moveTo(pts[i - 1].x, pts[i - 1].y);
        g.lineTo(pts[i].x, pts[i].y);
        g.strokePath();
      }
    }
  }

  // --- Tank smoke trails ----------------------------------------------------

  _updateTankSmoke(now) {
    const tanks = this.scene.tanks || [];
    for (const tank of tanks) {
      if (!tank.alive) {
        this._tankSmokeNextEmit.delete(tank.id);
        continue;
      }
      const prev = this._tankPrevPos.get(tank.id);
      const moving = prev && Math.hypot(tank.x - prev.x, tank.y - prev.y) > 0.4;
      this._tankPrevPos.set(tank.id, { x: tank.x, y: tank.y });

      if (!moving) continue;
      const next = this._tankSmokeNextEmit.get(tank.id) || 0;
      if (now < next) continue;
      this._tankSmokeNextEmit.set(tank.id, now + POLISH.SMOKE_INTERVAL_MS);

      // Spawn at rear of tank (opposite to facing direction)
      const rearOffset = -((TANK.WIDTH / 2) * PX);
      const sx = tank.x + Math.cos(tank.rotation) * rearOffset;
      const sy = tank.y + Math.sin(tank.rotation) * rearOffset;
      const angle = tank.rotation + Math.PI + (Math.random() - 0.5) * 0.8;
      const speed = POLISH.SMOKE_DRIFT * PX * (0.4 + Math.random() * 0.6);
      const p = this._acquireParticle();
      p.x = sx;
      p.y = sy;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.size = POLISH.SMOKE_SIZE * PX;
      p.color = POLISH.SMOKE_COLOR;
      p.fromAlpha = POLISH.SMOKE_ALPHA_START;
      p.lifeMs = POLISH.SMOKE_LIFE_MS;
      p.ttl = p.lifeMs;
      p.drag = 0.96;
      p.type = 'smoke';
      this._drawParticle(p);
      p.gfx.setAlpha(p.fromAlpha);
    }
  }

  // --- Crown follow ---------------------------------------------------------

  _updateCrown() {
    if (this._crown && this._crownTank && this._crownTank.alive) {
      // Keep crown horizontally locked to the tank, but let the bob tween own y
      this._crown.x = this._crownTank.x;
    }
  }

  // --- Per-frame update -----------------------------------------------------

  update(_time, deltaMs) {
    const now = performance.now();
    const dt = deltaMs / 1000;

    // Simulate particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.ttl -= deltaMs;
      if (p.ttl <= 0) {
        this.particles.splice(i, 1);
        this._releaseParticle(p);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      const k = p.ttl / p.lifeMs;
      p.gfx.setAlpha(p.fromAlpha * k);
      this._drawParticle(p);
    }

    this._updateBulletTrails();
    this._updateTankSmoke(now);
    this._updateCrown();
  }

  // --- Cleanup --------------------------------------------------------------

  shutdown() {
    eventBus.off(Events.TANK_FIRED, this._onTankFired);
    eventBus.off(Events.TANK_DIED, this._onTankDied);
    eventBus.off(Events.BULLET_RICOCHET, this._onBulletRicochet);
    eventBus.off(Events.BULLET_EXPIRED, this._onBulletExpired);
    eventBus.off(Events.ROUND_COUNTDOWN, this._onRoundCountdown);
    eventBus.off(Events.ROUND_STARTED, this._onRoundStarted);
    eventBus.off(Events.ROUND_ENDED, this._onRoundEnded);

    this.particles.length = 0;
    this._particlePool.length = 0;
    this._bulletTrails.clear();
    this._tankSmokeNextEmit.clear();
    this._tankPrevPos.clear();
    this._removeCrown();
  }
}
