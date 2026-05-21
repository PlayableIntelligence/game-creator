import * as THREE from 'three';

/**
 * HitFX — slimmed port of souls-demo's HitFX. Two effects:
 *
 *   1. Spark burst — pooled THREE.Points at the impact world position, with
 *      additive blending and a custom shader so each spark fades out.
 *   2. Emissive flash — briefly raises the emissive of every PBR/MToon
 *      material on the target VRM so the body lights up red-orange when
 *      it eats a swing.
 *
 * Public API:
 *   - `spark(point)` — burst at a world point.
 *   - `flash(vrm)`   — flash a VRM. Idempotent (pinging during an active
 *                      flash just refreshes the timer).
 *   - `update(dt)`   — per-frame tick.
 */

const POOL = 96;
const BURST = 12;
const LIFETIME = 0.5;
const GRAVITY = -9.0;
const FLASH_MS = 130;

const VERT = /* glsl */ `
  attribute float aLife;
  attribute float aSize;
  varying float vLife;
  void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * aLife * (300.0 / max(1.0, -mv.z));
  }
`;
const FRAG = /* glsl */ `
  precision highp float;
  varying float vLife;
  uniform vec3 uColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.15, d) * vLife;
    vec3 col = mix(uColor * 0.6, vec3(1.0, 0.95, 0.7), vLife);
    gl_FragColor = vec4(col, alpha);
  }
`;

export class HitFX {
  constructor(scene) {
    this.scene = scene;
    const geom = new THREE.BufferGeometry();
    const pos  = new Float32Array(POOL * 3);
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
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
    scene.add(this.points);

    this.vel = new Float32Array(POOL * 3);
    this.cursor = 0;

    // VRM flash entries — keyed by VRM root, store originals + timer
    this._flash = new Map();
  }

  spark(point) {
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

  flash(vrm) {
    if (!vrm?.scene) return;
    let entry = this._flash.get(vrm);
    if (!entry) {
      const mats = [];
      vrm.scene.traverse((o) => {
        if (!o.isMesh) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          if (!m?.emissive) continue;
          mats.push({ m, orig: m.emissive.clone() });
        }
      });
      entry = { mats, timer: 0 };
      this._flash.set(vrm, entry);
    }
    entry.timer = FLASH_MS / 1000;
  }

  update(dt) {
    // Sparks
    const pos  = this.points.geometry.attributes.position.array;
    const life = this.points.geometry.attributes.aLife.array;
    let anyAlive = false;
    for (let slot = 0; slot < POOL; slot++) {
      if (life[slot] <= 0) continue;
      anyAlive = true;
      const base = slot * 3;
      pos[base]     += this.vel[base]     * dt;
      pos[base + 1] += this.vel[base + 1] * dt;
      pos[base + 2] += this.vel[base + 2] * dt;
      this.vel[base + 1] += GRAVITY * dt;
      life[slot] -= dt / LIFETIME;
      if (life[slot] < 0) life[slot] = 0;
    }
    if (anyAlive) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.aLife.needsUpdate    = true;
    }

    // Flashes — lerp emissive back over FLASH_MS.
    for (const [, entry] of this._flash) {
      if (entry.timer <= 0) continue;
      entry.timer -= dt;
      const t = Math.max(0, entry.timer / (FLASH_MS / 1000));   // 1 → 0
      const k = t * t * (3 - 2 * t);                            // smoothstep
      for (const { m, orig } of entry.mats) {
        if (!m.emissive || !orig) continue;
        m.emissive.copy(orig);
        m.emissive.r = orig.r + (1.0 - orig.r) * k;
        m.emissive.g = orig.g + (0.6 - orig.g) * k * 0.6;
        m.emissive.b = orig.b + (0.4 - orig.b) * k * 0.3;
      }
    }
  }
}
