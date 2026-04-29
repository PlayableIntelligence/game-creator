#!/usr/bin/env node
/**
 * plus-auth.mjs — OpenGameProtocol Plus credentials CLI.
 *
 * Manages your `~/.gcplus/token` file and walks you through signup +
 * Stripe-backed credit topups. Lets the rest of the toolchain (plus-
 * generate-world, worldlabs-generate, meshy-generate) automatically route
 * through the Plus proxy when a token is present.
 *
 * Subcommands:
 *   signup       --email <addr>           sign up, save token, print balance
 *   whoami                                 show stored token + balance
 *   balance                                print balance (alias for whoami)
 *   topup        --amount 5|20|50|100      get a Stripe Checkout URL
 *   rotate-token                           rotate the bearer token
 *   logout                                 delete ~/.gcplus/token
 *
 * Environment:
 *   GCPLUS_PROXY      override proxy URL (default https://plus.gamecreator.dev)
 *   GCPLUS_TOKEN      override stored token for one-off commands
 *
 * Token storage: ~/.gcplus/token (chmod 600). Read on every command.
 */

import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const DEFAULT_PROXY = 'https://plus.gamecreator.dev';
const TOKEN_DIR     = join(homedir(), '.gcplus');
const TOKEN_PATH    = join(TOKEN_DIR, 'token');

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const cmd  = args[0];

function getArg(name, fallback = null) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

const proxyOverride = getArg('proxy');
const PROXY = proxyOverride || process.env.GCPLUS_PROXY || DEFAULT_PROXY;

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function readToken() {
  if (process.env.GCPLUS_TOKEN) return process.env.GCPLUS_TOKEN;
  if (!existsSync(TOKEN_PATH)) return null;
  return readFileSync(TOKEN_PATH, 'utf8').trim();
}

function writeToken(token) {
  mkdirSync(TOKEN_DIR, { recursive: true });
  writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  try { chmodSync(TOKEN_PATH, 0o600); } catch {}
}

function requireToken() {
  const t = readToken();
  if (!t) {
    console.error('No token. Run: node scripts/plus-auth.mjs signup --email <you@example.com>');
    process.exit(1);
  }
  return t;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function api(method, path, body, token) {
  const url = `${PROXY}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!res.ok) {
    const msg = parsed?.error || parsed?.message || `HTTP ${res.status}`;
    const detail = parsed && typeof parsed === 'object'
      ? Object.entries(parsed).filter(([k]) => k !== 'error' && k !== 'message').map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
      : '';
    throw new Error(`${method} ${path} → ${msg}${detail ? '  ' + detail : ''}`);
  }
  return parsed;
}

function openInBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === 'darwin') execSync(`open '${url.replace(/'/g, '%27')}'`);
    else if (platform === 'win32') execSync(`start "" "${url}"`);
    else execSync(`xdg-open '${url.replace(/'/g, '%27')}'`);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function cmdSignup() {
  const email = getArg('email');
  if (!email) {
    console.error('Usage: plus-auth.mjs signup --email <you@example.com>');
    process.exit(1);
  }
  console.log(`[plus-auth] signing up at ${PROXY} …`);
  const res = await api('POST', '/v1/signup', { email });
  writeToken(res.token);
  console.log('');
  console.log(`✓  account ready  user_id=${res.user_id}  balance=${res.balance_credits} cr`);
  console.log(`✓  token saved to ${TOKEN_PATH}`);
  console.log('');
  if (res.first_topup_url) {
    console.log(`Add credits — open this in your browser:\n  ${res.first_topup_url}`);
  } else {
    console.log('Add credits with:');
    console.log('  node scripts/plus-auth.mjs topup --amount 20');
  }
}

async function cmdWhoami() {
  const token = requireToken();
  const res = await api('GET', '/v1/balance', null, token);
  const tokenPreview = token.slice(0, 16) + '…';
  console.log(`token       ${tokenPreview}`);
  console.log(`balance     ${res.balance_credits} cr  ($${res.balance_usd?.toFixed?.(2) ?? '?'})`);
  if (res.recent_jobs?.length) {
    console.log('');
    console.log('recent jobs');
    for (const j of res.recent_jobs.slice(0, 8)) {
      const sign = j.credits >= 0 ? '+' : '';
      const at = new Date(j.at).toLocaleString();
      console.log(`  ${at}  ${sign}${j.credits} cr  ${j.kind}  ${j.id ?? ''}`);
    }
  }
}

async function cmdTopup() {
  const amountUsd = Number(getArg('amount'));
  if (![5, 20, 50, 100].includes(amountUsd)) {
    console.error('Usage: plus-auth.mjs topup --amount 5|20|50|100');
    process.exit(1);
  }
  const token = requireToken();
  const res = await api('POST', '/v1/topup', { amount_usd: amountUsd, return_to: 'cli' }, token);
  console.log('');
  console.log(`Stripe Checkout for $${amountUsd} → ${res.credits_on_success} credits`);
  console.log('');
  console.log(`Open this in your browser:`);
  console.log(`  ${res.checkout_url}`);
  console.log('');
  console.log(`(expires ${res.expires_at})`);
  console.log('');
  if (!process.argv.includes('--no-open') && openInBrowser(res.checkout_url)) {
    console.log('✓  opened in your default browser');
  }
  console.log('');
  console.log('After paying, check balance:  node scripts/plus-auth.mjs balance');
}

async function cmdRotate() {
  const token = requireToken();
  const res = await api('POST', '/v1/rotate-token', null, token);
  writeToken(res.token);
  console.log('✓  new token saved to', TOKEN_PATH);
  console.log('   old token invalidated immediately');
}

/**
 * DEV ONLY: grant credits to an account without going through Stripe.
 * Requires the backend's ADMIN_TOKEN env var. Production deploys leave that
 * empty so the endpoint hard-locks to 503.
 */
async function cmdDevGrant() {
  const credits = Number(getArg('credits', '10000'));   // default 10k cr ≈ $100
  const email = getArg('email');
  const adminToken = getArg('admin-token') || process.env.ADMIN_TOKEN;
  if (!email) {
    console.error('Need --email <addr> (the email used at signup).');
    process.exit(1);
  }
  if (!adminToken) {
    console.error('Need --admin-token <token>  or  ADMIN_TOKEN env var.');
    console.error('(Operator-only: get this from the backend deployment env.)');
    process.exit(1);
  }
  const url = `${PROXY}/v1/admin/grant`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ email, credits, reason: 'admin:dev-grant' }),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!res.ok) {
    console.error(`grant failed: ${parsed?.error || parsed?.message || res.status}`);
    if (parsed) console.error(JSON.stringify(parsed, null, 2));
    process.exit(1);
  }
  console.log('');
  console.log(`✓  granted ${parsed.granted_cr} cr to ${parsed.email}`);
  console.log(`✓  new balance: ${parsed.balance_after} cr  ($${(parsed.balance_after / 100).toFixed(2)})`);
}

function cmdLogout() {
  if (existsSync(TOKEN_PATH)) {
    unlinkSync(TOKEN_PATH);
    console.log(`✓  removed ${TOKEN_PATH}`);
  } else {
    console.log(`(no token at ${TOKEN_PATH})`);
  }
}

function printHelp() {
  console.log(`
plus-auth.mjs — OpenGameProtocol Plus credentials CLI

Usage:
  node scripts/plus-auth.mjs <command> [...flags]

Commands:
  signup --email <addr>            sign up + save token
  whoami                            show token + balance
  balance                           alias for whoami
  topup --amount 5|20|50|100        get Stripe Checkout URL
  dev-grant --email <addr>          [DEV] grant credits without Stripe
            --credits <N>             default 10000 = $100
            --admin-token <t>         or read from ADMIN_TOKEN env var
  rotate-token                      rotate the bearer token
  logout                            delete ~/.gcplus/token

Flags:
  --proxy <url>     override GCPLUS_PROXY (default ${DEFAULT_PROXY})
  --no-open         don't auto-open Stripe URL in browser

Environment:
  GCPLUS_PROXY      override proxy URL
  GCPLUS_TOKEN      override stored token for one-off commands

Token: ~/.gcplus/token (chmod 600)
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  switch (cmd) {
    case 'signup':       return cmdSignup();
    case 'whoami':
    case 'balance':      return cmdWhoami();
    case 'topup':        return cmdTopup();
    case 'rotate-token': return cmdRotate();
    case 'logout':       return cmdLogout();
    case 'dev-grant':    return cmdDevGrant();
    case 'help':
    case '--help':
    case '-h':
    case undefined:      return printHelp();
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
