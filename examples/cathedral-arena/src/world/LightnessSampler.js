import * as THREE from 'three';
import { LIGHTNESS } from '../core/Constants.js';

/**
 * LightnessSampler — runtime grid sampler for the offline lightness bake.
 *
 * The bake (BakeLightness.js, runs once when ?bake=lightness is in the URL)
 * captures splat luminance at 1m × 1m grid cells, ~40KB JSON output. At
 * runtime, attached PBR meshes have their `envMapIntensity` modulated each
 * frame by the bilinear sample at their world XZ position.
 *
 * Result: characters dim in shadows, brighten under light shafts. They feel
 * like they BELONG to the splat environment instead of cardboard cutouts.
 *
 * Source: ported from splats-repo lightness.ts.
 */
export class LightnessSampler {
  constructor() {
    this.grid = null;
    this._loading = null;
  }

  /**
   * Fetch + parse the baked grid. Verifies Content-Type so Vite's "200 +
   * index.html" fallback for missing paths doesn't trip JSON.parse with
   * "Unexpected token <". Safe to call multiple times — caches the promise.
   */
  load(url, fallbackUrl) {
    if (this._loading) return this._loading;

    const tryFetch = async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`fetch ${u} → ${r.status}`);
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('json')) throw new Error(`not JSON (${ct || 'no content-type'})`);
      return r.json();
    };

    this._loading = (async () => {
      try {
        this.grid = await tryFetch(url);
      } catch (err1) {
        if (!fallbackUrl) {
          console.warn(`[Lightness] grid not available — ${err1.message}`);
          return;
        }
        try {
          this.grid = await tryFetch(fallbackUrl);
        } catch (err2) {
          console.warn(`[Lightness] grid not available — ${err1.message} (fallback also failed)`);
          return;
        }
      }
      const cols = this.grid.data[0]?.length ?? 0;
      const rows = this.grid.data.length;
      console.info(
        `[Lightness] loaded grid ${cols}×${rows}  cell=${this.grid.cell}  y=${this.grid.y.toFixed(2)}`,
      );
    })();
    return this._loading;
  }

  get ready() { return this.grid !== null; }

  /**
   * Bilinear sample at world (x, z). Returns 0 outside the grid OR if no
   * grid is loaded. Hot path — keep this allocation-free.
   */
  sample(p) {
    const g = this.grid;
    if (!g) return 0;
    const fx = (p.x - g.origin[0]) / g.cell;
    const fz = (p.z - g.origin[1]) / g.cell;
    const rows = g.data.length;
    const cols = g.data[0]?.length ?? 0;
    if (cols < 2 || rows < 2) return g.data[0]?.[0] ?? 0;
    if (fx < 0 || fz < 0 || fx > cols - 1 || fz > rows - 1) return 0;
    const x0 = Math.max(0, Math.min(cols - 2, Math.floor(fx)));
    const z0 = Math.max(0, Math.min(rows - 2, Math.floor(fz)));
    const tx = fx - x0;
    const tz = fz - z0;
    const a = g.data[z0    ][x0    ];
    const b = g.data[z0    ][x0 + 1];
    const c = g.data[z0 + 1][x0    ];
    const d = g.data[z0 + 1][x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz)
         + (c * (1 - tx) + d * tx) * tz;
  }

  /**
   * Attach a mesh — its envMapIntensity tracks the sampled lightness each
   * frame via mesh.onBeforeRender. Returns a detach() that restores the
   * original behavior. Early-returns when no grid is loaded so the per-frame
   * cost is one branch + one chain call (negligible).
   */
  attach(mesh, opts = {}) {
    const min = opts.min ?? LIGHTNESS.attachMin;
    const max = opts.max ?? LIGHTNESS.attachMax;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const originals = mats.map((m) => ({
      intensity: typeof m.envMapIntensity === 'number' ? m.envMapIntensity : 1,
      color: m.color instanceof THREE.Color ? m.color.clone() : null,
    }));
    const world = new THREE.Vector3();
    const prev = mesh.onBeforeRender;
    mesh.onBeforeRender = (...args) => {
      if (!this.grid) {
        prev?.call(mesh, ...args);
        return;
      }
      mesh.getWorldPosition(world);
      const raw = this.sample(world);
      const exposure = min + (max - min) * raw;
      mats.forEach((m, i) => {
        if (typeof m.envMapIntensity === 'number') {
          m.envMapIntensity = originals[i].intensity * exposure;
        } else if (originals[i].color && m.color instanceof THREE.Color) {
          m.color.copy(originals[i].color).multiplyScalar(exposure);
        }
      });
      prev?.call(mesh, ...args);
    };
    return () => { mesh.onBeforeRender = prev; };
  }
}
