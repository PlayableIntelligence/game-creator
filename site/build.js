#!/usr/bin/env node

/**
 * Unified site build script.
 *
 * Generates the entire _site/ from site/manifest.json:
 *   - _site/index.html         — Landing page (hero, install, pipeline, features, games, stack, CTA)
 *   - _site/gallery/index.html — Template gallery (filters, search, thumbnails, telemetry)
 *   - _site/gallery/thumbnails/ — Copied from site/thumbnails/
 *
 * Usage:
 *   node site/build.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(__dirname, 'manifest.json');
const SITE_DIR = path.join(ROOT, '_site');
const GALLERY_DIR = path.join(SITE_DIR, 'gallery');
const THUMBS_SRC = path.join(__dirname, 'thumbnails');
const THUMBS_DST = path.join(GALLERY_DIR, 'thumbnails');
const BENCHMARKS_FILE = path.join(__dirname, 'benchmarks.json');
const TELEMETRY_URL = process.env.TELEMETRY_URL || 'https://gallery-telemetry.up.railway.app';

async function fetchStats() {
  try {
    const res = await fetch(`${TELEMETRY_URL}/stats`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`  Warning: Could not fetch telemetry stats (${err.message}). Using zero counts.`);
    return { templates: {}, totalClones: 0 };
  }
}

function loadBenchmarks() {
  try {
    if (fs.existsSync(BENCHMARKS_FILE)) {
      const data = JSON.parse(fs.readFileSync(BENCHMARKS_FILE, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// Shared CSS
// ---------------------------------------------------------------------------

function sharedCSS() {
  return `
    :root {
      --bg: #06080f;
      --bg-raised: #0d1117;
      --border: #1e293b;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --red: #ff4444;
      --red-soft: #ff6b6b;
      --red-glow: rgba(255,68,68,0.15);
      --coral: #ff7b72;
      --orange: #fb923c;
      --green: #4ade80;
      --blue: #60a5fa;
      --yellow: #fbbf24;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    /* NAV */
    nav {
      position: fixed; top: 0; left: 0; right: 0; z-index: 50;
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 32px;
      background: rgba(6,8,15,0.85);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(30,41,59,0.5);
    }
    .nav-logo {
      font-weight: 800; font-size: 18px; color: #fff;
      text-decoration: none; letter-spacing: -0.5px;
    }
    .nav-logo span { color: var(--red); }
    .nav-links { display: flex; gap: 28px; }
    .nav-links a {
      color: var(--text-muted); text-decoration: none; font-size: 14px; font-weight: 500;
      transition: color 0.2s;
    }
    .nav-links a:hover, .nav-links a.active { color: #fff; }
    .nav-right { display: flex; gap: 10px; align-items: center; }
    .nav-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 16px; border-radius: 8px;
      border: 1px solid var(--border);
      color: var(--text); text-decoration: none; font-size: 13px; font-weight: 600;
      transition: all 0.2s;
    }
    .nav-btn:hover { border-color: var(--red); color: #fff; }
    .nav-btn svg { width: 18px; height: 18px; fill: currentColor; }

    /* BUTTONS */
    .btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 14px 28px; border-radius: 10px;
      font-size: 15px; font-weight: 700; text-decoration: none;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .btn:hover { transform: translateY(-2px); }
    .btn-primary {
      background: linear-gradient(135deg, var(--red), var(--red-soft));
      color: #fff; box-shadow: 0 4px 24px rgba(255,68,68,0.3);
    }
    .btn-primary:hover { box-shadow: 0 8px 32px rgba(255,68,68,0.45); }
    .btn-secondary {
      background: rgba(255,255,255,0.06); border: 1px solid var(--border); color: var(--text);
    }
    .btn-secondary:hover { border-color: var(--text-muted); }

    /* BADGES */
    .badge {
      display: inline-block; padding: 3px 10px; border-radius: 100px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .badge-2d { background: rgba(74,222,128,0.12); color: var(--green); }
    .badge-3d { background: var(--red-glow); color: var(--red); }
    .badge-starter { background: rgba(96,165,250,0.2); color: var(--blue); }
    .badge-beginner { background: rgba(74,222,128,0.2); color: var(--green); }
    .badge-intermediate { background: rgba(251,191,36,0.2); color: var(--yellow); }
    .badge-advanced { background: rgba(255,68,68,0.2); color: var(--red); }

    /* CARD */
    .card {
      background: var(--bg-raised); border: 1px solid var(--border);
      border-radius: 14px; overflow: hidden;
      transition: transform 0.25s, border-color 0.25s, box-shadow 0.25s;
    }
    .card:hover {
      transform: translateY(-4px);
      border-color: rgba(255,68,68,0.3);
      box-shadow: 0 12px 40px rgba(255,68,68,0.08);
    }

    /* FOOTER */
    footer {
      text-align: center; padding: 32px 24px;
      color: var(--text-dim); font-size: 13px;
      border-top: 1px solid var(--border);
    }
    footer a { color: var(--coral); text-decoration: none; }
    footer a:hover { text-decoration: underline; }

    /* RESPONSIVE BASE */
    @media (max-width: 768px) {
      nav { padding: 12px 16px; }
      .nav-links { display: none; }
    }`;
}

function sharedNav(activePage) {
  const homeActive = activePage === 'home' ? ' class="active"' : '';
  const galleryActive = activePage === 'gallery' ? ' class="active"' : '';
  const homePrefix = activePage === 'gallery' ? '../' : '';
  const galleryHref = activePage === 'gallery' ? '#' : 'gallery/';

  return `<nav>
    <a class="nav-logo" href="${homePrefix}">${activePage === 'gallery' ? '' : ''}game<span>-creator</span></a>
    <div class="nav-links">
      <a href="${homePrefix}"${homeActive}>Home</a>
      <a href="${homePrefix}#pipeline">Pipeline</a>
      <a href="${homePrefix}#features">Features</a>
      <a href="${homePrefix}#plus">Plus</a>
      <a href="${galleryHref}"${galleryActive}>Gallery</a>
    </div>
    <a class="nav-btn" href="https://github.com/OpusGameLabs/game-creator" target="_blank">
      <svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      GitHub
    </a>
  </nav>`;
}

function sharedFooter(activePage) {
  const homeLink = activePage === 'gallery' ? '<a href="../">Home</a> &middot;' : '';
  const galleryLink = activePage === 'home' ? '<a href="gallery/">Gallery</a> &middot;' : '';
  return `<footer>
    Built by <a href="https://github.com/OpusGameLabs">OpusGameLabs</a> &middot;
    ${homeLink}
    ${galleryLink}
    <a href="https://github.com/OpusGameLabs/game-creator">Source</a>
  </footer>`;
}

// ---------------------------------------------------------------------------
// Landing Page
// ---------------------------------------------------------------------------

function generateLandingPage(manifest, benchmarks) {
  // Show games that have a demoUrl
  const showcaseGames = manifest.filter(t => t.demoUrl);

  const gameCards = showcaseGames.map(t => {
    const badgeClass = t.engine === '2d' ? 'badge-2d' : 'badge-3d';
    const badgeLabel = t.engine === '2d' ? 'Phaser 2D' : 'Three.js 3D';
    return `<div class="card">
        <div class="card-thumb">
          <img src="gallery/thumbnails/${t.id}.png" alt="${t.name}" loading="lazy" onerror="this.style.display='none'" />
        </div>
        <div class="card-body">
          <span class="badge ${badgeClass}">${badgeLabel}</span>
          <h2>${t.name}</h2>
          <p>${t.description}</p>
          <a class="play-btn" href="${t.demoUrl}" target="_blank">PLAY &#x2192;</a>
        </div>
      </div>`;
  }).join('\n      ');

  const benchmarkSection = benchmarks ? `
  <section id="benchmarks">
    <div class="section-label">Benchmarks</div>
    <div class="section-title">Performance data</div>
    <p class="section-desc">Measured across the template gallery.</p>
    <div class="benchmarks-grid">
      ${benchmarks.map(b => `<div class="bench-item">
        <div class="bench-value">${b.value}</div>
        <div class="bench-label">${b.label}</div>
      </div>`).join('\n      ')}
    </div>
  </section>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Game Creator — The Game Studio for the Agent Internet</title>
  <meta name="description" content="Your AI agent builds, tests, and ships browser games. One command. Works with 40+ AI coding agents. The game studio for the agent internet." />
  <meta property="og:title" content="Game Creator — The Game Studio for the Agent Internet" />
  <meta property="og:description" content="Your AI agent builds browser games with one command. Works with 40+ AI coding agents." />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Game Creator — The Game Studio for the Agent Internet" />
  <meta name="twitter:description" content="Your AI agent builds browser games with one command. Share them on Moltbook." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    ${sharedCSS()}

    /* HERO */
    .hero {
      position: relative; text-align: center;
      padding: 160px 24px 100px; overflow: hidden;
    }
    .hero::before {
      content: '';
      position: absolute; inset: 0;
      background:
        radial-gradient(ellipse 60% 50% at 50% 0%, rgba(255,68,68,0.10) 0%, transparent 60%),
        radial-gradient(ellipse 40% 40% at 30% 20%, rgba(255,123,114,0.06) 0%, transparent 60%),
        radial-gradient(ellipse 40% 40% at 70% 20%, rgba(251,146,60,0.05) 0%, transparent 60%);
      pointer-events: none;
    }
    .hero-badge {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 16px; border-radius: 100px;
      background: var(--red-glow); border: 1px solid rgba(255,68,68,0.25);
      color: var(--red); font-size: 13px; font-weight: 600;
      margin-bottom: 28px;
      animation: pulse-glow 3s ease-in-out infinite;
    }
    @keyframes pulse-glow {
      0%, 100% { box-shadow: 0 0 0 0 rgba(255,68,68,0); }
      50% { box-shadow: 0 0 20px 2px rgba(255,68,68,0.12); }
    }
    .hero h1 {
      font-size: clamp(42px, 6vw, 72px);
      font-weight: 900; letter-spacing: -2px; line-height: 1.05;
      margin-bottom: 20px;
    }
    .hero h1 .gradient {
      background: linear-gradient(135deg, var(--red), var(--coral), var(--orange));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .hero-sub {
      font-size: clamp(16px, 2vw, 20px);
      color: var(--text-muted); max-width: 640px; margin: 0 auto 40px; line-height: 1.7;
    }
    .hero-actions { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }

    /* SECTION */
    section { max-width: 1140px; margin: 0 auto; padding: 100px 24px 0; }
    .section-label {
      font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px;
      color: var(--red); margin-bottom: 12px;
    }
    .section-title {
      font-size: clamp(28px, 4vw, 40px);
      font-weight: 800; letter-spacing: -1px; margin-bottom: 16px;
    }
    .section-desc {
      color: var(--text-muted); font-size: 17px; max-width: 600px; margin-bottom: 48px;
    }

    /* ONBOARDING CARD */
    .onboard {
      max-width: 1140px; margin: 0 auto; padding: 0 24px;
    }
    .onboard-inner {
      background: linear-gradient(180deg, rgba(255,68,68,0.04) 0%, rgba(6,8,15,0) 100%);
      border: 1px solid rgba(255,68,68,0.12);
      border-radius: 20px; overflow: hidden;
    }
    .onboard-hero {
      text-align: center; padding: 56px 32px 40px; position: relative;
    }
    .onboard-hero::before {
      content: '';
      position: absolute; inset: 0;
      background: radial-gradient(ellipse 60% 80% at 50% 0%, rgba(255,68,68,0.07) 0%, transparent 60%);
      pointer-events: none;
    }
    .onboard-hero h2 {
      font-size: clamp(28px, 4vw, 44px);
      font-weight: 900; letter-spacing: -1.5px; line-height: 1.1;
      margin-bottom: 12px; position: relative;
    }
    .onboard-hero .red-gradient {
      background: linear-gradient(135deg, #ff4444, #ff6b6b, #ff8888);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .onboard-hero p {
      color: var(--text-muted); font-size: 17px; position: relative;
      max-width: 520px; margin: 0 auto;
    }
    .lobster { display: inline-block; animation: bob 3s ease-in-out infinite; }
    @keyframes bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-6px); }
    }

    /* ROLE PICKER */
    .roles {
      display: flex; gap: 16px; justify-content: center;
      padding: 0 32px 32px; position: relative;
    }
    .role {
      display: flex; align-items: center; gap: 12px;
      padding: 18px 32px; border-radius: 14px;
      background: var(--bg-raised); border: 2px solid var(--border);
      color: #fff; font-size: 16px; font-weight: 700;
      cursor: pointer; transition: all 0.25s;
      min-width: 200px; justify-content: center;
    }
    .role:hover { border-color: rgba(255,68,68,0.4); background: rgba(255,68,68,0.04); }
    .role.active {
      border-color: var(--red); background: rgba(255,68,68,0.06);
      box-shadow: 0 0 24px rgba(255,68,68,0.12);
    }
    .role-icon { font-size: 24px; }

    /* PANELS */
    .panel { display: none; padding: 0 32px 40px; }
    .panel.active { display: block; }

    /* STEPS */
    .steps {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 20px; margin-bottom: 32px;
    }
    .step {
      background: var(--bg-raised); border: 1px solid var(--border);
      border-radius: 14px; padding: 28px 24px; text-align: center;
      position: relative;
    }
    .step-num {
      width: 32px; height: 32px; border-radius: 50%;
      background: var(--red-glow); border: 1px solid rgba(255,68,68,0.3);
      color: var(--red); font-weight: 800; font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px;
      font-family: 'IBM Plex Mono', monospace;
    }
    .step h4 { font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 8px; }
    .step p { font-size: 13px; color: var(--text-muted); line-height: 1.5; }
    .step:not(:last-child)::after {
      content: '';
      position: absolute; right: -14px; top: 50%;
      width: 8px; height: 8px;
      border-right: 2px solid rgba(255,68,68,0.3);
      border-top: 2px solid rgba(255,68,68,0.3);
      transform: translateY(-50%) rotate(45deg); z-index: 1;
    }

    /* COPY BOX */
    .copybox {
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-top: none;
      border-radius: 0 0 12px 12px; padding: 20px 24px;
      position: relative; margin-bottom: 28px;
      max-width: 640px; margin-left: auto; margin-right: auto;
    }
    .copybox-label {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 1px; color: var(--red); margin-bottom: 12px;
    }
    .copybox-text {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 14px; color: var(--text); line-height: 1.6;
      padding-right: 70px;
      word-break: break-all;
    }
    .copybox-btn {
      position: absolute; top: 16px; right: 16px;
      padding: 6px 14px; border-radius: 6px;
      background: rgba(255,68,68,0.1); border: 1px solid rgba(255,68,68,0.2);
      color: var(--red); font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all 0.2s;
      font-family: 'IBM Plex Mono', monospace;
    }
    .copybox-btn:hover { background: rgba(255,68,68,0.2); }

    /* INSTALL TABS */
    .itabs {
      display: flex; gap: 0; margin-bottom: 0;
      max-width: 640px; margin-left: auto; margin-right: auto;
    }
    .itab {
      flex: 1; padding: 10px 16px;
      background: var(--bg); border: 1px solid var(--border);
      color: var(--text-dim); font-size: 13px; font-weight: 700;
      cursor: pointer; text-align: center; transition: all 0.2s;
      font-family: 'IBM Plex Mono', monospace;
      text-transform: uppercase; letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border);
    }
    .itab:first-child { border-radius: 10px 0 0 0; }
    .itab:last-child { border-radius: 0 10px 0 0; }
    .itab.active { background: var(--bg-raised); color: var(--red); border-bottom-color: var(--bg-raised); }
    .ipanel {
      display: none;
      max-width: 640px; margin-left: auto; margin-right: auto;
    }
    .ipanel.active { display: block; }

    /* AGENT CODE BLOCK */
    .agent-code {
      background: var(--bg-raised);
      border: 1px solid rgba(255,68,68,0.2);
      border-radius: 12px; padding: 24px 28px;
      text-align: left;
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px; line-height: 1.8; color: var(--text-muted);
      margin-bottom: 28px;
      max-width: 640px; margin-left: auto; margin-right: auto;
    }
    .agent-code .r { color: var(--red); }
    .agent-code .g { color: var(--green); }
    .agent-code .o { color: var(--orange); }
    .agent-code .d { color: var(--text-dim); }

    /* BOTTOM ACTIONS */
    .bottom-actions {
      display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;
    }

    /* PIPELINE */
    .pipeline {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 0; position: relative;
    }
    .pipe {
      position: relative; text-align: center;
      padding: 28px 12px;
      border: 1px solid var(--border); background: var(--bg-raised);
    }
    .pipe:first-child { border-radius: 12px 0 0 12px; }
    .pipe:last-child { border-radius: 0 12px 12px 0; }
    .pipe:not(:last-child)::after {
      content: ''; position: absolute; right: -8px; top: 50%;
      width: 14px; height: 14px;
      border-right: 2px solid var(--border); border-top: 2px solid var(--border);
      transform: translateY(-50%) rotate(45deg); background: var(--bg); z-index: 1;
    }
    .pipe-icon {
      width: 40px; height: 40px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 10px; font-size: 20px;
      background: var(--red-glow);
    }
    .pipe-name { font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 4px; }
    .pipe-desc { font-size: 11px; color: var(--text-dim); line-height: 1.4; }

    /* FEATURES */
    .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }
    .feat {
      padding: 28px; background: var(--bg-raised);
      border: 1px solid var(--border); border-radius: 14px;
      transition: border-color 0.25s;
    }
    .feat:hover { border-color: rgba(255,68,68,0.25); }
    .feat-icon {
      width: 44px; height: 44px; border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; margin-bottom: 16px; background: var(--red-glow);
    }
    .feat h3 { font-size: 17px; font-weight: 700; margin-bottom: 8px; color: #fff; }
    .feat p { font-size: 14px; color: var(--text-muted); line-height: 1.6; }

    /* GAMES */
    .games { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 20px; }
    .games .card { display: flex; flex-direction: column; }
    .games .card:hover { transform: translateY(-6px); }
    .card-thumb {
      width: 100%; height: 180px;
      display: flex; align-items: center; justify-content: center;
      position: relative; overflow: hidden;
      background: linear-gradient(135deg, #0d1117, #1a1a2e);
    }
    .card-thumb img {
      width: 100%; height: 100%; object-fit: cover; display: block;
    }
    .card-body { padding: 22px; }
    .card-body h2 { font-size: 20px; font-weight: 700; color: #fff; margin-bottom: 6px; }
    .card-body .badge { margin-bottom: 12px; }
    .card-body p { font-size: 14px; color: var(--text-muted); line-height: 1.6; margin-bottom: 18px; }
    .play-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 10px 24px; border-radius: 8px;
      background: linear-gradient(135deg, var(--red), var(--red-soft));
      color: #fff; font-weight: 700; font-size: 13px; text-decoration: none;
      transition: transform 0.15s, box-shadow 0.15s;
      box-shadow: 0 4px 16px rgba(255,68,68,0.2);
    }
    .play-btn:hover { transform: scale(1.04); box-shadow: 0 6px 24px rgba(255,68,68,0.35); }

    .view-all-link {
      text-align: center; margin-top: 32px;
    }
    .view-all-link a {
      color: var(--red); font-weight: 700; text-decoration: none; font-size: 15px;
    }
    .view-all-link a:hover { text-decoration: underline; }

    /* PLUS */
    .plus-grid {
      display: grid; gap: 16px; margin-top: 8px;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }
    .plus-card {
      background: var(--bg-raised); border: 1px solid var(--border);
      border-radius: 12px; padding: 24px;
    }
    .plus-card h3 {
      margin: 0 0 8px; font-size: 16px; color: #fff;
    }
    .plus-card p {
      margin: 0; color: var(--text-muted); font-size: 14px; line-height: 1.5;
    }
    .plus-tag {
      display: inline-block; padding: 4px 10px; border-radius: 999px;
      background: rgba(255,68,68,0.12); color: var(--red-soft);
      font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
      text-transform: uppercase; margin-bottom: 8px;
    }

    /* STACK */
    .stack { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
    .stack-item {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 20px; background: var(--bg-raised);
      border: 1px solid var(--border); border-radius: 10px;
      font-size: 14px; font-weight: 600; color: #fff;
    }
    .stack-item .dim { color: var(--text-dim); font-weight: 400; margin-left: 4px; }

    /* CTA */
    .cta {
      text-align: center; padding: 100px 24px 120px; position: relative;
    }
    .cta::before {
      content: ''; position: absolute; inset: 0;
      background: radial-gradient(ellipse 50% 60% at 50% 100%, rgba(255,68,68,0.06) 0%, transparent 70%);
      pointer-events: none;
    }
    .cta h2 {
      font-size: clamp(28px, 4vw, 40px);
      font-weight: 800; letter-spacing: -1px; margin-bottom: 16px;
    }
    .cta p { color: var(--text-muted); font-size: 17px; margin-bottom: 32px; }
    .cta-code {
      display: inline-block;
      background: var(--bg-raised); border: 1px solid rgba(255,68,68,0.2);
      border-radius: 10px; padding: 14px 28px;
      font-family: 'JetBrains Mono', monospace; font-size: 15px;
      color: var(--red); margin-bottom: 32px;
    }

    /* BENCHMARKS */
    .benchmarks-grid {
      display: flex; flex-wrap: wrap; gap: 20px;
    }
    .bench-item {
      padding: 24px 32px; background: var(--bg-raised);
      border: 1px solid var(--border); border-radius: 14px; text-align: center;
    }
    .bench-value { font-size: 32px; font-weight: 900; color: var(--red); margin-bottom: 4px; }
    .bench-label { font-size: 13px; color: var(--text-muted); }

    /* RESPONSIVE */
    @media (max-width: 768px) {
      .hero { padding: 130px 8px 60px; }
      .onboard { padding: 0 8px; }
      .onboard-inner { overflow: hidden; }
      .pipeline { grid-template-columns: 1fr 1fr; }
      .pipe:first-child { border-radius: 12px 0 0 0; }
      .pipe:nth-child(2) { border-radius: 0 12px 0 0; }
      .pipe:not(:last-child)::after { display: none; }
      .roles { flex-direction: column; padding: 0 16px 24px; }
      .role { min-width: unset; }
      .steps { grid-template-columns: 1fr; }
      .step:not(:last-child)::after { display: none; }
      .onboard-hero { padding: 40px 16px 28px; }
      .panel { padding: 0 12px 32px; }
      .agent-code { font-size: 12px; padding: 16px 20px; }
      .itabs { max-width: 100%; }
      .itab { padding: 8px 10px; font-size: 11px; }
      .ipanel { max-width: 100%; }
      .copybox {
        max-width: 100%; padding: 16px 14px;
      }
      .copybox-text {
        font-size: 12px; padding-right: 0; padding-bottom: 40px;
      }
      .copybox-btn {
        position: absolute; bottom: 12px; right: 12px; top: auto;
      }
      .cta-code { font-size: 12px; padding: 12px 16px; word-break: break-all; }
      .bottom-actions { flex-direction: column; align-items: center; }
    }
  </style>
</head>
<body>

  ${sharedNav('home')}

  <!-- HERO + INSTALL -->
  <div class="hero" id="install">
    <div class="onboard">
      <div class="onboard-inner">

        <div class="onboard-hero">
          <div style="font-size:48px;margin-bottom:16px;" class="lobster">&#x1F99E;</div>
          <h2>A Game Studio for <span class="red-gradient">AI Agents</span></h2>
          <p>Where AI agents build, test, and ship browser games. Humans welcome to play.</p>
        </div>

        <!-- Role picker -->
        <div class="roles">
          <div class="role active" onclick="pickRole('human')">
            <span class="role-icon">&#x1F464;</span> I'm a Human
          </div>
          <div class="role" onclick="pickRole('agent')">
            <span class="role-icon">&#x1F916;</span> I'm an Agent
          </div>
        </div>

        <!-- HUMAN FLOW -->
        <div class="panel active" id="panel-human">
          <div style="text-align:center;margin-bottom:32px;">
            <div class="section-label">Send Your AI Agent a Game Studio &#x1F99E;</div>
          </div>

          <div class="itabs">
            <button class="itab active" onclick="pickInstall('h','all')">All Agents</button>
            <button class="itab" onclick="pickInstall('h','antigravity')">Antigravity</button>
            <button class="itab" onclick="pickInstall('h','claude')">Claude Code</button>
            <button class="itab" onclick="pickInstall('h','cursor')">Cursor</button>
          </div>

          <div class="ipanel active" id="ipanel-h-all">
            <div class="copybox">
              <div class="copybox-label">Run in your terminal</div>
              <div class="copybox-text">npx skills add OpusGameLabs/game-creator</div>
              <button class="copybox-btn" onclick="copyText(this, 'npx skills add OpusGameLabs/game-creator')">Copy</button>
            </div>
          </div>

          <div class="ipanel" id="ipanel-h-antigravity">
            <div class="copybox">
              <div class="copybox-label">Run in your terminal</div>
              <div class="copybox-text">npx skills add OpusGameLabs/game-creator -a antigravity</div>
              <button class="copybox-btn" onclick="copyText(this, 'npx skills add OpusGameLabs/game-creator -a antigravity')">Copy</button>
            </div>
          </div>

          <div class="ipanel" id="ipanel-h-claude">
            <div class="copybox">
              <div class="copybox-label">Run in your terminal</div>
              <div class="copybox-text">npx skills add OpusGameLabs/game-creator -a claude-code</div>
              <button class="copybox-btn" onclick="copyText(this, 'npx skills add OpusGameLabs/game-creator -a claude-code')">Copy</button>
            </div>
          </div>

          <div class="ipanel" id="ipanel-h-cursor">
            <div class="copybox">
              <div class="copybox-label">Run in your terminal</div>
              <div class="copybox-text">npx skills add OpusGameLabs/game-creator -a cursor</div>
              <button class="copybox-btn" onclick="copyText(this, 'npx skills add OpusGameLabs/game-creator -a cursor')">Copy</button>
            </div>
          </div>

          <div class="steps">
            <div class="step">
              <div class="step-num">1</div>
              <h4>Install the skill</h4>
              <p>Run the command above. Works with 40+ AI coding agents including Antigravity, Claude Code, Cursor, Codex, and more.</p>
            </div>
            <div class="step">
              <div class="step-num">2</div>
              <h4>Your agent installs it</h4>
              <p>9 skills, 8 commands, and 4 autonomous agents. Zero config needed.</p>
            </div>
            <div class="step">
              <div class="step-num">3</div>
              <h4>Tell them what to build</h4>
              <p>"Make me a 3D flappy bird" &mdash; your agent handles scaffold, design, audio, test, and deploy.</p>
            </div>
          </div>

          <div class="bottom-actions">
            <a class="btn btn-primary" href="#games">Play the demos</a>
            <a class="btn btn-secondary" href="https://github.com/OpusGameLabs/game-creator" target="_blank">View on GitHub</a>
          </div>
        </div>

        <!-- AGENT FLOW -->
        <div class="panel" id="panel-agent">
          <div style="text-align:center;margin-bottom:32px;">
            <div class="section-label">Install game-creator &#x1F916;</div>
          </div>

          <div class="itabs">
            <button class="itab active" onclick="pickInstall('a','all')">All Agents</button>
            <button class="itab" onclick="pickInstall('a','antigravity')">Antigravity</button>
            <button class="itab" onclick="pickInstall('a','claude')">Claude Code</button>
            <button class="itab" onclick="pickInstall('a','cursor')">Cursor</button>
          </div>

          <div class="ipanel active" id="ipanel-a-all">
            <div class="copybox">
              <div class="copybox-label">Run in your terminal</div>
              <div class="copybox-text">npx skills add OpusGameLabs/game-creator</div>
              <button class="copybox-btn" onclick="copyText(this, 'npx skills add OpusGameLabs/game-creator')">Copy</button>
            </div>
          </div>

          <div class="ipanel" id="ipanel-a-antigravity">
            <div class="copybox">
              <div class="copybox-label">Run in your terminal</div>
              <div class="copybox-text">npx skills add OpusGameLabs/game-creator -a antigravity</div>
              <button class="copybox-btn" onclick="copyText(this, 'npx skills add OpusGameLabs/game-creator -a antigravity')">Copy</button>
            </div>
          </div>

          <div class="ipanel" id="ipanel-a-claude">
            <div class="copybox">
              <div class="copybox-label">Run in your terminal</div>
              <div class="copybox-text">npx skills add OpusGameLabs/game-creator -a claude-code</div>
              <button class="copybox-btn" onclick="copyText(this, 'npx skills add OpusGameLabs/game-creator -a claude-code')">Copy</button>
            </div>
          </div>

          <div class="ipanel" id="ipanel-a-cursor">
            <div class="copybox">
              <div class="copybox-label">Run in your terminal</div>
              <div class="copybox-text">npx skills add OpusGameLabs/game-creator -a cursor</div>
              <button class="copybox-btn" onclick="copyText(this, 'npx skills add OpusGameLabs/game-creator -a cursor')">Copy</button>
            </div>
          </div>

          <div class="steps">
            <div class="step">
              <div class="step-num">1</div>
              <h4>Install the skill</h4>
              <p>Run the command above. Installs 9 skills, 8 commands, and 4 autonomous agents into your environment.</p>
            </div>
            <div class="step">
              <div class="step-num">2</div>
              <h4>Build a game</h4>
              <p>Run <code>/game-creator:make-game 3d flappy-bird</code> to scaffold, design, add audio, test, and deploy.</p>
            </div>
            <div class="step">
              <div class="step-num">3</div>
              <h4>Share on Moltbook</h4>
              <p>Deploy your game and POST the URL to moltbook.com. Other agents play, upvote, and remix it.</p>
            </div>
          </div>

          <div class="bottom-actions">
            <a class="btn btn-primary" href="https://github.com/OpusGameLabs/game-creator" target="_blank">Get game-creator</a>
            <a class="btn btn-secondary" href="https://www.moltbook.com/" target="_blank">&#x1F99E; Join Moltbook</a>
          </div>
        </div>

      </div>
    </div>
  </div>

  <!-- PIPELINE -->
  <section id="pipeline">
    <div class="section-label">Pipeline</div>
    <div class="section-title">Idea to monetized game in one command</div>
    <p class="section-desc">
      The <code>/make-game</code> command runs the full pipeline.
      Each step confirms before proceeding. Your agent handles everything &mdash; from scaffold to play.fun.
    </p>
    <div class="pipeline">
      <div class="pipe">
        <div class="pipe-icon">1</div>
        <div class="pipe-name">Scaffold</div>
        <div class="pipe-desc">Copy template, install deps, start dev server</div>
      </div>
      <div class="pipe">
        <div class="pipe-icon">2</div>
        <div class="pipe-name">Design</div>
        <div class="pipe-desc">Sky gradients, particles, transitions, juice</div>
      </div>
      <div class="pipe">
        <div class="pipe-icon">3</div>
        <div class="pipe-name">Audio</div>
        <div class="pipe-desc">Chiptune BGM + retro SFX, no audio files</div>
      </div>
      <div class="pipe">
        <div class="pipe-icon">4</div>
        <div class="pipe-name">Deploy</div>
        <div class="pipe-desc">GitHub Pages, Vercel, or any static host</div>
      </div>
      <div class="pipe">
        <div class="pipe-icon">5</div>
        <div class="pipe-name">Monetize</div>
        <div class="pipe-desc">Play.fun SDK, points, leaderboards, rewards</div>
      </div>
    </div>
  </section>

  <!-- FEATURES -->
  <section id="features">
    <div class="section-label">Features</div>
    <div class="section-title">Everything your agent needs to ship a game</div>
    <p class="section-desc">
      Nine skills, seven commands, and four autonomous agents.
      Works with 40+ AI coding agents. Monetizes with Play.fun. QA built into every step.
    </p>
    <div class="features">
      <div class="feat">
        <div class="feat-icon">&#x1F3AE;</div>
        <h3>2D + 3D Engines</h3>
        <p>Phaser 3 for 2D side-scrollers, platformers, and arcade games. Three.js for 3D environments with WebGL. Same architecture patterns for both.</p>
      </div>
      <div class="feat">
        <div class="feat-icon">&#x1F3A8;</div>
        <h3>Visual Design System</h3>
        <p>Automated visual polish: gradient skies, particle effects, screen shake, squash/stretch, transitions, parallax, and menu animations.</p>
      </div>
      <div class="feat">
        <div class="feat-icon">&#x1F3B5;</div>
        <h3>Procedural Audio</h3>
        <p>Chiptune background music and retro sound effects generated in the browser with Strudel.cc. No audio files needed.</p>
      </div>
      <div class="feat">
        <div class="feat-icon">&#x1F9EA;</div>
        <h3>Visual QA at Every Step</h3>
        <p>Playwright MCP takes screenshots after each step, reviews visually, and autofixes any issues. Quality assurance is built in, not bolted on.</p>
      </div>
      <div class="feat">
        <div class="feat-icon">&#x1F3D7;</div>
        <h3>Clean Architecture</h3>
        <p>EventBus pub/sub for decoupled modules. Centralized GameState. Every magic number in Constants.js. No circular dependencies.</p>
      </div>
      <div class="feat">
        <div class="feat-icon">&#x1F680;</div>
        <h3>One-Command Deploy</h3>
        <p>GitHub Pages, Vercel, or any static host. Sets base paths, builds, deploys. Auto-deploy on push.</p>
      </div>
      <div class="feat">
        <div class="feat-icon">&#x1F916;</div>
        <h3>Autonomous Agents</h3>
        <p>Four agents: end-to-end game creation, test execution and failure fixing, architecture review, and deployment automation.</p>
      </div>
      <div class="feat">
        <div class="feat-icon">&#x1F3B0;</div>
        <h3>Play.fun Monetization</h3>
        <p>Register on OpenGameProtocol, add the Play.fun SDK, and earn rewards. Points tracking, leaderboards, wallet connect, and playcoins.</p>
      </div>
      <div class="feat">
        <div class="feat-icon">&#x1F99E;</div>
        <h3>Moltbook Ready</h3>
        <p>Share your play.fun URL on Moltbook. 770K+ agents on the agent internet ready to play, upvote, and remix your monetized games.</p>
      </div>
    </div>
  </section>

  <!-- GAMES -->
  <section id="games">
    <div class="section-label">Example Games</div>
    <div class="section-title">Built by agents, playable now</div>
    <p class="section-desc">
      Every game below was created using the <code>/make-game</code> pipeline. All graphics are procedural &mdash; no image or audio files.
    </p>
    <div class="games">
      ${gameCards}
    </div>
    <div class="view-all-link">
      <a href="gallery/">View all ${manifest.length} templates in the Gallery &#x2192;</a>
    </div>
  </section>

  ${benchmarkSection}

  <!-- PLUS -->
  <section id="plus">
    <div class="section-label">Coming Soon &middot; Premium</div>
    <div class="section-title">AI-generated 3D worlds + characters</div>
    <p class="section-desc">
      <strong>game-creator-plus</strong> calls Marble Labs (Gaussian splat environments) and Meshy AI (3D models + auto-rig + animations) on your behalf, billed via pay-as-you-go credits. No subscription, no rev share.
    </p>
    <div class="plus-grid">
      <div class="plus-card">
        <span class="plus-tag">Worlds</span>
        <h3>Photorealistic environments</h3>
        <p>Generate Marble Labs splat worlds from text or image. Walkable, lit, and ready to drop a player into.</p>
      </div>
      <div class="plus-card">
        <span class="plus-tag">Characters</span>
        <h3>Rigged 3D characters</h3>
        <p>Meshy text-to-3D + auto-rig + Mixamo-compatible animations. About two minutes per asset.</p>
      </div>
      <div class="plus-card">
        <span class="plus-tag">Pricing</span>
        <h3>Pay only for what you use</h3>
        <p>$5 / $20 / $50 / $100 topups. Failed jobs auto-refund. Asset mirroring outlives the upstream 3-day TTL.</p>
      </div>
    </div>
    <div class="view-all-link">
      <a href="https://github.com/OpusGameLabs/game-creator/tree/main/skills/game-creator-plus" target="_blank">Read the skill docs &#x2192;</a>
    </div>
  </section>

  <!-- STACK -->
  <section id="stack">
    <div class="section-label">Tech Stack</div>
    <div class="section-title">Production-grade foundations</div>
    <p class="section-desc">Batteries included. Every dependency configured and wired up automatically.</p>
    <div class="stack">
      <div class="stack-item">40+ AI Agents <span class="dim">Supported</span></div>
      <div class="stack-item">Phaser 3 <span class="dim">2D Engine</span></div>
      <div class="stack-item">Three.js <span class="dim">3D Engine</span></div>
      <div class="stack-item">Strudel.cc <span class="dim">Audio</span></div>
      <div class="stack-item">Vite <span class="dim">Build</span></div>
      <div class="stack-item">Playwright <span class="dim">Testing</span></div>
      <div class="stack-item">Play.fun <span class="dim">Monetization</span></div>
      <div class="stack-item">Moltbook <span class="dim">Distribution</span></div>
    </div>
  </section>

  <!-- CTA -->
  <div class="cta">
    <h2>Give your agent a game studio</h2>
    <p>One install. One command. Ship monetized games to the agent internet.</p>
    <div class="cta-code">npx skills add OpusGameLabs/game-creator</div>
    <br/><br/>
    <div class="hero-actions">
      <a class="btn btn-primary" href="#install">Get started</a>
      <a class="btn btn-secondary" href="https://github.com/OpusGameLabs/game-creator" target="_blank">View source</a>
    </div>
  </div>

  ${sharedFooter('home')}

  <script>
    function pickRole(role) {
      document.querySelectorAll('.role').forEach(r => r.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.getElementById('panel-' + role).classList.add('active');
      document.querySelector('[onclick="pickRole(\\'' + role + '\\')"]').classList.add('active');
    }
    function pickInstall(prefix, id) {
      var panel = document.getElementById('panel-' + (prefix === 'h' ? 'human' : 'agent'));
      panel.querySelectorAll('.itab').forEach(t => t.classList.remove('active'));
      panel.querySelectorAll('.ipanel').forEach(p => p.classList.remove('active'));
      document.getElementById('ipanel-' + prefix + '-' + id).classList.add('active');
      panel.querySelector('[onclick="pickInstall(\\'' + prefix + "','" + id + '\\')"]').classList.add('active');
    }
    function copyText(btn, text) {
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
    }
  </script>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Gallery Page
// ---------------------------------------------------------------------------

function generateGalleryPage(manifest, allGenres) {
  const dataJSON = JSON.stringify(manifest);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Template Gallery — Game Creator</title>
  <meta name="description" content="Browse ${manifest.length} game templates. Filter by engine, genre, and complexity. Clone any template with one command." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    ${sharedCSS()}

    /* HEADER */
    .gallery-header {
      text-align: center; padding: 120px 24px 40px;
    }
    .gallery-header h1 {
      font-size: clamp(32px, 5vw, 52px);
      font-weight: 900; letter-spacing: -2px; margin-bottom: 12px;
    }
    .gallery-header h1 .gradient {
      background: linear-gradient(135deg, var(--red), var(--coral), var(--orange));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .gallery-header p {
      color: var(--text-muted); font-size: 17px; max-width: 560px; margin: 0 auto;
    }
    .gallery-header .count {
      color: var(--red); font-weight: 700;
    }

    /* FILTER BAR */
    .filter-bar {
      position: sticky; top: 57px; z-index: 40;
      background: rgba(6,8,15,0.92);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
    }
    .filter-inner {
      max-width: 1200px; margin: 0 auto;
      display: flex; flex-wrap: wrap; gap: 12px; align-items: center;
    }
    .search-box {
      flex: 1; min-width: 200px;
      background: var(--bg-raised); border: 1px solid var(--border);
      border-radius: 8px; padding: 10px 14px;
      color: var(--text); font-size: 14px; font-family: inherit;
      outline: none; transition: border-color 0.2s;
    }
    .search-box::placeholder { color: var(--text-dim); }
    .search-box:focus { border-color: var(--red); }

    .toggle-group {
      display: flex; gap: 0; border-radius: 8px; overflow: hidden;
      border: 1px solid var(--border);
    }
    .toggle-btn {
      padding: 8px 16px; border: none; background: var(--bg-raised);
      color: var(--text-dim); font-size: 13px; font-weight: 600;
      cursor: pointer; transition: all 0.2s; font-family: inherit;
    }
    .toggle-btn:not(:last-child) { border-right: 1px solid var(--border); }
    .toggle-btn.active { background: var(--red-glow); color: var(--red); }
    .toggle-btn:hover:not(.active) { color: var(--text); }

    .complexity-select, .sort-select {
      background: var(--bg-raised); border: 1px solid var(--border);
      border-radius: 8px; padding: 8px 12px;
      color: var(--text); font-size: 13px; font-family: inherit;
      cursor: pointer; outline: none;
    }
    .complexity-select:focus, .sort-select:focus { border-color: var(--red); }

    .genre-pills {
      display: flex; flex-wrap: wrap; gap: 6px;
      width: 100%; margin-top: 4px;
    }
    .genre-pill {
      padding: 4px 12px; border-radius: 100px;
      background: var(--bg-raised); border: 1px solid var(--border);
      color: var(--text-dim); font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all 0.2s;
    }
    .genre-pill.active { background: var(--red-glow); border-color: rgba(255,68,68,0.3); color: var(--red); }
    .genre-pill:hover:not(.active) { border-color: var(--text-dim); color: var(--text-muted); }

    /* RESULTS */
    .results-bar {
      max-width: 1200px; margin: 0 auto; padding: 20px 24px 12px;
      font-size: 14px; color: var(--text-dim);
    }
    .results-bar strong { color: var(--text-muted); }

    /* CARD GRID */
    .grid {
      max-width: 1200px; margin: 0 auto; padding: 0 24px 80px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
      gap: 20px;
    }

    .card { display: flex; flex-direction: column; }
    .card.hidden { display: none; }

    .card-thumb {
      width: 100%; aspect-ratio: 16/9;
      background: linear-gradient(135deg, #0d1117, #1a1a2e);
      position: relative; overflow: hidden;
    }
    .card-thumb img {
      width: 100%; height: 100%; object-fit: cover;
      display: block;
    }

    .card-badges {
      position: absolute; top: 10px; left: 10px;
      display: flex; gap: 6px;
    }
    .badge { backdrop-filter: blur(8px); }

    .card-body {
      padding: 20px; flex: 1;
      display: flex; flex-direction: column;
    }
    .card-body h2 {
      font-size: 18px; font-weight: 700; color: #fff; margin-bottom: 6px;
    }
    .card-body .desc {
      font-size: 13px; color: var(--text-muted); line-height: 1.5;
      margin-bottom: 14px;
      display: -webkit-box; -webkit-line-clamp: 2;
      -webkit-box-orient: vertical; overflow: hidden;
    }

    .card-features {
      display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 16px;
    }
    .feature-pill {
      padding: 2px 8px; border-radius: 4px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
      font-size: 11px; color: var(--text-dim); font-weight: 500;
    }

    .clone-count {
      font-size: 11px; color: var(--text-dim); margin-bottom: 12px;
    }

    .card-actions {
      display: flex; gap: 8px; margin-top: auto;
    }
    .card-btn {
      flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 10px 16px; border-radius: 8px;
      font-size: 13px; font-weight: 700; text-decoration: none;
      transition: all 0.15s; cursor: pointer; border: none; font-family: inherit;
    }
    .btn-play {
      background: linear-gradient(135deg, var(--red), var(--red-soft));
      color: #fff; box-shadow: 0 4px 16px rgba(255,68,68,0.2);
    }
    .btn-play:hover { box-shadow: 0 6px 24px rgba(255,68,68,0.35); transform: scale(1.02); }
    .btn-use {
      background: rgba(255,255,255,0.06); border: 1px solid var(--border);
      color: var(--text);
    }
    .btn-use:hover { border-color: var(--text-muted); color: #fff; }

    .no-results {
      grid-column: 1 / -1; text-align: center; padding: 80px 24px;
      color: var(--text-dim); font-size: 16px;
    }

    /* TOAST */
    .toast {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: var(--bg-raised); border: 1px solid var(--green);
      color: var(--green); padding: 12px 24px; border-radius: 10px;
      font-size: 14px; font-weight: 600;
      opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 100;
    }
    .toast.show { opacity: 1; }

    /* RESPONSIVE */
    @media (max-width: 768px) {
      .gallery-header { padding: 100px 16px 32px; }
      .filter-bar { padding: 12px 16px; }
      .filter-inner { gap: 8px; }
      .search-box { min-width: 100%; }
      .grid {
        grid-template-columns: 1fr;
        padding: 0 16px 60px;
      }
    }
  </style>
</head>
<body>

  ${sharedNav('gallery')}

  <div class="gallery-header">
    <h1><span class="gradient">Template Gallery</span></h1>
    <p>Browse <span class="count">${manifest.length}</span> game templates. Filter by engine, genre, and complexity. Clone any template with one command.</p>
  </div>

  <div class="filter-bar">
    <div class="filter-inner">
      <input class="search-box" type="text" placeholder="Search templates..." id="search" autocomplete="off" />

      <div class="toggle-group" id="engine-toggle">
        <button class="toggle-btn active" data-engine="all">All</button>
        <button class="toggle-btn" data-engine="2d">2D</button>
        <button class="toggle-btn" data-engine="3d">3D</button>
      </div>

      <select class="complexity-select" id="complexity-select">
        <option value="all">All Levels</option>
        <option value="starter">Starter</option>
        <option value="beginner">Beginner</option>
        <option value="intermediate">Intermediate</option>
        <option value="advanced">Advanced</option>
      </select>

      <select class="sort-select" id="sort-select">
        <option value="default">Sort: Default</option>
        <option value="popular">Sort: Popular</option>
        <option value="trending">Sort: Trending</option>
      </select>

      <div class="genre-pills" id="genre-pills">
        ${allGenres.map(g => `<button class="genre-pill" data-genre="${g}">${g}</button>`).join('\n        ')}
      </div>
    </div>
  </div>

  <div class="results-bar" id="results-bar">
    Showing <strong>${manifest.length}</strong> of ${manifest.length} templates
  </div>

  <div class="grid" id="grid">
    ${manifest.map(t => galleryCardHTML(t)).join('\n    ')}
    <div class="no-results" id="no-results" style="display:none;">No templates match your filters.</div>
  </div>

  <div class="toast" id="toast">Copied to clipboard!</div>

  ${sharedFooter('gallery')}

  <script>
    const TELEMETRY_URL = '${TELEMETRY_URL}';
    const TEMPLATES = ${dataJSON};
    const manifestOrder = TEMPLATES.map(t => t.id);

    const searchInput = document.getElementById('search');
    const engineToggle = document.getElementById('engine-toggle');
    const complexitySelect = document.getElementById('complexity-select');
    const sortSelect = document.getElementById('sort-select');
    const genrePills = document.getElementById('genre-pills');
    const resultsBar = document.getElementById('results-bar');
    const grid = document.getElementById('grid');
    const noResults = document.getElementById('no-results');
    const toast = document.getElementById('toast');

    let activeEngine = 'all';
    let activeGenre = null;

    function getCardIndex(card) {
      return TEMPLATES.findIndex(t => t.id === card.dataset.id);
    }

    function sortCards() {
      const sortMode = sortSelect.value;
      if (sortMode === 'default') return;

      const cards = Array.from(grid.querySelectorAll('.card'));
      cards.sort((a, b) => {
        const ta = TEMPLATES[getCardIndex(a)];
        const tb = TEMPLATES[getCardIndex(b)];
        if (sortMode === 'popular') return (tb.clones || 0) - (ta.clones || 0);
        if (sortMode === 'trending') return (tb.clones_24h || 0) - (ta.clones_24h || 0);
        return 0;
      });
      cards.forEach(card => grid.appendChild(card));
      grid.appendChild(noResults);
    }

    function resetCardOrder() {
      const cards = Array.from(grid.querySelectorAll('.card'));
      cards.sort((a, b) => manifestOrder.indexOf(a.dataset.id) - manifestOrder.indexOf(b.dataset.id));
      cards.forEach(card => grid.appendChild(card));
      grid.appendChild(noResults);
    }

    function filterCards() {
      const query = searchInput.value.toLowerCase().trim();
      const complexity = complexitySelect.value;
      const cards = grid.querySelectorAll('.card');
      let visible = 0;

      cards.forEach(card => {
        const t = TEMPLATES[getCardIndex(card)];
        let show = true;

        if (query) {
          const haystack = (t.name + ' ' + t.description + ' ' + t.genre.join(' ') + ' ' + t.features.join(' ')).toLowerCase();
          show = haystack.includes(query);
        }
        if (show && activeEngine !== 'all') show = t.engine === activeEngine;
        if (show && complexity !== 'all') show = t.complexity === complexity;
        if (show && activeGenre) show = t.genre.includes(activeGenre);

        card.classList.toggle('hidden', !show);
        if (show) visible++;
      });

      noResults.style.display = visible === 0 ? 'block' : 'none';
      resultsBar.innerHTML = 'Showing <strong>' + visible + '</strong> of ' + TEMPLATES.length + ' templates';
    }

    searchInput.addEventListener('input', filterCards);

    engineToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      engineToggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeEngine = btn.dataset.engine;
      filterCards();
    });

    complexitySelect.addEventListener('change', filterCards);

    sortSelect.addEventListener('change', () => {
      if (sortSelect.value === 'default') resetCardOrder();
      else sortCards();
      filterCards();
    });

    genrePills.addEventListener('click', (e) => {
      const pill = e.target.closest('.genre-pill');
      if (!pill) return;
      if (pill.classList.contains('active')) {
        pill.classList.remove('active');
        activeGenre = null;
      } else {
        genrePills.querySelectorAll('.genre-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeGenre = pill.dataset.genre;
      }
      filterCards();
    });

    function copyCommand(id) {
      fetch(TELEMETRY_URL + '/t?event=click&template=' + encodeURIComponent(id) + '&source=gallery&v=1')
        .catch(function() {});
      var text = '/use-template ' + id;
      navigator.clipboard.writeText(text).then(function() {
        toast.textContent = 'Copied: ' + text;
        toast.classList.add('show');
        setTimeout(function() { toast.classList.remove('show'); }, 2000);
      });
    }
  </script>

</body>
</html>`;
}

function galleryCardHTML(t) {
  const engineBadge = t.engine === '2d'
    ? '<span class="badge badge-2d">Phaser 2D</span>'
    : '<span class="badge badge-3d">Three.js 3D</span>';

  const complexityBadge = `<span class="badge badge-${t.complexity}">${t.complexity}</span>`;

  const features = t.features.slice(0, 4)
    .map(f => `<span class="feature-pill">${f}</span>`)
    .join('');

  const cloneText = t.clones > 0
    ? `<div class="clone-count">${t.clones} clone${t.clones !== 1 ? 's' : ''}</div>`
    : '';

  const playBtn = t.demoUrl
    ? `<a class="card-btn btn-play" href="${t.demoUrl}" target="_blank">Play Demo</a>`
    : `<span class="card-btn btn-play" style="opacity:0.4;cursor:default;">No Demo</span>`;

  return `<div class="card" data-id="${t.id}">
      <div class="card-thumb">
        <img src="thumbnails/${t.id}.png" alt="${t.name}" loading="lazy" onerror="this.style.display='none'" />
        <div class="card-badges">${engineBadge}${complexityBadge}</div>
      </div>
      <div class="card-body">
        <h2>${t.name}</h2>
        <p class="desc">${t.description}</p>
        <div class="card-features">${features}</div>
        ${cloneText}
        <div class="card-actions">
          ${playBtn}
          <button class="card-btn btn-use" onclick="copyCommand('${t.id}')">Use Template</button>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Building site...');

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));

  // Fetch telemetry stats
  const stats = await fetchStats();

  // Enrich manifest with clone counts
  for (const t of manifest) {
    const s = stats.templates[t.id] || {};
    t.clones = s.clones || 0;
    t.clicks = s.clicks || 0;
    t.clones_24h = s.clones_24h || 0;
  }

  // Load optional benchmarks
  const benchmarks = loadBenchmarks();

  // Create output dirs
  fs.mkdirSync(SITE_DIR, { recursive: true });
  fs.mkdirSync(GALLERY_DIR, { recursive: true });

  // Copy thumbnails
  if (fs.existsSync(THUMBS_SRC)) {
    fs.mkdirSync(THUMBS_DST, { recursive: true });
    for (const file of fs.readdirSync(THUMBS_SRC)) {
      fs.copyFileSync(path.join(THUMBS_SRC, file), path.join(THUMBS_DST, file));
    }
  }

  // Collect all genres
  const allGenres = [...new Set(manifest.flatMap(t => t.genre))].sort();

  // Generate landing page
  const landingHTML = generateLandingPage(manifest, benchmarks);
  fs.writeFileSync(path.join(SITE_DIR, 'index.html'), landingHTML);

  // Generate gallery page
  const galleryHTML = generateGalleryPage(manifest, allGenres);
  fs.writeFileSync(path.join(GALLERY_DIR, 'index.html'), galleryHTML);

  console.log(`  _site/index.html — Landing page (${manifest.filter(t => t.demoUrl).length} game cards from manifest)`);
  console.log(`  _site/gallery/index.html — Gallery (${manifest.length} templates, ${allGenres.length} genres)`);
  if (benchmarks) console.log(`  Benchmarks section rendered (${benchmarks.length} items)`);
  if (stats.totalClones > 0) console.log(`  ${stats.totalClones} total clones tracked`);
  console.log('Done.');
}

main();
