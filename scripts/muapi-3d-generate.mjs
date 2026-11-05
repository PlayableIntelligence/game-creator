#!/usr/bin/env node
/**
 * Generate game-ready GLB assets through MuAPI's image/text-to-3D models.
 *
 * This is an opt-in provider route. It uses the current MuAPI model endpoint,
 * submits exactly one generation request, polls only result GETs, and never
 * sends the API key to the returned asset URL.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, extname, join, resolve } from 'node:path';

const API_BASE = 'https://api.muapi.ai';
const MODELS = {
  'text-to-3d': {
    name: 'meshy-6-text-to-3d',
    endpoint: '/api/v1/meshy-6-text-to-3d',
  },
  'image-to-3d': {
    name: 'meshy-6-image-to-3d',
    endpoint: '/api/v1/meshy-6-image-to-3d',
  },
};
const POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLLS = 60;
const MAX_ALLOWED_POLLS = 120;
const MAX_PROMPT_LENGTH = 600;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function getArg(argv, name, fallback = null) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 || index + 1 >= argv.length ? fallback : argv[index + 1];
}

function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}

function requireMode(mode) {
  if (!MODELS[mode]) {
    throw new Error(`--mode must be one of: ${Object.keys(MODELS).join(', ')}`);
  }
  return MODELS[mode];
}

function requireSlug(slug) {
  if (!slug || !/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) {
    throw new Error('--slug is required and may contain only letters, numbers, hyphens, and underscores');
  }
  return slug;
}

function imageInput(value) {
  if (!value) throw new Error('--image is required for image-to-3d mode');
  if (/^https:\/\//i.test(value) || /^data:/i.test(value)) return value;
  if (/^http:\/\//i.test(value)) throw new Error('--image must use HTTPS');

  const path = resolve(value);
  if (!existsSync(path)) throw new Error(`Image file not found: ${path}`);
  if (!statSync(path).isFile()) throw new Error('--image must point to a regular file');
  if (statSync(path).size > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds the ${MAX_IMAGE_BYTES / (1024 * 1024)} MB limit`);
  }

  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const mime = mimeTypes[extname(path).toLowerCase()];
  if (!mime) throw new Error('Image must be JPG, JPEG, PNG, or WEBP');
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

export function buildInput(options) {
  requireMode(options.mode);
  const input = {
    topology: options.topology || 'triangle',
    target_polycount: options.polycount ?? 30000,
    should_remesh: options.remesh !== false,
    symmetry_mode: options.symmetry || 'auto',
    enable_pbr: Boolean(options.pbr),
  };

  if (!Number.isInteger(input.target_polycount) || input.target_polycount < 100 || input.target_polycount > 300000) {
    throw new Error('--polycount must be an integer from 100 to 300000');
  }
  if (!['triangle', 'quad'].includes(input.topology)) {
    throw new Error('--topology must be triangle or quad');
  }
  if (!['off', 'auto', 'on'].includes(input.symmetry_mode)) {
    throw new Error('--symmetry must be off, auto, or on');
  }

  if (options.mode === 'text-to-3d') {
    if (!options.prompt || !options.prompt.trim()) throw new Error('--prompt is required for text-to-3d mode');
    if (Array.from(options.prompt).length > MAX_PROMPT_LENGTH) {
      throw new Error(`--prompt must be at most ${MAX_PROMPT_LENGTH} characters`);
    }
    return {
      ...input,
      prompt: options.prompt,
      mode: options.preview ? 'preview' : 'full',
      enable_prompt_expansion: Boolean(options.expandPrompt),
    };
  }

  return {
    ...input,
    image_url: imageInput(options.image),
    should_texture: options.texture !== false,
    ...(options.pose ? { pose_mode: options.pose } : {}),
    ...(options.texturePrompt ? { texture_prompt: options.texturePrompt } : {}),
  };
}

function jsonResponseBody(response) {
  return response.json().catch(() => ({}));
}

function requestId(body) {
  return body?.request_id || body?.data?.request_id || body?.id || body?.data?.id || body?.output?.id || null;
}

async function apiRequest({ method, url, apiKey, body, fetchImpl = fetch }) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'x-api-key': apiKey,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await jsonResponseBody(response);
  if (!response.ok) {
    const detail = payload?.error || payload?.message || `HTTP ${response.status}`;
    const error = new Error(`${method} ${url} failed: ${detail}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function submitPrediction({ apiBase = API_BASE, apiKey, endpoint, input, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('MUAPI_API_KEY environment variable is required');
  const response = await apiRequest({
    method: 'POST',
    url: `${apiBase}${endpoint}`,
    apiKey,
    body: input,
    fetchImpl,
  });
  const id = requestId(response);
  if (!id) throw new Error('MuAPI submission did not return a request ID');
  return { ...response, request_id: id };
}

export async function pollPrediction({
  apiBase = API_BASE,
  apiKey,
  id,
  maxPolls = DEFAULT_MAX_POLLS,
  pollIntervalMs = POLL_INTERVAL_MS,
  sleepImpl = (delay) => new Promise((resolveSleep) => setTimeout(resolveSleep, delay)),
  fetchImpl = fetch,
}) {
  if (!Number.isInteger(maxPolls) || maxPolls < 1 || maxPolls > MAX_ALLOWED_POLLS) {
    throw new Error(`--max-polls must be an integer from 1 to ${MAX_ALLOWED_POLLS}`);
  }
  let lastError = null;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    try {
      const result = await apiRequest({
        method: 'GET',
        url: `${apiBase}/api/v1/predictions/${encodeURIComponent(id)}/result`,
        apiKey,
        fetchImpl,
      });
      const status = String(result?.status || result?.data?.status || result?.output?.status || '').toLowerCase();
      if (['completed', 'succeeded', 'success'].includes(status) || selectModelUrl(result)) return result;
      if (['failed', 'error', 'canceled', 'cancelled', 'timeout'].includes(status)) {
        throw new Error(result?.error || result?.data?.error || `MuAPI prediction ${status}`);
      }
    } catch (error) {
      lastError = error;
      const retryable = error.status === 408 || error.status === 429 || error.status >= 500;
      if (!retryable) throw error;
    }
    if (attempt + 1 < maxPolls) await sleepImpl(pollIntervalMs);
  }
  throw new Error(`MuAPI prediction did not complete after ${maxPolls} polls${lastError ? `: ${lastError.message}` : ''}`);
}

function collectUrls(value, urls = []) {
  if (typeof value === 'string' && /^https:\/\//i.test(value) && /\.glb(?:$|\?)/i.test(value)) urls.push(value);
  if (Array.isArray(value)) value.forEach((item) => collectUrls(item, urls));
  if (value && typeof value === 'object') Object.values(value).forEach((item) => collectUrls(item, urls));
  return urls;
}

export function selectModelUrl(result) {
  return collectUrls(result)[0] || null;
}

async function downloadModel(url, destination, fetchImpl = fetch) {
  if (!/^https:\/\//i.test(url)) throw new Error('Refusing to download a non-HTTPS model URL');
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

function usage() {
  console.error(`Usage:
  MUAPI_API_KEY=<key> node scripts/muapi-3d-generate.mjs \
    --mode text-to-3d --prompt "a stylized low-poly treasure chest" --slug treasure-chest

  MUAPI_API_KEY=<key> node scripts/muapi-3d-generate.mjs \
    --mode image-to-3d --image concept-art.png --slug concept-model

Options:
  --output <dir>          Output directory (default: public/assets/models)
  --topology <type>       triangle or quad (default: triangle)
  --polycount <n>         Target polygon count (100-300000, default: 30000)
  --pbr                   Request PBR maps
  --preview               Use the faster text-to-3D preview mode
  --texture-prompt <t>    Optional image-to-3D texturing guidance
  --no-poll               Submit once and print the request ID
  --max-polls <n>         Bounded GET polls (default: ${DEFAULT_MAX_POLLS})
  --dry-run               Print the request body without a key or network call`);
}

export async function run(argv = process.argv.slice(2), deps = {}) {
  const options = {
    mode: getArg(argv, 'mode'),
    prompt: getArg(argv, 'prompt'),
    image: getArg(argv, 'image'),
    output: getArg(argv, 'output', 'public/assets/models'),
    slug: getArg(argv, 'slug'),
    topology: getArg(argv, 'topology', 'triangle'),
    polycount: Number.parseInt(getArg(argv, 'polycount', '30000'), 10),
    symmetry: getArg(argv, 'symmetry', 'auto'),
    pose: getArg(argv, 'pose'),
    texturePrompt: getArg(argv, 'texture-prompt'),
    pbr: hasFlag(argv, 'pbr'),
    preview: hasFlag(argv, 'preview'),
    expandPrompt: hasFlag(argv, 'expand-prompt'),
    remesh: !hasFlag(argv, 'no-remesh'),
    texture: !hasFlag(argv, 'no-texture'),
  };
  const model = requireMode(options.mode);
  const input = buildInput(options);
  if (hasFlag(argv, 'dry-run')) {
    console.log(JSON.stringify({ model: model.name, endpoint: model.endpoint, input }, null, 2));
    return { model, input };
  }
  const slug = requireSlug(options.slug);
  const apiKey = process.env.MUAPI_API_KEY;
  const submitted = await submitPrediction({
    apiBase: deps.apiBase || API_BASE,
    apiKey,
    endpoint: model.endpoint,
    input,
    fetchImpl: deps.fetchImpl,
  });
  console.log(`MuAPI request: ${submitted.request_id}`);
  if (hasFlag(argv, 'no-poll')) return submitted;

  const result = await pollPrediction({
    apiBase: deps.apiBase || API_BASE,
    apiKey,
    id: submitted.request_id,
    maxPolls: Number.parseInt(getArg(argv, 'max-polls', String(DEFAULT_MAX_POLLS)), 10),
    sleepImpl: deps.sleepImpl,
    fetchImpl: deps.fetchImpl,
  });
  const modelUrl = selectModelUrl(result);
  if (!modelUrl) throw new Error('Completed MuAPI prediction did not include a GLB output');

  const outputDir = resolve(options.output);
  mkdirSync(outputDir, { recursive: true });
  const modelPath = join(outputDir, `${slug}.glb`);
  await downloadModel(modelUrl, modelPath, deps.fetchImpl);
  if (!hasFlag(argv, 'no-optimize')) {
    const optimizer = resolve('scripts/optimize-glb.mjs');
    if (existsSync(optimizer)) {
      if (deps.optimizeImpl) {
        await deps.optimizeImpl(modelPath);
      } else {
        try {
          execFileSync(process.execPath, [optimizer, modelPath], { stdio: 'inherit', timeout: 120_000 });
        } catch {
          console.warn('GLB optimization failed; keeping the downloaded model');
        }
      }
    }
  }
  writeFileSync(
    join(outputDir, `${slug}.meta.json`),
    `${JSON.stringify({
      slug,
      source: 'muapi',
      model: model.name,
      mode: options.mode,
      requestId: submitted.request_id,
      prompt: options.prompt || undefined,
      image: options.image && !options.image.startsWith('data:') ? options.image : undefined,
      modelPath: basename(modelPath),
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
  console.log(`Model saved: ${modelPath}`);
  return { ...result, request_id: submitted.request_id, modelPath };
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isDirectRun) {
  run().catch((error) => {
    console.error(`Error: ${error.message}`);
    usage();
    process.exitCode = 1;
  });
}
