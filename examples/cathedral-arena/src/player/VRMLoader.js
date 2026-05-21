import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

/**
 * VRM loader — Pixiv's open-standard humanoid avatar format.
 *
 * VRMs are GLB files with a `VRMC_*` extension that adds:
 *   - Standardized humanoid bone names (`hips`, `spine`, `chest`, `head`,
 *     `leftUpperArm`, ...) — same skeleton across every VRM, regardless of
 *     mesh design. THIS is why VRMs work universally with Mixamo retargeting.
 *   - Optional spring-bone physics (hair sway, skirt physics)
 *   - Expression set (happy, sad, blink, etc.)
 *   - LookAt rig
 *
 * VRMs do NOT ship with animations. Use `MixamoRetarget.js` to load free
 * animations from mixamo.com (FBX) and apply them to the VRM's normalized
 * humanoid.
 *
 * Source: opensourceavatars.com (CC0), VRoid Hub, plus any FBX → VRM exporter.
 *
 * Source: ported from /Users/rshtirmer/Documents/work/opg/ai/splats/src/vrm-loader.ts
 */

/**
 * NOTE: no Promise-by-URL cache here on purpose. Each call must return its
 * own fresh `vrm` (with its own `vrm.scene` Object3D), otherwise multiplayer
 * breaks: the second `loadVRM(sameUrl)` returns the cached vrm.scene, and
 * adding it to a new parent re-parents it OUT of the first parent — the
 * local player's character mesh disappears the instant a remote player
 * joins. The browser's HTTP cache covers the network round-trip; only the
 * GLTF parse repeats (a few hundred ms, once per peer).
 */
export function loadVRM(url) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const vrm = gltf.userData?.vrm;
        if (!vrm) {
          reject(new Error(`VRM not found in ${url} — is it actually a .vrm file?`));
          return;
        }
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
        // VRM 0.x assets face -Z by default; rotate them so they face +Z to
        // match the VRM 1.0 standard. No-op for VRM 1.0 assets.
        VRMUtils.rotateVRM0(vrm);
        resolve(vrm);
      },
      undefined,
      (err) => reject(new Error(`Failed to load VRM ${url}: ${err.message || err}`)),
    );
  });
}
