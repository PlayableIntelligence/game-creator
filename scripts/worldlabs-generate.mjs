#!/usr/bin/env node
/**
 * worldlabs-generate.mjs — Generate 3D worlds/environments with World Labs Marble API.
 *
 * Zero npm dependencies. Uses Node.js built-in fetch, fs, path.
 *
 * Modes:
 *   text          — Generate a 3D world from a text prompt
 *   image         — Generate a 3D world from an image (upload → generate)
 *   status        — Check generation status by operation ID
 *   get           — Fetch a world by ID and download assets
 *   list          — List your generated worlds
 *
 * Usage:
 *   # Text to 3D world
 *   WORLDLABS_API_KEY=<key> node scripts/worldlabs-generate.mjs \
 *     --mode text --prompt "a neon-lit retro arcade with classic cabinet machines" \
 *     --output public/assets/worlds/ --slug arcade
 *
 *   # Image to 3D world
 *   WORLDLABS_API_KEY=<key> node scripts/worldlabs-generate.mjs \
 *     --mode image --image ./arcade-photo.jpg \
 *     --output public/assets/worlds/ --slug arcade
 *
 *   # Check status
 *   WORLDLABS_API_KEY=<key> node scripts/worldlabs-generate.mjs \
 *     --mode status --operation-id <op-id>
 *
 *   # Download assets from existing world
 *   WORLDLABS_API_KEY=<key> node scripts/worldlabs-generate.mjs \
 *     --mode get --world-id <id> --output public/assets/worlds/ --slug arcade
 *
 *   # List worlds
 *   WORLDLABS_API_KEY=<key> node scripts/worldlabs-generate.mjs --mode list
 *
 * Output:
 *   {slug}.spz              — Gaussian Splat (full resolution)
 *   {slug}-100k.spz         — Gaussian Splat (100k, lightweight)
 *   {slug}-500k.spz         — Gaussian Splat (500k, medium)
 *   {slug}-collider.glb     — Collider mesh (GLB, for physics)
 *   {slug}-pano.jpg         — Panorama image
 *   {slug}.meta.json        — Source, prompt, world ID, timestamps, asset URLs
 *
 * Environment:
 *   WORLDLABS_API_KEY       — Required. Get one at https://platform.worldlabs.ai/
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIRECT_API_BASE = 'https://api.worldlabs.ai/marble/v1';
const DEFAULT_PROXY   = 'https://plus.gamecreator.dev';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 720; // 60 minutes max (worlds can take a while)

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

const hasFlag = (name) => args.includes(`--${name}`);

const mode = getArg('mode');
const prompt = getArg('prompt');
const imagePath = getArg('image');
const outputDir = getArg('output', 'public/assets/worlds');
const slug = getArg('slug');
const operationId = getArg('operation-id');
const worldId = getArg('world-id');
const displayName = getArg('name');
const model = getArg('model'); // optional model override
const seed = getArg('seed');
const noPoll = hasFlag('no-poll');
const resolution = getArg('resolution', 'full_res'); // 100k, 500k, full_res
const skipSplats = hasFlag('skip-splats');
const skipCollider = hasFlag('skip-collider');
const skipPano = hasFlag('skip-pano');
const pageSize = parseInt(getArg('page-size', '20'), 10);

// Routing — Plus proxy if GCPLUS_TOKEN is set or ~/.gcplus/token exists,
// else direct upstream with WORLDLABS_API_KEY. Proxy mode pays through your
// Plus credit balance; direct mode hits World Labs with your own API key.
const TOKEN_PATH  = join(homedir(), '.gcplus', 'token');
const GCPLUS_TOKEN =
  process.env.GCPLUS_TOKEN ||
  (existsSync(TOKEN_PATH) ? readFileSync(TOKEN_PATH, 'utf8').trim() : null);
const GCPLUS_PROXY = process.env.GCPLUS_PROXY || DEFAULT_PROXY;
const API_KEY      = process.env.WORLDLABS_API_KEY;

const useProxy = !!GCPLUS_TOKEN;
const API_BASE = useProxy ? `${GCPLUS_PROXY}/v1/marble` : DIRECT_API_BASE;

function requireApiKey() {
  if (useProxy) return; // token already validated above
  if (!API_KEY) {
    throw new Error(
      'No credentials. Set GCPLUS_TOKEN (proxy mode) or WORLDLABS_API_KEY (direct).\n' +
      '  - Plus proxy: node scripts/plus-auth.mjs signup --email <you@example.com>\n' +
      '  - Direct API: get a key at https://platform.worldlabs.ai/',
    );
  }
}

if (!mode) {
  console.error(`Usage: WORLDLABS_API_KEY=<key> node scripts/worldlabs-generate.mjs --mode <mode> [options]

Modes:
  text            Generate 3D world from text prompt
  image           Generate 3D world from image
  status          Check generation operation status
  get             Fetch world by ID and download assets
  list            List your generated worlds

Options:
  --prompt <text>           Text prompt (text mode)
  --image <path|url>        Image file path or URL (image mode)
  --output <dir>            Output directory (default: public/assets/worlds)
  --slug <name>             Output filename slug
  --name <text>             Display name for the world
  --operation-id <id>       Operation ID (status mode)
  --world-id <id>           World ID (get mode)
  --model <name>            AI model override
  --seed <int>              Generation seed for reproducibility
  --resolution <tier>       SPZ resolution: 100k, 500k, full_res (default: full_res)
  --skip-splats             Don't download SPZ files
  --skip-collider           Don't download collider mesh
  --skip-pano               Don't download panorama
  --page-size <n>           Number of worlds to list (default: 20)
  --no-poll                 Submit and exit without waiting

Environment:
  WORLDLABS_API_KEY         API key from https://platform.worldlabs.ai/`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function headers(contentType = 'application/json') {
  const h = useProxy
    ? { Authorization: `Bearer ${GCPLUS_TOKEN}` }
    : { 'WLT-Api-Key': API_KEY };
  if (contentType) h['Content-Type'] = contentType;
  return h;
}

async function apiPost(path, body) {
  const url = `${API_BASE}${path}`;
  const reqHeaders = headers();
  // Plus proxy honors Idempotency-Key for billed endpoints — set it on
  // every generate so retries don't double-bill.
  if (useProxy && path.includes(':generate')) {
    reqHeaders['Idempotency-Key'] = randomUUID();
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Plus proxy returns 402 with a topup URL when out of credits — surface
    // it as a friendly error message.
    if (useProxy && res.status === 402) {
      let parsed;
      try { parsed = JSON.parse(text); } catch {}
      throw new Error(
        `Out of credits. Need ${parsed?.needed ?? '?'} cr, have ${parsed?.balance ?? '?'} cr.\n` +
        `Top up: node scripts/plus-auth.mjs topup --amount 20`,
      );
    }
    throw new Error(`POST ${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function apiGet(path) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { headers: headers(null) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function downloadFile(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buffer);
  return buffer.length;
}

function writeMeta(outPath, meta) {
  writeFileSync(outPath, JSON.stringify(meta, null, 2) + '\n');
  console.log(`  meta → ${outPath}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Upload image as media asset
// ---------------------------------------------------------------------------

async function uploadImage(imgPath) {
  // Determine if it's a URL or local file
  if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) {
    // Download to temp, then upload
    console.log(`  [worldlabs] Downloading image from URL...`);
    const res = await fetch(imgPath);
    if (!res.ok) throw new Error(`Failed to download image: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = extname(new URL(imgPath).pathname) || '.jpg';
    const fileName = `upload${ext}`;
    return await uploadBuffer(buffer, fileName, ext);
  }

  // Local file
  const absPath = resolve(imgPath);
  if (!existsSync(absPath)) {
    throw new Error(`Image file not found: ${absPath}`);
  }
  const buffer = readFileSync(absPath);
  const ext = extname(absPath) || '.jpg';
  const fileName = basename(absPath);
  return await uploadBuffer(buffer, fileName, ext);
}

async function uploadBuffer(buffer, fileName, ext) {
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const contentType = mimeMap[ext.toLowerCase()] || 'image/jpeg';
  const kind = 'image';
  const extension = ext.replace('.', '');

  // Step 1: Prepare upload — get signed URL
  console.log(`  [worldlabs] Preparing media asset upload (${fileName})...`);
  const prepareRes = await apiPost('/media-assets:prepare_upload', {
    file_name: fileName,
    kind,
    extension,
  });

  const mediaAssetId = prepareRes.media_asset?.media_asset_id;
  const uploadUrl = prepareRes.upload_info?.upload_url;
  const uploadMethod = prepareRes.upload_info?.upload_method || 'PUT';
  const requiredHeaders = prepareRes.upload_info?.required_headers || {};

  if (!mediaAssetId || !uploadUrl) {
    throw new Error(`Unexpected prepare_upload response: ${JSON.stringify(prepareRes)}`);
  }

  console.log(`  [worldlabs] Media asset ID: ${mediaAssetId}`);

  // Step 2: Upload to signed URL
  console.log(`  [worldlabs] Uploading ${formatBytes(buffer.length)}...`);
  const uploadRes = await fetch(uploadUrl, {
    method: uploadMethod,
    headers: { 'Content-Type': contentType, ...requiredHeaders },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => '');
    throw new Error(`Upload failed: HTTP ${uploadRes.status}: ${text}`);
  }

  console.log(`  [worldlabs] Upload complete!`);
  return mediaAssetId;
}

// ---------------------------------------------------------------------------
// Poll for operation completion
// ---------------------------------------------------------------------------

async function pollOperation(opId, label) {
  console.log(`  [worldlabs] Polling ${label}...`);
  let lastStatus = '';
  let dots = 0;

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const op = await apiGet(`/operations/${opId}`);

    const done = op.done || false;
    const progressInfo = op.metadata?.progress || {};
    const status = progressInfo.status || (done ? 'DONE' : 'PENDING');
    const description = progressInfo.description || '';

    if (status !== lastStatus) {
      lastStatus = status;
      dots = 0;
      process.stdout.write(`\n  [worldlabs] ${status}: ${description}`);
    } else {
      dots++;
      process.stdout.write('.');
    }

    if (done) {
      console.log(`\n  [worldlabs] ${label} complete!`);
      return op;
    }

    if (op.error) {
      throw new Error(`${label} failed: ${JSON.stringify(op.error)}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`${label} timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 60000} minutes`);
}

// ---------------------------------------------------------------------------
// Download world assets
// ---------------------------------------------------------------------------

async function downloadWorldAssets(world, outDir, fileSlug) {
  mkdirSync(outDir, { recursive: true });

  const assets = world.snapshot?.assets || world.assets || {};
  const downloaded = {};

  // Splat files (SPZ)
  if (!skipSplats) {
    const splats = assets.splats?.spz_urls || {};

    // Download requested resolution
    if (splats.full_res) {
      const dest = join(outDir, `${fileSlug}.spz`);
      console.log(`  [worldlabs] Downloading SPZ (full res)...`);
      try {
        const size = await downloadFile(splats.full_res, dest);
        console.log(`  splat → ${dest} (${formatBytes(size)})`);
        downloaded.spzFullRes = basename(dest);
      } catch (err) {
        console.log(`  [worldlabs] Full res SPZ download failed: ${err.message}`);
      }
    }

    if (splats['500k']) {
      const dest = join(outDir, `${fileSlug}-500k.spz`);
      console.log(`  [worldlabs] Downloading SPZ (500k)...`);
      try {
        const size = await downloadFile(splats['500k'], dest);
        console.log(`  splat → ${dest} (${formatBytes(size)})`);
        downloaded.spz500k = basename(dest);
      } catch (err) {
        console.log(`  [worldlabs] 500k SPZ download failed: ${err.message}`);
      }
    }

    if (splats['100k']) {
      const dest = join(outDir, `${fileSlug}-100k.spz`);
      console.log(`  [worldlabs] Downloading SPZ (100k)...`);
      try {
        const size = await downloadFile(splats['100k'], dest);
        console.log(`  splat → ${dest} (${formatBytes(size)})`);
        downloaded.spz100k = basename(dest);
      } catch (err) {
        console.log(`  [worldlabs] 100k SPZ download failed: ${err.message}`);
      }
    }
  }

  // Collider mesh (GLB)
  if (!skipCollider) {
    const colliderUrl = assets.mesh?.collider_mesh_url;
    if (colliderUrl) {
      const dest = join(outDir, `${fileSlug}-collider.glb`);
      console.log(`  [worldlabs] Downloading collider mesh (GLB)...`);
      try {
        const size = await downloadFile(colliderUrl, dest);
        console.log(`  mesh  → ${dest} (${formatBytes(size)})`);
        downloaded.colliderMesh = basename(dest);
      } catch (err) {
        console.log(`  [worldlabs] Collider mesh download failed: ${err.message}`);
      }
    }
  }

  // Panorama
  if (!skipPano) {
    const panoUrl = assets.imagery?.pano_url;
    if (panoUrl) {
      const ext = panoUrl.includes('.png') ? '.png' : '.jpg';
      const dest = join(outDir, `${fileSlug}-pano${ext}`);
      console.log(`  [worldlabs] Downloading panorama...`);
      try {
        const size = await downloadFile(panoUrl, dest);
        console.log(`  pano  → ${dest} (${formatBytes(size)})`);
        downloaded.panorama = basename(dest);
      } catch (err) {
        console.log(`  [worldlabs] Panorama download failed: ${err.message}`);
      }
    }
  }

  // Thumbnail
  const thumbUrl = assets.thumbnail_url;
  if (thumbUrl) {
    const dest = join(outDir, `${fileSlug}-thumb.jpg`);
    try {
      await downloadFile(thumbUrl, dest);
      downloaded.thumbnail = basename(dest);
    } catch { /* non-critical */ }
  }

  return downloaded;
}

// ---------------------------------------------------------------------------
// Text to World
// ---------------------------------------------------------------------------

async function textToWorld() {
  if (!prompt) {
    console.error('Error: --prompt is required for text mode');
    process.exit(1);
  }

  const fileSlug = slug || slugify(prompt);
  const outDir = resolve(outputDir);
  mkdirSync(outDir, { recursive: true });

  console.log(`\n=== World Labs Text-to-World: "${prompt}" ===\n`);

  const payload = {
    world_prompt: {
      type: 'text',
      text_prompt: prompt,
    },
  };

  if (displayName) payload.display_name = displayName;
  if (model) payload.model = model;
  if (seed) payload.seed = parseInt(seed, 10);

  console.log('  [worldlabs] Starting world generation...');
  const result = await apiPost('/worlds:generate', payload);

  // The response is an operation
  const opId = result.operation_id || result.name || result.id;
  console.log(`  [worldlabs] Operation: ${opId}`);

  if (noPoll) {
    console.log(`\n  Task submitted. Check status with:`);
    console.log(`  node scripts/worldlabs-generate.mjs --mode status --operation-id ${opId}`);
    return;
  }

  const op = await pollOperation(opId, 'World generation');

  // Extract world from operation result — may need to fetch by world_id
  let world = op.response || op.result || op;
  const wId = world.world_id || world.id || op.metadata?.world_id;
  console.log(`  [worldlabs] World ID: ${wId}`);

  // If operation response doesn't include assets, fetch the world directly
  const hasAssets = world.snapshot?.assets || world.assets;
  if (!hasAssets && wId) {
    console.log(`  [worldlabs] Fetching world details...`);
    world = await apiGet(`/worlds/${wId}`);
  }

  // Download all assets
  const downloaded = await downloadWorldAssets(world, outDir, fileSlug);

  // Caption
  const caption = world.snapshot?.assets?.caption || world.assets?.caption || null;
  if (caption) console.log(`  [worldlabs] Caption: ${caption}`);

  writeMeta(join(outDir, `${fileSlug}.meta.json`), {
    slug: fileSlug,
    source: 'worldlabs',
    mode: 'text-to-world',
    prompt,
    displayName: displayName || null,
    worldId: wId,
    operationId: opId,
    model: model || 'default',
    seed: seed ? parseInt(seed, 10) : null,
    caption,
    downloaded,
    createdAt: new Date().toISOString(),
  });

  console.log(`\n=== Done: ${Object.keys(downloaded).length} assets downloaded to ${outDir} ===\n`);
}

// ---------------------------------------------------------------------------
// Image to World
// ---------------------------------------------------------------------------

async function imageToWorld() {
  if (!imagePath) {
    console.error('Error: --image is required for image mode');
    process.exit(1);
  }

  const fileSlug = slug || 'image-world';
  const outDir = resolve(outputDir);
  mkdirSync(outDir, { recursive: true });

  console.log(`\n=== World Labs Image-to-World ===\n`);

  // Upload image first
  const mediaAssetId = await uploadImage(imagePath);

  const payload = {
    world_prompt: {
      type: 'image',
      image_prompt: {
        source: 'media_asset',
        media_asset_id: mediaAssetId,
      },
    },
  };

  if (displayName) payload.display_name = displayName;
  if (model) payload.model = model;
  if (seed) payload.seed = parseInt(seed, 10);

  console.log('  [worldlabs] Starting world generation from image...');
  const result = await apiPost('/worlds:generate', payload);

  const opId = result.operation_id || result.name || result.id;
  console.log(`  [worldlabs] Operation: ${opId}`);

  if (noPoll) {
    console.log(`\n  Task submitted. Check status with:`);
    console.log(`  node scripts/worldlabs-generate.mjs --mode status --operation-id ${opId}`);
    return;
  }

  const op = await pollOperation(opId, 'World generation');

  let world = op.response || op.result || op;
  const wId = world.world_id || world.id || op.metadata?.world_id;
  console.log(`  [worldlabs] World ID: ${wId}`);

  const hasAssets = world.snapshot?.assets || world.assets;
  if (!hasAssets && wId) {
    console.log(`  [worldlabs] Fetching world details...`);
    world = await apiGet(`/worlds/${wId}`);
  }

  const downloaded = await downloadWorldAssets(world, outDir, fileSlug);

  const caption = world.snapshot?.assets?.caption || world.assets?.caption || null;
  if (caption) console.log(`  [worldlabs] Caption: ${caption}`);

  writeMeta(join(outDir, `${fileSlug}.meta.json`), {
    slug: fileSlug,
    source: 'worldlabs',
    mode: 'image-to-world',
    imagePath: imagePath.startsWith('data:') ? '(base64)' : imagePath,
    mediaAssetId,
    displayName: displayName || null,
    worldId: wId,
    operationId: opId,
    model: model || 'default',
    seed: seed ? parseInt(seed, 10) : null,
    caption,
    downloaded,
    createdAt: new Date().toISOString(),
  });

  console.log(`\n=== Done: ${Object.keys(downloaded).length} assets downloaded to ${outDir} ===\n`);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

async function checkStatus() {
  if (!operationId) {
    console.error('Error: --operation-id is required for status mode');
    process.exit(1);
  }

  console.log(`\n=== World Labs Operation Status ===\n`);
  const op = await apiGet(`/operations/${operationId}`);

  console.log(`  Operation: ${operationId}`);
  console.log(`  Done:      ${op.done || false}`);

  const progressInfo = op.metadata?.progress || {};
  if (progressInfo.status) {
    console.log(`  Status:    ${progressInfo.status}`);
  }
  if (progressInfo.description) {
    console.log(`  Detail:    ${progressInfo.description}`);
  }
  if (op.metadata?.world_id) {
    console.log(`  World ID:  ${op.metadata.world_id}`);
  }

  if (op.error) {
    console.log(`  Error:     ${JSON.stringify(op.error)}`);
  }

  if (op.response || op.result) {
    const world = op.response || op.result;
    console.log(`  World ID:  ${world.world_id || world.id || 'unknown'}`);

    const assets = world.snapshot?.assets || world.assets || {};
    if (assets.splats?.spz_urls) {
      console.log(`  SPZ URLs:`);
      for (const [tier, url] of Object.entries(assets.splats.spz_urls)) {
        if (url) console.log(`    ${tier}: ${url.slice(0, 80)}...`);
      }
    }
    if (assets.mesh?.collider_mesh_url) {
      console.log(`  Collider:  ${assets.mesh.collider_mesh_url.slice(0, 80)}...`);
    }
    if (assets.caption) {
      console.log(`  Caption:   ${assets.caption}`);
    }
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Get world by ID
// ---------------------------------------------------------------------------

async function getWorld() {
  if (!worldId) {
    console.error('Error: --world-id is required for get mode');
    process.exit(1);
  }

  const fileSlug = slug || 'world';
  const outDir = resolve(outputDir);

  console.log(`\n=== World Labs Get World ===\n`);

  const world = await apiGet(`/worlds/${worldId}`);
  console.log(`  World ID:  ${world.world_id || world.id}`);
  console.log(`  Name:      ${world.display_name || '(unnamed)'}`);

  const downloaded = await downloadWorldAssets(world, outDir, fileSlug);

  writeMeta(join(outDir, `${fileSlug}.meta.json`), {
    slug: fileSlug,
    source: 'worldlabs',
    mode: 'get',
    worldId,
    displayName: world.display_name || null,
    downloaded,
    createdAt: new Date().toISOString(),
  });

  console.log(`\n=== Done: ${Object.keys(downloaded).length} assets downloaded ===\n`);
}

// ---------------------------------------------------------------------------
// List worlds
// ---------------------------------------------------------------------------

async function listWorlds() {
  console.log(`\n=== World Labs — Your Worlds ===\n`);

  const result = await apiGet(`/worlds?page_size=${pageSize}`);
  const worlds = result.worlds || result.items || [];

  if (worlds.length === 0) {
    console.log('  No worlds found.');
  } else {
    for (const w of worlds) {
      const id = w.world_id || w.id;
      const name = w.display_name || '(unnamed)';
      const created = w.create_time || w.created_at || '';
      console.log(`  ${id}  ${name}  ${created}`);
    }
    console.log(`\n  Total: ${worlds.length} world(s)`);
  }

  if (result.next_page_token) {
    console.log(`  More available (next_page_token: ${result.next_page_token})`);
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  requireApiKey();
  switch (mode) {
    case 'text':
      return textToWorld();
    case 'image':
      return imageToWorld();
    case 'status':
      return checkStatus();
    case 'get':
      return getWorld();
    case 'list':
      return listWorlds();
    default:
      console.error(`Unknown mode: "${mode}". Use: text, image, status, get, list`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
