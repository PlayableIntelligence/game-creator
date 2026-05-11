#!/usr/bin/env node
/**
 * retrodiffusion-generate.mjs — Generate true pixel art with the Retro Diffusion API.
 *
 * Zero npm dependencies. Uses Node.js built-in fetch, fs, path.
 *
 * Modes:
 *   generate   — Text-to-image pixel art (default)
 *   img2img    — Image-to-image (modify an existing image)
 *   animate    — Animation styles (returns base64 GIF or spritesheet)
 *   tileset    — Generate a wang-style tileset or single tile
 *   edit       — Edit an existing image via /v1/edit
 *   balance    — Check remaining credits
 *
 * Usage:
 *   RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs \
 *     --mode generate --prompt "a cute green slime" \
 *     --model RD_FAST --style retro --width 64 --height 64 \
 *     --output public/assets/sprites/ --slug slime
 *
 *   RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs \
 *     --mode img2img --image ./concept.png --prompt "an orange sports car" \
 *     --strength 0.75 --output public/assets/sprites/ --slug car
 *
 *   RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs \
 *     --mode animate --prompt "knight walking" --style walk-cycle \
 *     --output public/assets/sprites/ --slug knight-walk
 *
 *   RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs --mode balance
 *
 * Output:
 *   {slug}.png (or {slug}-{n}.png if num_images > 1)
 *   {slug}.meta.json — prompt, model, style, cost, balance, timestamps
 *
 * Environment:
 *   RETRODIFFUSION_API_KEY  Required. Get one at https://www.retrodiffusion.ai → Account → API.
 *
 * See also: skills/retrodiffusion/SKILL.md
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const API_BASE = 'https://api.retrodiffusion.ai/v1';
const API_KEY = process.env.RETRODIFFUSION_API_KEY || process.env.RD_API_KEY;

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || i + 1 >= args.length ? fallback : args[i + 1];
};
const hasFlag = (name) => args.includes(`--${name}`);

const mode = getArg('mode', 'generate');
const prompt = getArg('prompt');
const negativePrompt = getArg('negative-prompt');
const model = getArg('model', 'RD_FAST');
const style = getArg('style', 'default');
const width = parseInt(getArg('width', '64'), 10);
const height = parseInt(getArg('height', '64'), 10);
const numImages = parseInt(getArg('num-images', '1'), 10);
const seed = getArg('seed') ? parseInt(getArg('seed'), 10) : undefined;
const strength = parseFloat(getArg('strength', '0.75'));
const imagePath = getArg('image');
const palettePath = getArg('palette');
const outputDir = getArg('output', 'public/assets/sprites');
const slug = getArg('slug');
const removeBg = hasFlag('remove-bg');
const tileX = hasFlag('tile-x');
const tileY = hasFlag('tile-y');
const checkCost = hasFlag('check-cost');
const bypassExpansion = hasFlag('bypass-prompt-expansion');

function requireKey() {
  if (!API_KEY) {
    console.error(
      'RETRODIFFUSION_API_KEY environment variable is required.\n' +
      'Get an API key at: https://www.retrodiffusion.ai → Account → API'
    );
    process.exit(1);
  }
}

function slugify(text) {
  return (text || 'output').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

function imageToBase64(p) {
  const buf = readFileSync(resolve(p));
  return buf.toString('base64');
}

async function apiCall(path, body, method = 'POST') {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'X-RD-Token': API_KEY,
      'Content-Type': 'application/json',
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${data.error || data.raw || text}`);
  }
  return data;
}

function ensureOutputDir() {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
}

function writeImages(base64Images, baseSlug, ext = 'png') {
  ensureOutputDir();
  const paths = [];
  base64Images.forEach((b64, i) => {
    const filename = base64Images.length === 1 ? `${baseSlug}.${ext}` : `${baseSlug}-${i + 1}.${ext}`;
    const path = resolve(outputDir, filename);
    writeFileSync(path, Buffer.from(b64, 'base64'));
    paths.push(path);
    console.log(`  wrote ${path} (${(Buffer.byteLength(b64, 'base64') / 1024).toFixed(1)} KB)`);
  });
  return paths;
}

function writeMeta(baseSlug, meta) {
  const path = resolve(outputDir, `${baseSlug}.meta.json`);
  writeFileSync(path, JSON.stringify(meta, null, 2));
  console.log(`  wrote ${path}`);
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

async function runGenerate() {
  if (!prompt) throw new Error('--prompt is required for generate mode');
  const baseSlug = slug || slugify(prompt);
  const payload = {
    prompt,
    model,
    prompt_style: style,
    width,
    height,
    num_images: numImages,
  };
  if (seed !== undefined) payload.seed = seed;
  if (negativePrompt) payload.negative_prompt = negativePrompt;
  if (removeBg) payload.remove_bg = true;
  if (tileX) payload.tile_x = true;
  if (tileY) payload.tile_y = true;
  if (checkCost) payload.check_cost = true;
  if (bypassExpansion) payload.bypass_prompt_expansion = true;
  if (palettePath) payload.input_palette = imageToBase64(palettePath);

  console.log(`→ POST /inferences  model=${model} style=${style} ${width}x${height} n=${numImages}`);
  const data = await apiCall('/inferences', payload);

  if (checkCost) {
    console.log(`  estimated cost: $${data.balance_cost ?? '?'}`);
    return;
  }
  console.log(`  cost: $${data.balance_cost?.toFixed(3) ?? '?'}  remaining: $${data.remaining_balance?.toFixed(2) ?? '?'}`);
  writeImages(data.base64_images || [], baseSlug, 'png');
  writeMeta(baseSlug, {
    mode: 'generate',
    prompt,
    model: data.model || model,
    style,
    width,
    height,
    seed,
    cost: data.balance_cost,
    remaining_balance: data.remaining_balance,
    created_at: data.created_at,
  });
}

async function runImg2Img() {
  if (!prompt) throw new Error('--prompt is required for img2img mode');
  if (!imagePath) throw new Error('--image is required for img2img mode');
  const baseSlug = slug || slugify(prompt);
  const payload = {
    prompt,
    model,
    prompt_style: style,
    width,
    height,
    num_images: numImages,
    input_image: imageToBase64(imagePath),
    strength,
  };
  if (seed !== undefined) payload.seed = seed;
  if (negativePrompt) payload.negative_prompt = negativePrompt;
  if (removeBg) payload.remove_bg = true;

  console.log(`→ POST /inferences (img2img)  strength=${strength}`);
  const data = await apiCall('/inferences', payload);
  console.log(`  cost: $${data.balance_cost?.toFixed(3) ?? '?'}  remaining: $${data.remaining_balance?.toFixed(2) ?? '?'}`);
  writeImages(data.base64_images || [], baseSlug, 'png');
  writeMeta(baseSlug, {
    mode: 'img2img',
    prompt,
    model: data.model || model,
    style,
    strength,
    source_image: resolve(imagePath),
    width,
    height,
    cost: data.balance_cost,
    remaining_balance: data.remaining_balance,
    created_at: data.created_at,
  });
}

async function runAnimate() {
  if (!prompt) throw new Error('--prompt is required for animate mode');
  const baseSlug = slug || slugify(prompt);
  const payload = {
    prompt,
    model,
    prompt_style: style,   // e.g. "walk-cycle", "idle", "attack"
    width,
    height,
    num_images: numImages,
  };
  if (seed !== undefined) payload.seed = seed;
  if (imagePath) payload.input_image = imageToBase64(imagePath);

  console.log(`→ POST /inferences (animation)  style=${style}`);
  const data = await apiCall('/inferences', payload);
  console.log(`  cost: $${data.balance_cost?.toFixed(3) ?? '?'}  remaining: $${data.remaining_balance?.toFixed(2) ?? '?'}`);
  // Animation styles return GIF or spritesheet PNG depending on the style.
  // Sniff the base64 magic bytes — PNG → "iVBORw0K", GIF → "R0lGOD".
  const ext = data.base64_images?.[0]?.startsWith('R0lGOD') ? 'gif' : 'png';
  writeImages(data.base64_images || [], baseSlug, ext);
  writeMeta(baseSlug, {
    mode: 'animate',
    prompt,
    style,
    model: data.model || model,
    width,
    height,
    cost: data.balance_cost,
    remaining_balance: data.remaining_balance,
    created_at: data.created_at,
  });
}

async function runTileset() {
  if (!prompt) throw new Error('--prompt is required for tileset mode');
  const baseSlug = slug || slugify(prompt);
  const payload = {
    prompt,
    model,
    prompt_style: style,   // e.g. "wang-tile", "single-tile"
    width,
    height,
    num_images: numImages,
  };
  if (seed !== undefined) payload.seed = seed;
  if (imagePath) payload.input_image = imageToBase64(imagePath);

  console.log(`→ POST /inferences (tileset)  style=${style}`);
  const data = await apiCall('/inferences', payload);
  console.log(`  cost: $${data.balance_cost?.toFixed(3) ?? '?'}  remaining: $${data.remaining_balance?.toFixed(2) ?? '?'}`);
  writeImages(data.base64_images || [], baseSlug, 'png');
  writeMeta(baseSlug, {
    mode: 'tileset',
    prompt,
    style,
    model: data.model || model,
    width,
    height,
    cost: data.balance_cost,
    remaining_balance: data.remaining_balance,
    created_at: data.created_at,
  });
}

async function runEdit() {
  if (!imagePath) throw new Error('--image is required for edit mode');
  if (!prompt) throw new Error('--prompt is required for edit mode (describes the edit)');
  const baseSlug = slug || `${slugify(prompt)}-edit`;
  const payload = {
    prompt,
    input_image: imageToBase64(imagePath),
  };
  console.log(`→ POST /edit`);
  const data = await apiCall('/edit', payload);
  console.log(`  cost: $${data.balance_cost?.toFixed(3) ?? '?'}  remaining: $${data.remaining_balance?.toFixed(2) ?? '?'}`);
  writeImages(data.base64_images || [], baseSlug, 'png');
  writeMeta(baseSlug, {
    mode: 'edit',
    prompt,
    source_image: resolve(imagePath),
    cost: data.balance_cost,
    remaining_balance: data.remaining_balance,
    created_at: data.created_at,
  });
}

async function runBalance() {
  const data = await apiCall('/inferences/credits', null, 'GET');
  console.log(`Remaining balance: $${data.credits ?? data.remaining_balance ?? '?'}`);
  if (data.tier) console.log(`Tier: ${data.tier}`);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function usage() {
  console.error(`Usage: RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs --mode <mode> [options]

Modes:
  generate   Text-to-image pixel art (default)
  img2img    Image-to-image transformation
  animate    Animation styles (walk-cycle, idle, attack, etc.)
  tileset    Wang-style tileset or single tile
  edit       Edit an existing image (/v1/edit, flat $0.06)
  balance    Check remaining credits

Options:
  --prompt <text>             Text prompt
  --negative-prompt <text>    Negative prompt
  --model <name>              RD_PRO | RD_FAST | RD_PLUS | RD_MINI (default: RD_FAST)
  --style <name>              prompt_style (default: "default" — see api-reference.md)
  --width <n>                 Output width in pixels (default: 64)
  --height <n>                Output height in pixels (default: 64)
  --num-images <n>            Number of images to generate (default: 1)
  --seed <n>                  Seed for reproducibility
  --image <path>              Input image (img2img / animate input / tileset / edit)
  --palette <path>            Reference palette image (input_palette)
  --strength <0..1>           img2img modification strength (default: 0.75)
  --remove-bg                 Transparent background
  --tile-x                    Seamless horizontal tiling
  --tile-y                    Seamless vertical tiling
  --bypass-prompt-expansion   Disable automatic prompt enhancement
  --check-cost                Estimate cost without generating
  --output <dir>              Output directory (default: public/assets/sprites)
  --slug <name>               Output filename slug

Environment:
  RETRODIFFUSION_API_KEY      API key from https://www.retrodiffusion.ai → Account → API`);
}

(async () => {
  if (mode === 'balance') {
    requireKey();
    await runBalance();
    return;
  }
  if (!mode || hasFlag('help')) { usage(); process.exit(mode ? 0 : 1); }
  requireKey();
  try {
    if (mode === 'generate') await runGenerate();
    else if (mode === 'img2img') await runImg2Img();
    else if (mode === 'animate') await runAnimate();
    else if (mode === 'tileset') await runTileset();
    else if (mode === 'edit') await runEdit();
    else { console.error(`Unknown mode: ${mode}`); usage(); process.exit(1); }
  } catch (err) {
    console.error(`✖ ${err.message}`);
    process.exit(1);
  }
})();
