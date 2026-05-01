import { SplatMesh } from '@sparkjsdev/spark';
import { applyMatrixToObject } from './SplatTransform.js';
import { WORLD, SPLAT, DEVICE } from '../core/Constants.js';

/**
 * SplatLoader — picks the right tier per device, supports progressive upgrade.
 *
 * Mobile (DEVICE.isMobile === true) loads only the "mini" 100k tier.
 *   100k splats fits comfortably in 1.4 MB on disk; perfect for 4G/5G.
 *
 * Desktop progressive: 500k tier loads first (visible in ~2s), then the full
 *   tier downloads in background and atomically swaps in. The `onMesh` callback
 *   fires for every mesh that goes live so callers can re-attach worldModifiers
 *   (fog, mirror) to the upgraded mesh.
 *
 * Returns:
 *   { active: SplatMesh, dispose() }
 *
 * The `active` getter always returns the current best mesh — read it on every
 * use rather than caching.
 */
export async function loadSplat(scene, transform, onMesh) {
  async function makeMesh(url, opts = {}) {
    const mesh = new SplatMesh({
      url,
      // Per-mesh LoD opt-in (Spark default: undefined → off). The renderer-
      // level enableLod controls the global system; this controls whether
      // THIS mesh is part of it. We keep it on for desktop progressive and
      // off for mobile (single tier already cheap enough).
      lod: opts.lod ?? !DEVICE.isMobile,
    });
    applyMatrixToObject(mesh, transform);
    await mesh.initialized;
    return mesh;
  }

  let active;

  switch (SPLAT.quality) {
    case 'mini': {
      active = await makeMesh(WORLD.paths.mini, { lod: false });
      scene.add(active);
      onMesh?.(active);
      console.info('[SplatLoader] mini tier (100k) loaded');
      break;
    }
    case 'low': {
      active = await makeMesh(WORLD.paths.low);
      scene.add(active);
      onMesh?.(active);
      console.info('[SplatLoader] low tier (500k) loaded');
      break;
    }
    case 'full': {
      active = await makeMesh(WORLD.paths.full);
      scene.add(active);
      onMesh?.(active);
      console.info('[SplatLoader] full tier loaded directly');
      break;
    }
    case 'progressive':
    default: {
      // 500k tier up first
      active = await makeMesh(WORLD.paths.low);
      scene.add(active);
      onMesh?.(active);
      console.info('[SplatLoader] 500k tier up (progressive)');

      // Full-res in background — fire and forget. If it fails, the 500k stays.
      (async () => {
        try {
          const full = await makeMesh(WORLD.paths.full);
          scene.add(full);
          onMesh?.(full);
          scene.remove(active);
          active.dispose?.();
          active = full;
          console.info('[SplatLoader] upgraded to full-res');
        } catch (err) {
          console.warn('[SplatLoader] full-res upgrade failed —', err);
        }
      })();
      break;
    }
  }

  return {
    get active() { return active; },
    dispose() {
      scene.remove(active);
      active.dispose?.();
    },
  };
}
