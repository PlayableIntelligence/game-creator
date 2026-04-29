#!/usr/bin/env node
/**
 * plus-generate-world.mjs — Cathedral-Pattern wrapper around worldlabs-generate.mjs.
 *
 * What it does:
 *   1. Forces Marble 1.1 Plus (overridable with --model)
 *   2. Auto-prepends cathedral-pattern preamble to the user's prompt
 *      ("mostly empty interior, high ceilings, clear walking paths, ...")
 *      → makes the resulting splat actually playable as a game level
 *   3. Strongly recommends a reference image; warns clearly if missing
 *   4. Routes through the OGP Plus proxy when GCPLUS_TOKEN is set
 *      (passthrough billing); falls back to direct Marble API otherwise
 *   5. Writes an extended .meta.json including the augmented prompt and the
 *      Plus job_id (when proxy mode), so we can audit + reconcile later
 *
 * Zero npm dependencies. Uses Node.js built-in fetch, fs, path.
 *
 * Modes:
 *   generate      — Generate a new world (text or image input)  [default]
 *   status        — Check generation status
 *   get           — Download an existing world's assets
 *   list          — List your worlds
 *
 * Usage:
 *   # With reference image (recommended):
 *   node scripts/plus-generate-world.mjs \
 *     --prompt "a gothic cathedral with stained glass" \
 *     --image ./refs/cathedral.jpg \
 *     --slug cathedral
 *
 *   # Text only (results vary):
 *   node scripts/plus-generate-world.mjs \
 *     --prompt "a sci-fi corridor" \
 *     --slug corridor \
 *     --no-image-warning
 *
 *   # Use Marble Standard (1.1) instead of Plus to save 20-50%:
 *   node scripts/plus-generate-world.mjs --model marble-1.1 ...
 *
 *   # Skip cathedral-pattern augmentation (NOT recommended):
 *   node scripts/plus-generate-world.mjs --no-augment ...
 *
 * Environment:
 *   GCPLUS_TOKEN          — Plus bearer token (proxy mode, billed)
 *   GCPLUS_PROXY          — Override proxy URL (default: https://plus.gamecreator.dev)
 *   WORLDLABS_API_KEY     — Direct Marble API key (BYO mode, fallback)
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { buildRichPrompt, listSceneTypes } from './plus-prompt-templates.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PROXY = 'https://plus.gamecreator.dev';
const MARBLE_DIRECT_BASE = 'https://api.worldlabs.ai/marble/v1';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 720; // 60 minutes max

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}
const hasFlag = (name) => args.includes(`--${name}`);

const mode = getArg('mode', 'generate');
const userPrompt = getArg('prompt');
const imagePath = getArg('image');
const outputDir = getArg('output', 'public/assets/worlds');
const slug = getArg('slug');
const operationId = getArg('operation-id');
const worldId = getArg('world-id');
const displayName = getArg('name');
const model = getArg('model', 'marble-1.1-plus'); // default to Plus
const seed = getArg('seed');
const noPoll = hasFlag('no-poll');
const noAugment = hasFlag('no-augment');
const noImageWarning = hasFlag('no-image-warning');
const skipSplats = hasFlag('skip-splats');
const skipCollider = hasFlag('skip-collider');
const skipPano = hasFlag('skip-pano');
const dryRun = hasFlag('dry-run');
const listScenes = hasFlag('list-scene-types');

// Rich-prompt scene-type and per-slot overrides. Default scene-type is
// 'indoor' (cathedral pattern); use 'outdoor-clearing' for forests, etc.
// See plus-prompt-templates.js for the full template + slot definitions.
const sceneType        = getArg('scene-type', 'indoor');
const aestheticOverride = getArg('aesthetic');
const moodOverride      = getArg('mood');
const floorOverride     = getArg('floor');
const clutterOverride   = getArg('clutter');
const perimeterOverride = getArg('perimeter');
const lightingOverride  = getArg('lighting');
const atmosphereOverride = getArg('atmosphere');
const closerOverride    = getArg('closer');

// Token comes from env first, then ~/.gcplus/token (matches worldlabs-
// generate.mjs / meshy-generate.mjs / plus-auth.mjs behavior).
const TOKEN_PATH = join(homedir(), '.gcplus', 'token');
const GCPLUS_TOKEN =
  process.env.GCPLUS_TOKEN ||
  (existsSync(TOKEN_PATH) ? readFileSync(TOKEN_PATH, 'utf8').trim() : null);
const GCPLUS_PROXY = process.env.GCPLUS_PROXY || DEFAULT_PROXY;
const WORLDLABS_API_KEY = process.env.WORLDLABS_API_KEY;

// Routing decision — proxy if we have a token, direct if we have a Marble
// key, error otherwise. Tokens win because they imply billing+mirror+retry.
const useProxy = !!GCPLUS_TOKEN;
const apiBase = useProxy ? `${GCPLUS_PROXY}/v1/marble` : MARBLE_DIRECT_BASE;

function authHeaders() {
  if (useProxy) return { Authorization: `Bearer ${GCPLUS_TOKEN}` };
  if (WORLDLABS_API_KEY) return { 'WLT-Api-Key': WORLDLABS_API_KEY };
  throw new Error(
    'No credentials. Set GCPLUS_TOKEN (proxy mode) or WORLDLABS_API_KEY (direct mode).\n' +
      'Get a Plus token: node scripts/plus-auth.mjs signup\n' +
      'Get a Marble key: https://platform.worldlabs.ai/'
  );
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
plus-generate-world.mjs — Cathedral-Pattern Marble world generator

Usage:
  node scripts/plus-generate-world.mjs [--mode generate] --prompt "<text>" [--image <path|url>] --slug <name>

Modes:
  generate              Generate a new world (default)
  status                Check generation status
  get                   Download an existing world by ID
  list                  List your worlds

Options:
  --prompt <text>       User prompt (will be augmented with cathedral preamble)
  --image <path|url>    Reference image — strongly recommended
  --slug <name>         Output filename slug
  --output <dir>        Output directory (default: public/assets/worlds)
  --name <text>         Display name for the world
  --model <name>        Marble model (default: marble-1.1-plus)
                          Options: marble-1.1-plus, marble-1.1, marble-1.1-mini
  --seed <int>          Generation seed (reproducibility)
  --operation-id <id>   For --mode status
  --world-id <id>       For --mode get
  --no-augment          Skip rich prompt expansion (NOT recommended)
  --no-image-warning    Suppress warning when --image is missing
  --no-poll             Submit and exit; don't poll for completion
  --skip-splats         Don't download SPZ files
  --skip-collider       Don't download collider mesh
  --skip-pano           Don't download panorama
  --dry-run             Show augmented prompt + payload, don't call API

Rich prompt templates (see scripts/plus-prompt-templates.js):
  --scene-type <type>   indoor | outdoor-clearing | corridor | room | arena
                          (default: indoor — cathedral pattern)
  --list-scene-types    Print available scene types + their defaults

Per-slot overrides (override one part, keep the rest of the template):
  --aesthetic <text>    Style descriptor (default per scene-type)
  --mood <text>         Atmosphere mood (e.g. "tense and grand")
  --floor <text>        Floor description sentence
  --clutter <text>      Comma-separated "no X, no Y, no Z" enumeration
  --perimeter <text>    Wall/ceiling/treeline description
  --lighting <text>     Lighting direction + qualities
  --atmosphere <text>   Closer adjective phrase
  --closer <text>       Game-ready ending phrase

Environment:
  GCPLUS_TOKEN          OGP Plus bearer token (enables proxy mode + billing)
  GCPLUS_PROXY          Override proxy URL (default: https://plus.gamecreator.dev)
  WORLDLABS_API_KEY     Direct Marble API key (BYO-key fallback)

Examples:
  # Cathedral with reference image (recommended):
  node scripts/plus-generate-world.mjs \\
    --prompt "a gothic cathedral with stained glass windows" \\
    --image ./refs/cathedral.jpg --slug cathedral

  # Text-only sci-fi corridor:
  node scripts/plus-generate-world.mjs \\
    --prompt "a sci-fi corridor with overhead pipes" \\
    --slug corridor --no-image-warning

  # Use Marble Standard to save cost:
  node scripts/plus-generate-world.mjs --model marble-1.1 \\
    --prompt "a small wooden cabin interior" --slug cabin

  # Forest meadow with explicit scene-type:
  node scripts/plus-generate-world.mjs --scene-type outdoor-clearing \\
    --prompt "an enchanted meadow at dawn" \\
    --image ./refs/forest.jpg --slug forest

  # Sci-fi corridor — full template, no manual prompt-engineering:
  node scripts/plus-generate-world.mjs --scene-type corridor \\
    --prompt "a derelict spaceship maintenance corridor" --slug corridor

  # Tweak just the lighting on the cathedral:
  node scripts/plus-generate-world.mjs \\
    --prompt "a gothic cathedral" \\
    --lighting "warm orange torchlight from sconces along the walls, no windows" \\
    --slug cathedral-warm

The Cathedral Pattern: a bare prompt like "a gothic cathedral" expands into
a 230-word rich Marble prompt with explicit aesthetic + clutter enumeration
+ floor + perimeter + lighting + atmosphere + "The 360 scene is faultless"
closer. This is the load-bearing diff between mediocre and production-quality
generations. See skills/game-creator-plus/cathedral-pattern.md +
scripts/plus-prompt-templates.js.
`);
}

if (listScenes) {
  console.log('\nAvailable scene types:\n');
  for (const s of listSceneTypes()) {
    console.log(`  ${s.type.padEnd(20)} ${s.aesthetic}`);
    console.log(`  ${''.padEnd(20)} → ${s.mood}\n`);
  }
  process.exit(0);
}

if (!mode || hasFlag('help') || hasFlag('h')) {
  printHelp();
  if (hasFlag('help') || hasFlag('h')) process.exit(0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function api(method, path, body) {
  const url = `${apiBase}${path}`;
  const headers = { ...authHeaders() };
  if (body) headers['Content-Type'] = 'application/json';
  // Idempotency for generate calls — proxy honors this, direct Marble ignores
  if (method === 'POST' && useProxy && path.includes(':generate')) {
    headers['Idempotency-Key'] = randomUUID();
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {}
    if (res.status === 402 && parsed?.error === 'insufficient_credits') {
      throw new Error(
        `Out of credits. Balance: ${parsed.balance} cr, need: ${parsed.needed} cr.\n` +
          `Top up: ${parsed.topup_url || `${GCPLUS_PROXY}/topup`}\n` +
          `Or run: node scripts/plus-auth.mjs topup --amount 20`
      );
    }
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function downloadFile(url, dest) {
  const res = await fetch(url, {
    redirect: 'follow',
    // Mirror URLs from the Plus proxy require auth; Marble signed URLs do not
    headers: url.startsWith(GCPLUS_PROXY) ? authHeaders() : {},
  });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buffer);
  return buffer.length;
}

function writeMeta(outPath, meta) {
  writeFileSync(outPath, JSON.stringify(meta, null, 2) + '\n');
  console.log(`  meta → ${outPath}`);
}

// ---------------------------------------------------------------------------
// Cathedral Pattern: prompt augmentation via rich-template expansion
// ---------------------------------------------------------------------------

function augmentPrompt(prompt) {
  if (noAugment) return prompt;
  // Skip if the user already wrote a rich prompt — they might be re-running
  // a saved meta.json's augmented_prompt verbatim. Detection: 200+ chars OR
  // begins with the canonical "The scene is" opener OR contains the
  // "The 360 scene is faultless" closer.
  if (
    prompt.length > 200 ||
    /^the scene is/i.test(prompt.trim()) ||
    /the 360 scene is faultless/i.test(prompt)
  ) {
    return prompt;
  }
  return buildRichPrompt({
    sceneType,
    topic: prompt,
    aesthetic: aestheticOverride,
    mood:      moodOverride,
    floor:     floorOverride,
    clutter:   clutterOverride,
    perimeter: perimeterOverride,
    lighting:  lightingOverride,
    atmosphere: atmosphereOverride,
    closer:    closerOverride,
  });
}

function warnIfNoImage() {
  if (imagePath || noImageWarning) return;
  console.warn(`
  ⚠️  No --image provided. Cathedral pattern works best with a reference image:

      Image guides walls, lighting, materials, color palette → faithful generation
      Text-only → results vary per generation, harder to design a game around

  If you have a reference photo, screenshot, or concept art, pass it via --image.
  Otherwise pass --no-image-warning to suppress this warning.
`);
}

// ---------------------------------------------------------------------------
// Image upload (proxy or direct)
// ---------------------------------------------------------------------------

async function uploadImage(imgPath) {
  let buffer, fileName, ext;

  if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) {
    console.log(`  [plus-gen] Downloading reference image from URL...`);
    const res = await fetch(imgPath);
    if (!res.ok) throw new Error(`Failed to download image: HTTP ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
    ext = extname(new URL(imgPath).pathname) || '.jpg';
    fileName = `upload${ext}`;
  } else {
    const absPath = resolve(imgPath);
    if (!existsSync(absPath)) {
      throw new Error(`Image file not found: ${absPath}`);
    }
    buffer = readFileSync(absPath);
    ext = extname(absPath) || '.jpg';
    fileName = basename(absPath);
  }

  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const contentType = mimeMap[ext.toLowerCase()] || 'image/jpeg';

  console.log(`  [plus-gen] Preparing upload (${fileName}, ${formatBytes(buffer.length)})...`);
  const prepareRes = await api('POST', '/media-assets:prepare_upload', {
    file_name: fileName,
    kind: 'image',
    extension: ext.replace('.', ''),
  });

  const mediaAssetId = prepareRes.media_asset?.media_asset_id;
  const uploadUrl = prepareRes.upload_info?.upload_url;
  const uploadMethod = prepareRes.upload_info?.upload_method || 'PUT';
  const requiredHeaders = prepareRes.upload_info?.required_headers || {};

  if (!mediaAssetId || !uploadUrl) {
    throw new Error(`Unexpected prepare_upload response: ${JSON.stringify(prepareRes)}`);
  }

  console.log(`  [plus-gen] Media asset ID: ${mediaAssetId}`);
  console.log(`  [plus-gen] Uploading...`);

  const uploadRes = await fetch(uploadUrl, {
    method: uploadMethod,
    headers: { 'Content-Type': contentType, ...requiredHeaders },
    body: buffer,
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => '');
    throw new Error(`Upload failed: HTTP ${uploadRes.status}: ${text}`);
  }
  console.log(`  [plus-gen] Upload complete`);
  return mediaAssetId;
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

async function pollOperation(opId, label) {
  console.log(`  [plus-gen] Polling ${label}...`);
  let lastStatus = '';

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const op = await api('GET', `/operations/${opId}`);

    const done = op.done || false;
    const progressInfo = op.metadata?.progress || {};
    const status = progressInfo.status || (done ? 'DONE' : 'PENDING');
    const description = progressInfo.description || '';

    if (status !== lastStatus) {
      lastStatus = status;
      process.stdout.write(`\n  [plus-gen] ${status}: ${description}`);
    } else {
      process.stdout.write('.');
    }

    if (done) {
      console.log(`\n  [plus-gen] ${label} complete`);
      return op;
    }

    if (op.error) {
      throw new Error(`${label} failed: ${JSON.stringify(op.error)}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${label} timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 60000} minutes`);
}

// ---------------------------------------------------------------------------
// Asset download
// ---------------------------------------------------------------------------

async function downloadWorldAssets(world, plusEnvelope, outDir, fileSlug) {
  mkdirSync(outDir, { recursive: true });

  const assets = world.snapshot?.assets || world.assets || {};
  // In proxy mode, prefer mirrored URLs (30d retention) over Marble's signed URLs
  const mirror = plusEnvelope?.asset_mirror_urls || {};
  const downloaded = {};

  // Splat files (SPZ) — full + 500k + 100k tiers
  if (!skipSplats) {
    const splats = assets.splats?.spz_urls || {};

    for (const [tier, suffix] of [
      ['full_res', ''],
      ['500k', '-500k'],
      ['100k', '-100k'],
    ]) {
      const mirrorKey = tier === 'full_res' ? 'spz_full' : `spz_${tier}`;
      const url = mirror[mirrorKey] || splats[tier];
      if (!url) continue;
      const dest = join(outDir, `${fileSlug}${suffix}.spz`);
      console.log(`  [plus-gen] Downloading SPZ (${tier})${mirror[mirrorKey] ? ' [mirror]' : ''}...`);
      try {
        const size = await downloadFile(url, dest);
        console.log(`  splat → ${dest} (${formatBytes(size)})`);
        downloaded[`spz_${tier}`] = basename(dest);
      } catch (err) {
        console.log(`  [plus-gen] ${tier} SPZ download failed: ${err.message}`);
      }
    }
  }

  // Collider mesh (GLB)
  if (!skipCollider) {
    const url = mirror.collider || assets.mesh?.collider_mesh_url;
    if (url) {
      const dest = join(outDir, `${fileSlug}-collider.glb`);
      console.log(`  [plus-gen] Downloading collider${mirror.collider ? ' [mirror]' : ''}...`);
      try {
        const size = await downloadFile(url, dest);
        console.log(`  mesh  → ${dest} (${formatBytes(size)})`);
        downloaded.collider = basename(dest);
      } catch (err) {
        console.log(`  [plus-gen] Collider download failed: ${err.message}`);
      }
    }
  }

  // Panorama
  if (!skipPano) {
    const url = mirror.pano || assets.imagery?.pano_url;
    if (url) {
      const ext = url.includes('.png') ? '.png' : '.jpg';
      const dest = join(outDir, `${fileSlug}-pano${ext}`);
      console.log(`  [plus-gen] Downloading panorama${mirror.pano ? ' [mirror]' : ''}...`);
      try {
        const size = await downloadFile(url, dest);
        console.log(`  pano  → ${dest} (${formatBytes(size)})`);
        downloaded.panorama = basename(dest);
      } catch (err) {
        console.log(`  [plus-gen] Panorama download failed: ${err.message}`);
      }
    }
  }

  // Thumbnail (best-effort)
  const thumbUrl = assets.thumbnail_url;
  if (thumbUrl) {
    const dest = join(outDir, `${fileSlug}-thumb.jpg`);
    try {
      await downloadFile(thumbUrl, dest);
      downloaded.thumbnail = basename(dest);
    } catch {
      /* non-critical */
    }
  }

  return downloaded;
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

async function generate() {
  if (!userPrompt && !imagePath) {
    console.error('Error: --prompt and/or --image required');
    process.exit(1);
  }

  warnIfNoImage();

  const fileSlug = slug || (userPrompt ? slugify(userPrompt) : 'world');
  const outDir = resolve(outputDir);
  mkdirSync(outDir, { recursive: true });

  const augmentedPrompt = userPrompt ? augmentPrompt(userPrompt) : null;

  console.log(`\n=== Plus World Generation ===`);
  console.log(`  Mode:        ${useProxy ? 'proxy (billed)' : 'direct (BYO key)'}`);
  console.log(`  Model:       ${model}`);
  console.log(`  Slug:        ${fileSlug}`);
  if (userPrompt) {
    console.log(`  Prompt:      ${userPrompt}`);
    if (augmentedPrompt !== userPrompt) {
      console.log(`  Augmented:   ${augmentedPrompt}`);
    } else {
      console.log(`  Augmented:   (unchanged — --no-augment)`);
    }
  }
  if (imagePath) console.log(`  Image:       ${imagePath}`);
  console.log('');

  // Build payload
  const payload = { model };
  if (displayName) payload.display_name = displayName;
  if (seed) payload.seed = parseInt(seed, 10);

  if (imagePath) {
    if (dryRun) {
      console.log(`  [dry-run] Would upload image: ${imagePath}`);
      payload.world_prompt = {
        type: 'image',
        image_prompt: { source: 'media_asset', media_asset_id: '<dry-run>' },
        ...(augmentedPrompt ? { text_prompt: augmentedPrompt } : {}),
      };
    } else {
      const mediaAssetId = await uploadImage(imagePath);
      payload.world_prompt = {
        type: 'image',
        image_prompt: { source: 'media_asset', media_asset_id: mediaAssetId },
        ...(augmentedPrompt ? { text_prompt: augmentedPrompt } : {}),
      };
    }
  } else {
    payload.world_prompt = {
      type: 'text',
      text_prompt: augmentedPrompt,
    };
  }

  if (dryRun) {
    console.log(`\n=== Dry Run ===`);
    console.log(`Would POST to: ${apiBase}/worlds:generate`);
    console.log(`Payload:`);
    console.log(JSON.stringify(payload, null, 2));
    process.exit(0);
  }

  console.log(`  [plus-gen] Submitting generation...`);
  const result = await api('POST', '/worlds:generate', payload);

  // Proxy returns { operation_id, job_id, pre_debit_credits, balance_after }
  // Direct Marble returns { operation_id, ... }
  const opId = result.operation_id || result.name || result.id;
  const plusJobId = result.job_id || null;

  console.log(`  [plus-gen] Operation: ${opId}`);
  if (plusJobId) {
    console.log(`  [plus-gen] Plus job:  ${plusJobId}`);
    console.log(`  [plus-gen] Debited:   ${result.pre_debit_credits} cr`);
    console.log(`  [plus-gen] Balance:   ${result.balance_after} cr`);
  }

  if (noPoll) {
    console.log(`\n  Submitted. Check status with:`);
    console.log(`  node scripts/plus-generate-world.mjs --mode status --operation-id ${opId}`);
    return;
  }

  const op = await pollOperation(opId, 'World generation');

  // Extract world data + Plus envelope
  let world = op.response || op.result || op;
  const plusEnvelope = op._plus || null;
  const wId = world.world_id || world.id || op.metadata?.world_id;
  console.log(`  [plus-gen] World ID:  ${wId}`);

  if (plusEnvelope) {
    console.log(`  [plus-gen] Final cost: ${plusEnvelope.final_credits} cr`);
  }

  // Direct mode may need to re-fetch world for assets
  const hasAssets = world.snapshot?.assets || world.assets;
  if (!hasAssets && wId && !plusEnvelope?.asset_mirror_urls) {
    console.log(`  [plus-gen] Fetching world details...`);
    world = await api('GET', `/worlds/${wId}`);
  }

  const downloaded = await downloadWorldAssets(world, plusEnvelope, outDir, fileSlug);

  const caption = world.snapshot?.assets?.caption || world.assets?.caption || null;
  if (caption) console.log(`  [plus-gen] Caption: ${caption}`);

  writeMeta(join(outDir, `${fileSlug}.meta.json`), {
    slug: fileSlug,
    source: 'worldlabs',
    pipeline: 'game-creator-plus',
    cathedral_pattern: !noAugment,
    scene_type: !noAugment ? sceneType : null,
    mode: imagePath ? 'image-to-world' : 'text-to-world',
    user_prompt: userPrompt || null,
    augmented_prompt: augmentedPrompt,
    image_input: imagePath ? (imagePath.startsWith('data:') ? '(base64)' : imagePath) : null,
    display_name: displayName || null,
    world_id: wId,
    operation_id: opId,
    plus_job_id: plusJobId,
    plus_credits: plusEnvelope?.final_credits ?? null,
    model,
    seed: seed ? parseInt(seed, 10) : null,
    caption,
    downloaded,
    semantics_metadata: world.snapshot?.assets?.splats?.semantics_metadata || world.assets?.splats?.semantics_metadata || null,
    created_at: new Date().toISOString(),
  });

  console.log(`\n=== Done: ${Object.keys(downloaded).length} assets in ${outDir} ===\n`);

  // Suggest next steps
  console.log(`Next:`);
  console.log(`  1. Bake lightness grid (optional, ~30s):`);
  console.log(`       node scripts/plus-bake-lightness.mjs --slug ${fileSlug}`);
  console.log(`  2. Wire up template (templates/plus-template/) and run:`);
  console.log(`       cd <your-game> && npm run dev`);
  console.log(``);
}

// ---------------------------------------------------------------------------
// Status / get / list
// ---------------------------------------------------------------------------

async function checkStatus() {
  if (!operationId) {
    console.error('Error: --operation-id required for status mode');
    process.exit(1);
  }
  const op = await api('GET', `/operations/${operationId}`);
  console.log(`\nOperation: ${operationId}`);
  console.log(`Done:      ${op.done || false}`);
  if (op.metadata?.progress) {
    console.log(`Status:    ${op.metadata.progress.status}`);
    console.log(`Detail:    ${op.metadata.progress.description}`);
  }
  if (op.metadata?.world_id) console.log(`World ID:  ${op.metadata.world_id}`);
  if (op._plus) {
    console.log(`Plus job:  ${op._plus.job_id}`);
    console.log(`Final cost: ${op._plus.final_credits} cr`);
  }
  if (op.error) console.log(`Error:     ${JSON.stringify(op.error)}`);
}

async function getWorld() {
  if (!worldId) {
    console.error('Error: --world-id required for get mode');
    process.exit(1);
  }
  const fileSlug = slug || 'world';
  const outDir = resolve(outputDir);
  const world = await api('GET', `/worlds/${worldId}`);
  console.log(`\nWorld: ${world.display_name || '(unnamed)'} (${worldId})`);
  const downloaded = await downloadWorldAssets(world, null, outDir, fileSlug);
  writeMeta(join(outDir, `${fileSlug}.meta.json`), {
    slug: fileSlug,
    source: 'worldlabs',
    pipeline: 'game-creator-plus',
    mode: 'get',
    world_id: worldId,
    display_name: world.display_name || null,
    downloaded,
    semantics_metadata:
      world.snapshot?.assets?.splats?.semantics_metadata ||
      world.assets?.splats?.semantics_metadata ||
      null,
    created_at: new Date().toISOString(),
  });
  console.log(`Done: ${Object.keys(downloaded).length} assets`);
}

async function listWorlds() {
  const result = await api('GET', `/worlds?page_size=20`);
  const worlds = result.worlds || result.items || [];
  if (worlds.length === 0) {
    console.log('No worlds found.');
  } else {
    for (const w of worlds) {
      const id = w.world_id || w.id;
      const name = w.display_name || '(unnamed)';
      console.log(`  ${id}  ${name}  ${w.create_time || ''}`);
    }
    console.log(`Total: ${worlds.length}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  switch (mode) {
    case 'generate':
      return generate();
    case 'status':
      return checkStatus();
    case 'get':
      return getWorld();
    case 'list':
      return listWorlds();
    default:
      console.error(`Unknown mode: ${mode}. Use: generate, status, get, list`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
