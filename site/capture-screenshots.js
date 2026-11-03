#!/usr/bin/env node

/**
 * Capture thumbnails for gallery templates.
 *
 * For each manifest entry missing a thumbnail:
 *   1. Check for an existing QA screenshot in <source>/output/ — resize to 400x225
 *   2. Otherwise, build the game, serve dist/ with a static server,
 *      launch headless Chromium, interact briefly, and screenshot
 *
 * Usage:
 *   node site/capture-screenshots.js            # capture missing only
 *   node site/capture-screenshots.js --force     # recapture all
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(__dirname, 'manifest.json');
const THUMBS_DIR = path.join(__dirname, 'thumbnails');

const WIDTH = 400;
const HEIGHT = 225;

async function main() {
  const sharp = (await import('sharp')).default;

  const force = process.argv.includes('--force');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));

  if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true });

  let captured = 0;
  let skipped = 0;

  for (const entry of manifest) {
    const thumbPath = path.join(__dirname, entry.thumbnail);

    if (!force && fs.existsSync(thumbPath)) {
      console.log(`  SKIP  ${entry.id} (thumbnail exists)`);
      skipped++;
      continue;
    }

    const sourceDir = path.join(ROOT, entry.source);
    if (!fs.existsSync(sourceDir)) {
      console.log(`  MISS  ${entry.id} (source dir not found: ${entry.source})`);
      continue;
    }

    // Strategy 1: Reuse existing QA screenshot
    const qaScreenshot = findQAScreenshot(sourceDir);
    if (qaScreenshot) {
      console.log(`  RESIZE ${entry.id} <- ${path.relative(ROOT, qaScreenshot)}`);
      await sharp(qaScreenshot)
        .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'center' })
        .png({ quality: 85 })
        .toFile(thumbPath);
      captured++;
      continue;
    }

    // Strategy 2: Boot the game and take a screenshot
    const distDir = path.join(sourceDir, 'dist');
    if (!fs.existsSync(distDir)) {
      // Try to build
      const pkgJson = path.join(sourceDir, 'package.json');
      if (fs.existsSync(pkgJson)) {
        console.log(`  BUILD ${entry.id}`);
        try {
          if (!fs.existsSync(path.join(sourceDir, 'node_modules'))) {
            execSync('npm install', { cwd: sourceDir, stdio: 'ignore', timeout: 60000 });
          }
          execSync('npm run build', { cwd: sourceDir, stdio: 'ignore', timeout: 60000 });
        } catch (e) {
          console.log(`  FAIL  ${entry.id} (build failed: ${e.message})`);
          await createPlaceholder(sharp, thumbPath, entry);
          captured++;
          continue;
        }
      }
    }

    if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, 'index.html'))) {
      console.log(`  PLACEHOLDER ${entry.id} (no dist/)`);
      await createPlaceholder(sharp, thumbPath, entry);
      captured++;
      continue;
    }

    // Serve and screenshot
    console.log(`  CAPTURE ${entry.id}`);
    try {
      await captureFromDist(distDir, thumbPath, entry, sharp);
      captured++;
    } catch (e) {
      console.log(`  FAIL  ${entry.id} (capture failed: ${e.message})`);
      await createPlaceholder(sharp, thumbPath, entry);
      captured++;
    }
  }

  console.log(`\nDone: ${captured} captured, ${skipped} skipped, ${manifest.length} total`);
}

function findQAScreenshot(sourceDir) {
  const outputDir = path.join(sourceDir, 'output');
  if (!fs.existsSync(outputDir)) return null;

  // Prefer qa-gameplay.png, then any qa-*.png
  const preferred = path.join(outputDir, 'qa-gameplay.png');
  if (fs.existsSync(preferred)) return preferred;

  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('qa-') && f.endsWith('.png'))
    .sort();

  return files.length > 0 ? path.join(outputDir, files[0]) : null;
}

async function captureFromDist(distDir, thumbPath, entry, sharp) {
  const http = require('http');
  const { chromium } = await import('../scripts/cdp.mjs');

  // Simple static file server
  const server = http.createServer((req, res) => {
    let filePath = path.join(distDir, req.url === '/' ? 'index.html' : req.url);
    // Remove query strings
    filePath = filePath.split('?')[0];

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
      '.glb': 'model/gltf-binary',
      '.gltf': 'model/gltf+json',
      '.wasm': 'application/wasm',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
    };

    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  const port = 9500 + Math.floor(Math.random() * 500);
  await new Promise(resolve => server.listen(port, resolve));

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 800, height: 450 } });

    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);

    // Try to start the game
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);

    const screenshotBuffer = await page.screenshot({ type: 'png' });
    await browser.close();

    await sharp(screenshotBuffer)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'center' })
      .png({ quality: 85 })
      .toFile(thumbPath);
  } finally {
    server.close();
  }
}

async function createPlaceholder(sharp, thumbPath, entry) {
  // Generate a colored placeholder with the game name as SVG text
  const colors = {
    '2d': { bg: '#0a1a0a', accent: '#4ade80' },
    '3d': { bg: '#1a0a0a', accent: '#ff4444' },
  };
  const c = colors[entry.engine] || colors['2d'];

  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${c.bg}"/>
    <rect x="0" y="0" width="100%" height="100%" fill="url(#grad)" opacity="0.5"/>
    <defs>
      <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${c.accent}" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="${c.bg}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <text x="50%" y="45%" text-anchor="middle" dominant-baseline="middle"
          font-family="system-ui, sans-serif" font-size="20" font-weight="700"
          fill="${c.accent}">${escapeXml(entry.name)}</text>
    <text x="50%" y="62%" text-anchor="middle" dominant-baseline="middle"
          font-family="system-ui, sans-serif" font-size="12"
          fill="#94a3b8">${entry.engine.toUpperCase()} ${entry.genre[0] || ''}</text>
  </svg>`;

  await sharp(Buffer.from(svg))
    .png()
    .toFile(thumbPath);
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
