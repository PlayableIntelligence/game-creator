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

const _cache = new Map();   // url → Promise<VRM>

export function loadVRM(url) {
  if (_cache.has(url)) return _cache.get(url);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const promise = new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const vrm = gltf.userData?.vrm;
        if (!vrm) {
          reject(new Error(`VRM not found in ${url} — is it actually a .vrm file?`));
          return;
        }
        // Three optimization passes recommended by three-vrm docs:
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

  _cache.set(url, promise);
  return promise;
}
