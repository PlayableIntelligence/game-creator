#!/usr/bin/env node
// =============================================================================
// eval-game.mjs — Run game-eval's BH (Build Health) bench against any
// game-creator project and print a structured summary.
//
// Pipeline:
//   1. Resolve game-eval directory (env var GAME_EVAL_DIR → sibling
//      ../game-eval/ → error).
//   2. Build the target game: `npm install` (if node_modules missing),
//      `npm run build` (produces dist/).
//   3. Spawn `bun run <gameEval>/eval/src/harness/bench_bh.ts <dist>` with
//      a per-game-eval-runs/ output directory. Bench writes bh.json there.
//   4. Parse bh.json. Print a one-screen summary covering: score, validity,
//      named deductions, optional VU pixel-half score, and the run dir.
//
// Usage:
//   node scripts/eval-game.mjs                  (runs against CWD)
//   node scripts/eval-game.mjs <path>           (runs against given path)
//   node scripts/eval-game.mjs <path> --json    (machine-readable output)
//   node scripts/eval-game.mjs <path> --skip-build  (don't rebuild)
//
// Exit 0 = build succeeded and BH is valid (any score).
// Exit 1 = bench ran but reported invalid (game didn't render).
// Exit 2 = couldn't even run (build failed, game-eval missing, etc).
// =============================================================================

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GAME_CREATOR_ROOT = resolve(__dirname, '..');

// -----------------------------------------------------------------------------
// Args
// -----------------------------------------------------------------------------

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const gameDir = resolve(positional[0] || process.cwd());
const wantJson = args.includes('--json');
const skipBuild = args.includes('--skip-build');

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function out(msg) {
  if (!wantJson) console.log(msg);
}

function err(msg) {
  process.stderr.write(`[eval-game] ${msg}\n`);
}

async function run(cmd, cmdArgs, cwd, opts = {}) {
  return new Promise((resolveProc, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd,
      stdio: opts.captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    if (opts.captureOutput) {
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      resolveProc({ code: code ?? 0, stdout, stderr });
    });
  });
}

// -----------------------------------------------------------------------------
// Resolve game-eval
// -----------------------------------------------------------------------------

function findGameEval() {
  // 1. Env var
  if (process.env.GAME_EVAL_DIR) {
    const p = resolve(process.env.GAME_EVAL_DIR);
    if (existsSync(join(p, 'eval', 'src', 'harness', 'bench_bh.ts'))) return p;
    err(`GAME_EVAL_DIR=${p} does not contain eval/src/harness/bench_bh.ts`);
    return null;
  }
  // 2. Sibling of game-creator root
  const sibling = resolve(GAME_CREATOR_ROOT, '..', 'game-eval');
  if (existsSync(join(sibling, 'eval', 'src', 'harness', 'bench_bh.ts'))) return sibling;
  return null;
}

const gameEvalDir = findGameEval();
if (!gameEvalDir) {
  err('Could not find game-eval. Either:');
  err('  - Set GAME_EVAL_DIR to your local clone of OpusGameLabs/game-eval, or');
  err('  - Clone OpusGameLabs/game-eval as a sibling of this repo');
  process.exit(2);
}

out(`[eval-game] game-eval at: ${gameEvalDir}`);

// -----------------------------------------------------------------------------
// Validate target game directory
// -----------------------------------------------------------------------------

if (!existsSync(gameDir) || !statSync(gameDir).isDirectory()) {
  err(`target is not a directory: ${gameDir}`);
  process.exit(2);
}

const pkgPath = join(gameDir, 'package.json');
if (!existsSync(pkgPath)) {
  err(`no package.json at ${gameDir} — is this a game project?`);
  process.exit(2);
}

let pkg;
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
} catch (e) {
  err(`package.json is not valid JSON: ${e.message}`);
  process.exit(2);
}

out(`[eval-game] target: ${gameDir}`);
out(`[eval-game] package: ${pkg.name || '(no name)'} v${pkg.version || '?'}`);

// -----------------------------------------------------------------------------
// Build phase
// -----------------------------------------------------------------------------

if (!skipBuild) {
  if (!existsSync(join(gameDir, 'node_modules'))) {
    out(`[eval-game] installing deps…`);
    const inst = await run('npm', ['install', '--no-audit', '--no-fund'], gameDir);
    if (inst.code !== 0) {
      err(`npm install failed (exit ${inst.code})`);
      process.exit(2);
    }
  }

  if (!pkg.scripts?.build) {
    err(`package.json has no "build" script — cannot produce dist/`);
    process.exit(2);
  }

  // We pass --base=./ to vite so dist/ uses relative asset paths. Many
  // game-creator examples set `base: '/owner/repo/path/'` in vite.config.js
  // for GitHub Pages deployment; without this override, the bench would
  // 404 on every asset because bench_serve serves from root, not from the
  // GH Pages prefix. The override only affects this build's paths — the
  // user's deployed build is unaffected.
  out(`[eval-game] building (vite --base=./)…`);
  const build = await run('npm', ['run', 'build', '--', '--base=./'], gameDir);
  if (build.code !== 0) {
    err(`npm run build failed (exit ${build.code}) — see output above`);
    process.exit(2);
  }
}

const distDir = join(gameDir, 'dist');
if (!existsSync(distDir) || !existsSync(join(distDir, 'index.html'))) {
  err(`no dist/index.html found after build at ${distDir}`);
  err(`if you used --skip-build, ensure dist/ exists; otherwise check the build output`);
  process.exit(2);
}

// -----------------------------------------------------------------------------
// Run bench_bh.ts against dist/
// -----------------------------------------------------------------------------

const benchScript = join(gameEvalDir, 'eval', 'src', 'harness', 'bench_bh.ts');
const benchOutDir = join(gameDir, 'eval-output', `bh-${Date.now()}`);

out(`[eval-game] running BH bench against ${distDir}`);
out(`[eval-game] output → ${benchOutDir}`);

const bench = await run('bun', ['run', benchScript, distDir, '--out', benchOutDir], GAME_CREATOR_ROOT);
// bench_bh.ts exits 1 on any invalid result, which is the EXPECTED case for
// broken games. We ignore exit code here — the truth lives in bh.json.

const bhPath = join(benchOutDir, 'bh.json');
if (!existsSync(bhPath)) {
  err(`bench finished (exit ${bench.code}) but no bh.json at ${bhPath}`);
  err(`this typically means the bench itself crashed — check bench output above`);
  process.exit(2);
}

// -----------------------------------------------------------------------------
// Parse + summarize
// -----------------------------------------------------------------------------

const bh = JSON.parse(readFileSync(bhPath, 'utf-8'));

if (wantJson) {
  console.log(JSON.stringify(bh, null, 2));
  process.exit(bh.valid ? 0 : 1);
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Build Health: ${bh.score}/100   valid=${bh.valid}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (bh.deductions?.length > 0) {
  console.log('Deductions:');
  for (const d of bh.deductions) console.log(`  −${d.points}  ${d.reason}`);
} else {
  console.log('No deductions — clean run.');
}

if (bh.vu) {
  console.log('');
  console.log(`Visual Usability (pixel-half): ${bh.vu.score}/100`);
  console.log(`  entropy: ${bh.vu.subscores.entropy}/100  motion: ${bh.vu.subscores.motion}/100`);
}

console.log('');
console.log('Signals:');
const s = bh.signals;
console.log(`  loaded=${s.loaded} loadDuration=${s.loadDurationMs}ms canvas=${s.hasCanvas} frames=${s.nonBlankFrames}/${s.totalFrames}`);
console.log(`  consoleErrors=${s.consoleErrors} pageErrors=${s.uncaughtExceptions} failedRequests=${s.failedRequests}`);

if (bh.consoleEvents?.length > 0 || bh.pageErrors?.length > 0) {
  console.log('');
  console.log('First few errors (truncated to 5):');
  let n = 0;
  for (const e of bh.pageErrors || []) {
    if (n++ >= 5) break;
    console.log(`  [pageerror] ${e.split('\n')[0]}`);
  }
  for (const e of bh.consoleEvents || []) {
    if (e.type !== 'error') continue;
    if (n++ >= 5) break;
    console.log(`  [console.error] ${e.text.split('\n')[0]}`);
  }
}

console.log('');
console.log(`Full output: ${benchOutDir}`);

process.exit(bh.valid ? 0 : 1);
