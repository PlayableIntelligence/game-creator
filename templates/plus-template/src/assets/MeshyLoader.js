import { loadAsset, spawnAsset } from './AssetLoader.js';

/**
 * MeshyLoader — wrapper around AssetLoader for Meshy AI generations.
 *
 * Meshy's CLI (scripts/meshy-generate.mjs from game-creator) produces:
 *
 *   public/assets/meshy/<slug>/
 *     <slug>.glb              ← the model (or <slug>-rigged.glb for animated)
 *     <slug>.meta.json        ← metadata: prompt, license, file paths, stats
 *
 * meta.json shape (from meshy-generate.mjs):
 *   {
 *     "name": "boss-001",
 *     "prompt": "...",
 *     "files": { "glb": "boss-001.glb", "rigged": "boss-001-rigged.glb"? },
 *     "license": "Meshy Generated",
 *     "source": "meshy",
 *     "createdAt": "..."
 *   }
 *
 * loadMeshy() reads the meta.json, picks the rigged variant if it exists,
 * and hands off to AssetLoader.loadAsset(). The returned object is the same
 * shape as loadAsset's plus a `meta` field with the parsed JSON.
 *
 * Spawn the same way as any other asset:
 *
 *   const boss = await loadMeshy('/assets/meshy/boss/boss.meta.json');
 *   const { instance, mixer, actions } = spawnAsset(boss, scene, {
 *     position: [10, fakeFloor.topY, 0],
 *     rotation: [0, Math.PI, 0],
 *     scale: 1.5,
 *     withMixer: true,
 *   });
 *   actions.idle?.play();
 */
export async function loadMeshy(metaUrl) {
  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) {
    throw new Error(`Meshy meta not found at ${metaUrl} (HTTP ${metaRes.status})`);
  }
  const meta = await metaRes.json();

  // Resolve GLB path relative to meta.json location
  const baseDir = metaUrl.substring(0, metaUrl.lastIndexOf('/'));
  // Prefer rigged (with skeleton) over static. Different Meshy export pipelines
  // produce different field names — try the common ones.
  const glbFile =
    meta.files?.rigged ||
    meta.files?.glb ||
    meta.glbPath ||
    meta.path ||
    null;
  if (!glbFile) {
    throw new Error(`Meshy meta.json at ${metaUrl} has no GLB file path (looked at meta.files.{rigged,glb} and meta.glbPath/path)`);
  }
  const glbUrl = glbFile.startsWith('/') ? glbFile : `${baseDir}/${glbFile}`;

  console.info(
    `[Meshy] "${meta.name || 'unnamed'}"  ${glbUrl}  ` +
    `${meta.license ? `· ${meta.license}` : ''}`,
  );

  const asset = await loadAsset(glbUrl);
  return { ...asset, meta };
}

// Re-export spawnAsset so callers can import everything from MeshyLoader if
// they only deal with Meshy assets.
export { spawnAsset };
