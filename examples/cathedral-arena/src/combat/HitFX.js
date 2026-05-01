import * as THREE from 'three';
import { eventBus, Events } from '../core/EventBus.js';

// Hit feedback — spark particles at impact points + brief emissive flash on
// the VRM that got hit. Both effects react to BOSS_DAMAGE / PLAYER_DAMAGE
// events so the feedback is decoupled from whoever landed the hit.
//
// Particles: a single THREE.Points object with a pool of N slots. On each
// hit, we pick a burst of unused slots, reset their per-particle state,
// and tick them down each frame. A BufferGeometry is cheaper than one
// mesh per spark.
//
// Flash: iterate the target VRM's materials once and stash each material's
// original emissive (or equivalent) once the first flash fires. On hit,
// set emissive to a bright warm value and lerp back over ~130ms.

const POOL = 128;               // plenty for rapid-fire combos
const BURST = 14;               // particles spawned per hit
const LIFETIME = 0.5;           // seconds
const GRAVITY = -9.0;           // m/s² — sells the "spark falling" feel

const VERT = /* glsl */ `
  attribute float aLife;        // [0..1] remaining life (0 = dead)
  attribute float aSize;
  varying float vLife;
  void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Scale with life so sparks shrink as they die; scale with z so near
    // sparks read bigger. 300/-z roughly matches perspective.
    gl_PointSize = aSize * aLife * (300.0 / max(1.0, -mv.z));
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying float vLife;
  uniform vec3 uColor;
  void main() {
    // Round point with soft edge. Discarding outside a radius keeps the
    // additive blend from drawing square halos.
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.15, d) * vLife;
    // Warm to hot-white at peak life. Mix gives "freshly struck steel" vibe.
    vec3 col = mix(uColor * 0.6, vec3(1.0, 0.95, 0.7), vLife);
    gl_FragColor = vec4(col, alpha);
  }
`;

export class HitFX {
  constructor(scene, { player, boss } = {}) {
    this.scene = scene;
    this.player = player;
    this.boss = boss;

    // Particle system. position + velocity per slot, packed into BufferAttrs
    // so the GPU samples directly. All particles share one material.
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(POOL * 3);
    const life = new Float32Array(POOL);
    const size = new Float32Array(POOL);
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('aLife',    new THREE.BufferAttribute(life, 1));
    geom.setAttribute('aSize',    new THREE.BufferAttribute(size, 1));
    geom.setDrawRange(0, POOL);

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uColor: { value: new THREE.Color(0xffb06a) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geom, mat);
    this.points.frustumCulled = false;  // bursts can spawn just off-screen
    this.points.renderOrder = 12;        // above everything else transparent
    scene.add(this.points);

    // Parallel velocity buffer (not sent to GPU — just CPU-side physics).
    this.vel = new Float32Array(POOL * 3);
    this.cursor = 0;

    // Flash state. Keyed by 'player' or 'boss'; stores originalEmissive per
    // material so we can lerp back. Lazily populated on first hit.
    this._flash = new Map();

    // Wiring.
    eventBus.on(Events.BOSS_DAMAGE,   (p) => this._onDamage('boss', p));
    eventBus.on(Events.PLAYER_DAMAGE, (p) => this._onDamage('player', p));
  }

  _onDamage(target, payload) {
    if (!payload || payload.iframed || payload.damage === 0) return;
    if (payload.point) this._burst(payload.point);
    const vrm = target === 'boss' ? this.boss?.vrm : this.player?.vrm;
    if (vrm) this._flashVrm(target, vrm);
  }

  _burst(point) {
    const pos  = this.points.geometry.attributes.position.array;
    const life = this.points.geometry.attributes.aLife.array;
    const size = this.points.geometry.attributes.aSize.array;
    for (let i = 0; i < BURST; i++) {
      const slot = this.cursor;
      this.cursor = (this.cursor + 1) % POOL;
      const base = slot * 3;
      pos[base]     = point.x;
      pos[base + 1] = point.y;
      pos[base + 2] = point.z;
      // Velocity: mostly outward in the horizontal plane, some upward. Biased
      // toward the hemisphere the camera is on so sparks spray back at the
      // viewer rather than into the ground.
      const a = Math.random() * Math.PI * 2;
      const r = 1.8 + Math.random() * 2.5;
      this.vel[base]     = Math.cos(a) * r;
      this.vel[base + 1] = 2.0 + Math.random() * 3.0;
      this.vel[base + 2] = Math.sin(a) * r;
      life[slot] = 1.0;
      size[slot] = 2.0 + Math.random() * 2.5;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aLife.needsUpdate    = true;
    this.points.geometry.attributes.aSize.needsUpdate    = true;
  }

  _flashVrm(key, vrm) {
    let entry = this._flash.get(key);
    if (!entry) {
      // Collect all PBR/MToon materials once, cache their originals.
      const mats = [];
      vrm.scene.traverse((o) => {
        if (!o.isMesh) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          if (!m) continue;
          const orig = m.emissive ? m.emissive.clone() : null;
          // MToon exposes an `emissiveFactor` via its userData or directly —
          // the @pixiv/three-vrm version surfaces `.emissive` on the material
          // for both shaders, so we just poke that and cache.
          mats.push({ m, orig });
        }
      });
      entry = { mats, timer: 0, duration: 0.13 };
      this._flash.set(key, entry);
    }
    entry.timer = entry.duration;
  }

  update(delta) {
    // Particles — CPU integrate + ship to GPU. Skips entirely when no
    // sparks are alive (cheap: a single loop over 128 floats).
    const pos  = this.points.geometry.attributes.position.array;
    const life = this.points.geometry.attributes.aLife.array;
    let anyAlive = false;
    for (let slot = 0; slot < POOL; slot++) {
      if (life[slot] <= 0) continue;
      anyAlive = true;
      const base = slot * 3;
      pos[base]     += this.vel[base]     * delta;
      pos[base + 1] += this.vel[base + 1] * delta;
      pos[base + 2] += this.vel[base + 2] * delta;
      this.vel[base + 1] += GRAVITY * delta;
      life[slot] -= delta / LIFETIME;
      if (life[slot] < 0) life[slot] = 0;
    }
    if (anyAlive) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.aLife.needsUpdate    = true;
    }

    // Flashes.
    for (const [, entry] of this._flash) {
      if (entry.timer <= 0) continue;
      entry.timer -= delta;
      const t = Math.max(0, entry.timer / entry.duration);  // 1 → 0
      const k = t * t * (3 - 2 * t);                        // smoothstep
      for (const { m, orig } of entry.mats) {
        if (!m.emissive || !orig) continue;
        m.emissive.copy(orig);
        // Lerp toward hot red-orange at peak flash.
        m.emissive.r = orig.r + (1.0 - orig.r) * k * 1.0;
        m.emissive.g = orig.g + (0.6 - orig.g) * k * 0.6;
        m.emissive.b = orig.b + (0.4 - orig.b) * k * 0.3;
      }
    }
  }
}
