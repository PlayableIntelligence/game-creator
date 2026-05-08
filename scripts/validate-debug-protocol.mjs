#!/usr/bin/env node
// =============================================================================
// validate-debug-protocol.mjs — Cross-file consistency checks for browser games
//
// Adapted from leigest519/OpenGame's debug-skill validator (Apache-2.0).
// Original: https://github.com/leigest519/OpenGame/blob/main/agent-test/debug-skill/src/validator.ts
//
// Runs each proactive entry in debug-protocol.json against the project at CWD.
// Each check is no-op when the relevant project structure is absent (e.g.,
// no asset-pack.json → ASSET_KEY_CONSISTENCY skipped). Prints PASS/WARN/FAIL
// in the same style as validate-architecture.mjs.
//
// Usage:
//   node scripts/validate-debug-protocol.mjs           (runs in CWD)
//   node scripts/validate-debug-protocol.mjs <path>    (runs in given path)
//
// Exits 0 on no violations, 1 if any check fires.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_DIR = path.resolve(process.argv[2] || process.cwd());
const SRC_DIR = path.join(PROJECT_DIR, 'src');
const PROTOCOL_PATH = path.join(__dirname, 'debug-protocol.json');

let passed = 0;
let failed = 0;
let skipped = 0;

const log = {
  pass: (msg) => { console.log(`[PASS] ${msg}`); passed++; },
  fail: (msg) => { console.log(`[FAIL] ${msg}`); failed++; },
  skip: (msg) => { console.log(`[SKIP] ${msg}`); skipped++; },
  detail: (msg) => console.log(`       ${msg}`),
};

// -----------------------------------------------------------------------------
// File utilities
// -----------------------------------------------------------------------------

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function readFileOr(p, fallback = null) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return fallback; }
}

function collectJs(dir) {
  const out = [];
  if (!exists(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'tests', 'test-results'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJs(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Asset key extraction
// -----------------------------------------------------------------------------

function extractAssetKeysFromPack(pack) {
  const keys = new Set();
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.key === 'string') keys.add(node.key);
    Object.values(node).forEach(walk);
  }
  walk(pack);
  return keys;
}

const ASSET_USE_PATTERNS = [
  /\.(?:image|sprite|audio|sound)\(\s*(?:[^,)'"]+,\s*)?['"]([^'"]+)['"]/g,
  /\.setTexture\(\s*['"]([^'"]+)['"]/g,
  /\btextures\.exists\(\s*['"]([^'"]+)['"]/g,
  /\.load\.(?:image|audio|spritesheet|atlas)\(\s*['"]([^'"]+)['"]/g,
];

function extractAssetUsesFromCode(content) {
  const keys = new Set();
  for (const pat of ASSET_USE_PATTERNS) {
    for (const m of content.matchAll(pat)) {
      if (m[1]) keys.add(m[1]);
    }
  }
  return keys;
}

// -----------------------------------------------------------------------------
// Proactive checks
// -----------------------------------------------------------------------------

function checkAssetKeyConsistency() {
  const packPath = path.join(PROJECT_DIR, 'public', 'assets', 'asset-pack.json');
  if (!exists(packPath)) {
    log.skip('ASSET_KEY_CONSISTENCY (no public/assets/asset-pack.json)');
    return;
  }

  let pack;
  try {
    pack = JSON.parse(readFileOr(packPath, '{}'));
  } catch (e) {
    log.fail(`ASSET_KEY_CONSISTENCY: asset-pack.json is not valid JSON (${e.message})`);
    return;
  }

  const registered = extractAssetKeysFromPack(pack);
  const violations = [];

  for (const filePath of collectJs(SRC_DIR)) {
    const content = readFileOr(filePath, '');
    const used = extractAssetUsesFromCode(content);
    for (const key of used) {
      if (!registered.has(key)) {
        violations.push(`${path.relative(PROJECT_DIR, filePath)}: '${key}'`);
      }
    }
  }

  if (violations.length === 0) {
    log.pass('ASSET_KEY_CONSISTENCY');
  } else {
    log.fail(`ASSET_KEY_CONSISTENCY — ${violations.length} unregistered key(s)`);
    for (const v of violations) log.detail(v);
  }
}

function checkSceneRegistrationConsistency() {
  const allJs = collectJs(SRC_DIR);
  const registered = new Set();

  // Source of truth: any class extending Phaser.Scene declares its key via super('Key')
  // in its constructor. Walk every file that extends Phaser.Scene.
  for (const filePath of allJs) {
    const content = readFileOr(filePath, '');
    if (!/extends\s+Phaser\.Scene/.test(content)) continue;
    const superMatch = content.match(/super\(\s*['"]([^'"]+)['"]/);
    if (superMatch) registered.add(superMatch[1]);
  }

  // Also collect explicit string-key registrations:
  //   game.scene.add('Key', ...)            — runtime registration
  //   { key: 'Key', ... }                   — Phaser scene config object form
  const corpus = allJs.map(p => readFileOr(p, '')).join('\n');
  for (const m of corpus.matchAll(/scene\.add\(\s*['"]([^'"]+)['"]/g)) registered.add(m[1]);
  for (const m of corpus.matchAll(/key:\s*['"]([^'"]+)['"]/g)) registered.add(m[1]);

  if (registered.size === 0) {
    log.skip('SCENE_REGISTRATION_CONSISTENCY (no Phaser scenes detected)');
    return;
  }

  const violations = [];
  for (const filePath of allJs) {
    const content = readFileOr(filePath, '');
    for (const m of content.matchAll(/scene\.(?:start|launch)\(\s*['"]([^'"]+)['"]/g)) {
      const key = m[1];
      if (!registered.has(key)) {
        violations.push(`${path.relative(PROJECT_DIR, filePath)}: starts '${key}'`);
      }
    }
  }

  if (violations.length === 0) {
    log.pass(`SCENE_REGISTRATION_CONSISTENCY (${registered.size} registered: ${[...registered].join(', ')})`);
  } else {
    log.fail(`SCENE_REGISTRATION_CONSISTENCY — ${violations.length} unregistered scene start(s)`);
    for (const v of violations) log.detail(v);
    log.detail(`Registered keys: ${[...registered].join(', ') || '(none found)'}`);
  }
}

function checkAnimationKeyConsistency() {
  const animPath = path.join(PROJECT_DIR, 'public', 'assets', 'animations.json');
  const definedKeys = new Set();

  if (exists(animPath)) {
    try {
      const data = JSON.parse(readFileOr(animPath, '{}'));
      if (Array.isArray(data?.anims)) {
        for (const a of data.anims) if (typeof a.key === 'string') definedKeys.add(a.key);
      }
    } catch (e) {
      log.fail(`ANIMATION_KEY_CONSISTENCY: animations.json is not valid JSON (${e.message})`);
      return;
    }
  }

  // Also collect anims.create() calls
  for (const filePath of collectJs(SRC_DIR)) {
    const content = readFileOr(filePath, '');
    for (const m of content.matchAll(/anims\.create\(\s*\{[^}]*key:\s*['"]([^'"]+)['"]/g)) {
      definedKeys.add(m[1]);
    }
  }

  if (definedKeys.size === 0) {
    log.skip('ANIMATION_KEY_CONSISTENCY (no animations.json and no anims.create() calls found)');
    return;
  }

  const violations = [];
  for (const filePath of collectJs(SRC_DIR)) {
    const content = readFileOr(filePath, '');
    for (const m of content.matchAll(/\.play\(\s*['"]([^'"]+)['"]/g)) {
      const key = m[1];
      if (!definedKeys.has(key)) {
        violations.push(`${path.relative(PROJECT_DIR, filePath)}: plays '${key}'`);
      }
    }
  }

  if (violations.length === 0) {
    log.pass(`ANIMATION_KEY_CONSISTENCY (${definedKeys.size} defined)`);
  } else {
    log.fail(`ANIMATION_KEY_CONSISTENCY — ${violations.length} undefined animation key(s)`);
    for (const v of violations) log.detail(v);
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

console.log(`=== Debug Protocol Validation ===`);
console.log(`Project: ${PROJECT_DIR}\n`);

if (!exists(SRC_DIR)) {
  console.error(`error: src/ not found at ${PROJECT_DIR}`);
  process.exit(2);
}

const protocol = JSON.parse(readFileOr(PROTOCOL_PATH, '{}'));
console.log(`Loaded protocol v${protocol.version} (${protocol.entries?.length || 0} entries)\n`);

checkAssetKeyConsistency();
checkSceneRegistrationConsistency();
checkAnimationKeyConsistency();

console.log(`\n=== Summary ===`);
console.log(`Passed: ${passed}  Failed: ${failed}  Skipped: ${skipped}`);

process.exit(failed > 0 ? 1 : 0);
