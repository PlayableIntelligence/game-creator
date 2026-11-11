#!/usr/bin/env node
/**
 * UserPromptSubmit hook: intercepts API keys pasted in chat,
 * saves them to .env, and blocks the message so keys never
 * reach the context window.
 *
 * Exit codes:
 *   0 — pass through (no key detected)
 *   2 — block (key saved to .env)
 */

import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Key patterns ──────────────────────────────────────────────
const EXPLICIT_KEYS = [
  'ATLASCLOUD_API_KEY',
  'ATLAS_CLOUD_API_KEY',
  'MESHY_API_KEY',
  'WORLDLABS_API_KEY',
  'WLT_API_KEY',
  'SKETCHFAB_TOKEN',
  'POLY_PIZZA_API_KEY',
  'HERENOW_API_KEY',
];

const EXPLICIT_RE = new RegExp(
  `^(${EXPLICIT_KEYS.join('|')})\\s*[=:]\\s*(\\S+)`,
  'gm'
);

// Bare key prefix → env var name
const PREFIX_MAP = {
  msy_: 'MESHY_API_KEY',
  wlt_: 'WLT_API_KEY',
  sk_:  'SKETCHFAB_TOKEN',
};

// Placeholder values from skill prompt examples — never save these
const PLACEHOLDER_RE = /^(your|their|my)[-_]?key[-_]?here$|^<.*>$|^replace[-_]?me$|^xxx+$|^test[-_]?key$/i;

// Strip trailing punctuation from captured values (e.g. "abc123." → "abc123")
function cleanValue(val) {
  return val.replace(/[.,;:!?)]+$/, '');
}

// ── Helpers ───────────────────────────────────────────────────

function findProjectRoot(cwd) {
  let dir = resolve(cwd);
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(cwd);
}

function readEnv(envPath) {
  if (!existsSync(envPath)) return '';
  return readFileSync(envPath, 'utf8');
}

function upsertEnv(envPath, key, value) {
  let content = readEnv(envPath);
  const lineRe = new RegExp(`^${key}=.*$`, 'm');

  if (lineRe.test(content)) {
    content = content.replace(lineRe, `${key}=${value}`);
  } else {
    if (!content && !existsSync(envPath)) {
      content = '# API keys (managed by game-creator hook — do not commit)\n';
    }
    if (content.length > 0 && !content.endsWith('\n')) content += '\n';
    content += `${key}=${value}\n`;
  }

  writeFileSync(envPath, content, 'utf8');
  try { chmodSync(envPath, 0o600); } catch { /* best effort */ }
}

function ensureGitignore(root) {
  const giPath = join(root, '.gitignore');
  let content = '';
  if (existsSync(giPath)) {
    content = readFileSync(giPath, 'utf8');
    // Check if .env is already ignored
    if (/^\/?\.env$/m.test(content)) return;
  }
  if (content.length > 0 && !content.endsWith('\n')) content += '\n';
  content += '\n# API keys (managed by game-creator hook)\n.env\n.env.local\n';
  writeFileSync(giPath, content, 'utf8');
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  const { prompt, cwd } = JSON.parse(input);
  if (!prompt || !cwd) process.exit(0);

  const saved = [];
  const root = findProjectRoot(cwd);
  const envPath = join(root, '.env');

  // 1. Explicit format: KEY=value or KEY: value
  let match;
  EXPLICIT_RE.lastIndex = 0;
  while ((match = EXPLICIT_RE.exec(prompt)) !== null) {
    const [, key, rawValue] = match;
    const value = cleanValue(rawValue);
    if (!value || PLACEHOLDER_RE.test(value)) continue;
    try {
      upsertEnv(envPath, key, value);
      saved.push(key);
      process.stderr.write(`\u2713 Saved ${key} to ${envPath} (redacted from conversation)\n`);
    } catch (err) {
      process.stderr.write(`Warning: could not save ${key} to .env: ${err.message}\n`);
    }
  }

  // 2. Bare key heuristic (only if no explicit matches)
  if (saved.length === 0) {
    const trimmed = prompt.trim();

    // Must be single-line, no spaces, no URLs, 20+ chars
    if (
      !trimmed.includes('\n') &&
      !trimmed.includes(' ') &&
      !trimmed.includes('://') &&
      trimmed.length >= 20 &&
      /^[a-zA-Z0-9_\-]+$/.test(trimmed)
    ) {
      // Try to infer key name from prefix
      let keyName = null;
      const lower = trimmed.toLowerCase();
      for (const [prefix, envVar] of Object.entries(PREFIX_MAP)) {
        if (lower.startsWith(prefix)) {
          keyName = envVar;
          break;
        }
      }

      if (keyName) {
        try {
          upsertEnv(envPath, keyName, trimmed);
          saved.push(keyName);
          process.stderr.write(`\u2713 Saved ${keyName} to ${envPath} (redacted from conversation)\n`);
        } catch (err) {
          process.stderr.write(`Warning: could not save ${keyName} to .env: ${err.message}\n`);
        }
      }
      // Unknown prefix with 32+ chars — could be a key but we can't be sure which one.
      // Pass through rather than risk misidentifying.
    }
  }

  if (saved.length === 0) {
    process.exit(0); // No key detected — pass through
  }

  // Ensure .env is gitignored in the target project
  try { ensureGitignore(root); } catch { /* best effort */ }

  // Block the message and inject context
  const keyList = saved.join(', ');
  const result = {
    decision: 'block',
    reason: `API key${saved.length > 1 ? 's' : ''} saved to .env`,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: [
        `The user's ${keyList} ha${saved.length > 1 ? 've' : 's'} been securely saved to ${envPath}.`,
        `Load ${saved.length > 1 ? 'them' : 'it'} with: set -a; . ${envPath}; set +a`,
        'Do NOT ask the user to provide this key again.',
      ].join(' '),
    },
  };

  process.stdout.write(JSON.stringify(result));
  process.exit(2);
}

main().catch((err) => {
  process.stderr.write(`intercept-api-key error: ${err.message}\n`);
  process.exit(0); // Graceful degradation — pass through
});
