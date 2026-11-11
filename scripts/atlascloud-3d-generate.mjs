#!/usr/bin/env node
/**
 * Generate GLB game assets through Atlas Cloud's Hunyuan3D Rapid models.
 *
 * Generation POSTs are issued exactly once. Result polling uses bounded
 * backoff and can be skipped with --no-poll.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_API_BASE = 'https://api.atlascloud.ai';
const TEXT_MODEL = 'tencent/hunyuan3d-rapid/text-to-3d';
const IMAGE_MODEL = 'tencent/hunyuan3d-rapid/image-to-3d';
const GENERATE_PATH = '/api/v1/model/generateImage';
const RESULT_PATH = '/api/v1/model/result';
const DEFAULT_MAX_POLLS = 120;
const MAX_ALLOWED_POLLS = 360;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const MAX_POLL_INTERVAL_MS = 15000;
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;

function unwrapResponse(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

class AtlasHttpError extends Error {
  constructor(status, message) {
    super(`Atlas Cloud request failed (${status}): ${message}`);
    this.status = status;
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Atlas Cloud returned non-JSON response (${response.status})`);
  }
  if (!response.ok) {
    const message = payload?.message || payload?.error || text || response.statusText;
    throw new AtlasHttpError(response.status, message);
  }
  return unwrapResponse(payload);
}

export async function submitPrediction({ apiBase, apiKey, input, fetchImpl = fetch }) {
  const response = await fetchImpl(`${apiBase}${GENERATE_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const prediction = await readJsonResponse(response);
  if (!prediction?.id) throw new Error('Atlas Cloud response did not include a prediction ID');
  return prediction;
}

export async function getPrediction({ apiBase, apiKey, id, fetchImpl = fetch }) {
  const response = await fetchImpl(`${apiBase}${RESULT_PATH}/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return readJsonResponse(response);
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

export async function pollPrediction({
  apiBase,
  apiKey,
  id,
  fetchImpl = fetch,
  sleepImpl = sleep,
  maxPolls = DEFAULT_MAX_POLLS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}) {
  let lastError;
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(
        Math.round(pollIntervalMs * 1.35 ** (attempt - 1)),
        MAX_POLL_INTERVAL_MS,
      );
      await sleepImpl(delay);
    }

    let prediction;
    try {
      prediction = await getPrediction({ apiBase, apiKey, id, fetchImpl });
      lastError = undefined;
    } catch (error) {
      if (error instanceof AtlasHttpError && error.status < 500 && ![408, 429].includes(error.status)) {
        throw error;
      }
      lastError = error;
      continue;
    }

    const status = String(prediction?.status || '').toLowerCase();
    if (status === 'completed' || status === 'succeeded') return prediction;
    if (['failed', 'canceled', 'cancelled'].includes(status)) {
      throw new Error(prediction?.error || `Atlas Cloud prediction ${status}`);
    }
  }
  throw new Error(
    `Atlas Cloud prediction did not complete after ${maxPolls} polls${
      lastError ? `: ${lastError.message}` : ''
    }`,
  );
}

export function selectGlbUrl(prediction) {
  const files = Array.isArray(prediction?.files) ? prediction.files : [];
  const glb = files.find((file) => {
    const type = String(file?.type || '').toUpperCase();
    const contentType = String(file?.content_type || '').toLowerCase();
    return type === 'GLB' || contentType === 'model/gltf-binary';
  });
  if (glb?.url) return glb.url;

  const outputs = Array.isArray(prediction?.outputs) ? prediction.outputs : [];
  return outputs.find((url) => typeof url === 'string' && /\.glb(?:$|\?)/i.test(url)) || null;
}

function parseArgs(argv) {
  const getArg = (name, fallback = null) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 || index + 1 >= argv.length ? fallback : argv[index + 1];
  };
  const hasFlag = (name) => argv.includes(`--${name}`);
  return {
    mode: getArg('mode'),
    prompt: getArg('prompt'),
    image: getArg('image'),
    output: getArg('output', 'public/assets/models'),
    slug: getArg('slug'),
    taskId: getArg('task-id'),
    pbr: hasFlag('pbr'),
    geometry: hasFlag('geometry'),
    noPoll: hasFlag('no-poll'),
    noOptimize: hasFlag('no-optimize'),
    dryRun: hasFlag('dry-run'),
    maxPolls: Number.parseInt(getArg('max-polls', String(DEFAULT_MAX_POLLS)), 10),
  };
}

function usage() {
  console.error(`Usage:
  ATLASCLOUD_API_KEY=<key> node scripts/atlascloud-3d-generate.mjs \\
    --mode text-to-3d --prompt "a low-poly treasure chest" --slug treasure-chest [--pbr]

  ATLASCLOUD_API_KEY=<key> node scripts/atlascloud-3d-generate.mjs \\
    --mode image-to-3d --image <url-or-file> --slug character [--pbr]

  ATLASCLOUD_API_KEY=<key> node scripts/atlascloud-3d-generate.mjs \\
    --mode status --task-id <prediction-id>

Options:
  --output <dir>       Output directory (default: public/assets/models)
  --no-poll           Submit once and print the prediction ID
  --max-polls <n>     Maximum GET result polls (default: ${DEFAULT_MAX_POLLS})
  --no-optimize       Skip optimize-glb.mjs after download
  --dry-run           Print the request body without network access or API key
`);
}

function imageInput(value) {
  if (!value) throw new Error('--image is required for image-to-3d mode');
  if (/^(https?:|data:)/i.test(value)) return value;

  const path = resolve(value);
  if (!existsSync(path)) throw new Error(`Image file not found: ${path}`);
  if (statSync(path).size > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 4.5 MB model limit');
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
  if (options.mode === 'text-to-3d') {
    if (!options.prompt) throw new Error('--prompt is required for text-to-3d mode');
    if (Array.from(options.prompt).length > 1024) {
      throw new Error('Prompt exceeds the 1024-character model limit');
    }
    return {
      model: TEXT_MODEL,
      prompt: options.prompt,
      enable_pbr: options.pbr,
      enable_geometry: options.geometry,
      format: 'GLB',
    };
  }
  if (options.mode === 'image-to-3d') {
    return {
      model: IMAGE_MODEL,
      image: imageInput(options.image),
      enable_pbr: options.pbr,
      enable_geometry: options.geometry,
      format: 'GLB',
    };
  }
  throw new Error(`Unknown mode: ${options.mode || '(missing)'}`);
}

async function download(url, destination, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Model download failed (${response.status})`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

function optimizeGlb(path) {
  const optimizer = resolve('scripts/optimize-glb.mjs');
  if (!existsSync(optimizer)) return;
  execFileSync(process.execPath, [optimizer, path], { stdio: 'inherit' });
}

function writeMetadata(path, options, prediction, modelPath) {
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        slug: options.slug,
        source: 'atlas-cloud',
        mode: options.mode,
        model: prediction.model,
        predictionId: prediction.id,
        prompt: options.prompt || undefined,
        image: options.image ? (options.image.startsWith('data:') ? '(base64)' : options.image) : undefined,
        pbr: options.pbr,
        geometry: options.geometry,
        thumbnail: prediction.thumbnail || null,
        creditsConsumed: prediction.credits_consumed ?? null,
        modelPath: basename(modelPath),
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const apiBase = (process.env.ATLASCLOUD_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '');
  const apiKey = process.env.ATLASCLOUD_API_KEY || process.env.ATLAS_CLOUD_API_KEY;

  if (options.mode === 'status') {
    if (!options.taskId) throw new Error('--task-id is required for status mode');
    if (!apiKey) throw new Error('ATLASCLOUD_API_KEY environment variable is required');
    console.log(JSON.stringify(await getPrediction({ apiBase, apiKey, id: options.taskId }), null, 2));
    return;
  }

  const input = buildInput(options);
  if (options.dryRun) {
    console.log(JSON.stringify(input, null, 2));
    return;
  }
  if (!apiKey) throw new Error('ATLASCLOUD_API_KEY environment variable is required');
  if (!Number.isInteger(options.maxPolls) || options.maxPolls < 1 || options.maxPolls > MAX_ALLOWED_POLLS) {
    throw new Error(`--max-polls must be an integer from 1 to ${MAX_ALLOWED_POLLS}`);
  }

  const submitted = await submitPrediction({ apiBase, apiKey, input });
  console.log(`Atlas Cloud prediction: ${submitted.id}`);
  if (options.noPoll) return;

  const prediction = await pollPrediction({
    apiBase,
    apiKey,
    id: submitted.id,
    maxPolls: options.maxPolls,
  });
  const modelUrl = selectGlbUrl(prediction);
  if (!modelUrl) throw new Error('Completed prediction did not include a GLB output');

  const outputDir = resolve(options.output);
  mkdirSync(outputDir, { recursive: true });
  const slug = options.slug || (options.mode === 'text-to-3d' ? 'atlas-text-model' : 'atlas-image-model');
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) {
    throw new Error('--slug may contain only letters, numbers, hyphens, and underscores');
  }
  options.slug = slug;
  const modelPath = join(outputDir, `${slug}.glb`);
  await download(modelUrl, modelPath);
  if (!options.noOptimize) optimizeGlb(modelPath);
  writeMetadata(join(outputDir, `${slug}.meta.json`), options, prediction, modelPath);
  console.log(`Model saved: ${modelPath}`);
}

const isDirectRun = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun) {
  run().catch((error) => {
    console.error(`Error: ${error.message}`);
    usage();
    process.exitCode = 1;
  });
}
