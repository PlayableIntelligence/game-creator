import * as THREE from 'three';

/**
 * BakeLightness — offline tool. Captures splat luminance into a 2D grid
 * (one float per 1×1m cell at floor+1m) so dynamic PBR meshes can match
 * splat illumination at runtime via LightnessSampler.attach().
 *
 * Trigger from main.js when URL has ?bake=lightness. Hides the character +
 * debug + fake-floor mesh during the bake so the probe camera only sees
 * splats.
 *
 * Cost: ~30s on a typical M1 / cathedral-sized scene. ~40KB JSON output.
 *
 * Source: ported from splats-repo tools/bake-lightness.ts (which is itself
 * basically the same as PlayCanvas's probes.js — confirmed by reading the
 * Turning-a-Gaussian-Splat-into-a-Videogame blog post).
 *
 * Math:
 *   - 1×1m XZ grid at fixed Y (probeY)
 *   - For each cell: render 6 cube faces at 16×16, average Rec. 601 luma
 *   - Output:  data[z][x] = scalar luminance in [0, 1]
 */

// Rec. 601 luminance weights — standard "perceived brightness" coefficients
const R_W = 0.299;
const G_W = 0.587;
const B_W = 0.114;

// 6 cube faces — [forward, up] for each
const FACE_DIRS = [
  [new THREE.Vector3( 1,  0,  0), new THREE.Vector3(0, 1,  0)],
  [new THREE.Vector3(-1,  0,  0), new THREE.Vector3(0, 1,  0)],
  [new THREE.Vector3( 0,  1,  0), new THREE.Vector3(0, 0, -1)],
  [new THREE.Vector3( 0, -1,  0), new THREE.Vector3(0, 0,  1)],
  [new THREE.Vector3( 0,  0,  1), new THREE.Vector3(0, 1,  0)],
  [new THREE.Vector3( 0,  0, -1), new THREE.Vector3(0, 1,  0)],
];

// Spark uses PIXEL_PACK_BUFFER for async readbacks. If one is bound when we
// readPixels, the read becomes a buffer-to-buffer copy and throws
// INVALID_OPERATION. Unbind once per probe.
const PIXEL_PACK_BUFFER = 0x88eb;

export async function bakeLightnessGrid(opts) {
  const cell    = opts.cell ?? 1;
  const faceRes = opts.faceRes ?? 16;
  const near    = opts.near ?? 0.05;
  const far     = opts.far ?? 200;

  const { bbox } = opts;
  const cols  = Math.max(1, Math.ceil((bbox.max.x - bbox.min.x) / cell));
  const rows  = Math.max(1, Math.ceil((bbox.max.z - bbox.min.z) / cell));
  const total = rows * cols;

  console.info(
    `[BakeLightness] ${cols} × ${rows} = ${total} probes  cell=${cell}m  face=${faceRes}px  probe_y=${opts.probeY.toFixed(2)}`,
  );

  // Hide non-splat content for the bake — character, debug, fake floor.
  // Remember prior visibility to restore exactly even if some nodes were
  // already hidden via URL param.
  const prevVisible = new Map();
  for (const node of (opts.hideDuringBake || [])) {
    prevVisible.set(node, node.visible);
    node.visible = false;
  }

  // Dedicated 90° square camera + RT. Manually rotate per face rather than
  // using CubeCamera so we have explicit control over projection + avoid
  // any Spark LoD quirks from CubeCamera's internal multi-render.
  const probeCam = new THREE.PerspectiveCamera(90, 1, near, far);
  const rt = new THREE.WebGLRenderTarget(faceRes, faceRes, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  const pixels = new Uint8Array(faceRes * faceRes * 4);
  const pixelsPerFace = faceRes * faceRes;

  const data = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const probePos = new THREE.Vector3();
  const target   = new THREE.Vector3();
  const prevTarget = opts.renderer.getRenderTarget();
  const gl = opts.renderer.getContext();

  let done = 0;
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      probePos.set(
        bbox.min.x + (x + 0.5) * cell,
        opts.probeY,
        bbox.min.z + (z + 0.5) * cell,
      );
      probeCam.position.copy(probePos);

      let lumSum = 0;
      for (const [dir, up] of FACE_DIRS) {
        target.copy(probePos).add(dir);
        probeCam.up.copy(up);
        probeCam.lookAt(target);

        opts.renderer.setRenderTarget(rt);
        opts.renderer.render(opts.scene, probeCam);
        gl.bindBuffer(PIXEL_PACK_BUFFER, null);
        opts.renderer.readRenderTargetPixels(rt, 0, 0, faceRes, faceRes, pixels);

        for (let p = 0; p < pixels.length; p += 4) {
          lumSum += (R_W * pixels[p] + G_W * pixels[p + 1] + B_W * pixels[p + 2]) / 255;
        }
      }
      const value = lumSum / (FACE_DIRS.length * pixelsPerFace);
      data[z][x] = value;

      done++;
      opts.onProgress?.(done, total, value);

      // Yield every 16 probes so the tab stays responsive.
      if (done % 16 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }

  opts.renderer.setRenderTarget(prevTarget);
  rt.dispose();

  // Restore non-splat visibility
  for (const [node, visible] of prevVisible) node.visible = visible;

  return {
    version: 1,
    origin: [bbox.min.x + cell / 2, bbox.min.z + cell / 2],
    cell,
    y: opts.probeY,
    data,
    bakedAt: new Date().toISOString(),
    bbox: {
      min: [bbox.min.x, bbox.min.y, bbox.min.z],
      max: [bbox.max.x, bbox.max.y, bbox.max.z],
    },
  };
}

/** Trigger a browser download of the grid as JSON. User saves to public/. */
export function downloadGrid(grid, filename) {
  const blob = new Blob([JSON.stringify(grid)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
