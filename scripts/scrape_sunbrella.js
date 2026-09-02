#!/usr/bin/env node
/**
 * Sunbrella Fabric Swatch Scraper
 * ================================
 * Downloads Sunbrella fabric swatch images and writes a JSON manifest for the
 * CC Patio R3F configurator (`3d-sandbox/src/generated/fabric-database.json`).
 *
 * Target sources (in priority order):
 *   1. Glen Raven CDN swatches — predictable, high-res showroom tiles:
 *      https://cdn.glenraven.net/sunbrella/_img/showroom/fabrics/Swatch/{SKU}.jpg
 *   2. Sunbrella.com product pages — Magento catalog images when CDN misses.
 *   3. Sunbrella.com browse/category pages — SSR HTML with name + SKU (not the
 *      JS-only Fabric Finder SPA, which does not render fabric rows server-side).
 *
 * Why Fabric Finder often fails for headless scrape:
 *   https://www.sunbrella.com/en-us/fabric/fabric-finder is client-rendered; curl
 *   and cheerio see marketing shell only. Browse pages under /browse-fabrics/ do
 *   include product links with embedded SKUs.
 *
 * Dependencies (install from repo root):
 *   npm install cheerio axios sharp
 *   Optional: npm install colorthief  (dominant color; sharp fallback built-in)
 *
 * Usage:
 *   node scripts/scrape_sunbrella.js                     # live browse scrape
 *   node scripts/scrape_sunbrella.js --mode=seed         # 10 demo fabrics
 *   node scripts/scrape_sunbrella.js --mode=urls --urls=scripts/data/sunbrella-urls.txt
 *   node scripts/scrape_sunbrella.js --limit=25 --size=512
 *
 * Environment:
 *   SUNBRELLA_URLS_FILE=path/to/urls.txt
 *   SUNBRELLA_SCRAPE_MODE=seed|live|urls
 *
 * PBR micro-texture guidance (universal normal + roughness, not per-swatch):
 *   - Poly Haven canvas: https://polyhaven.com/a/fabric_pattern_07
 *   - Poly Haven denim:  https://polyhaven.com/a/denim_fabric
 *   - ambientCG Fabric:  https://ambientcg.com/list?type=Material&category=Fabric
 *   - Search queries:    "seamless canvas fabric normal map site:polyhaven.com"
 *                        "woven fabric roughness map site:ambientcg.com"
 *   CC Patio ships shared maps at:
 *     /textures/canvas_normal.jpg
 *     /textures/canvas_roughness.jpg
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

/** Optional sharp resize/crop; script runs without it but skips tile normalization. */
let sharp;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

/** Optional colorthief; dominant color falls back to sharp pixel average. */
let ColorThief;
try {
  ColorThief = require('colorthief');
} catch {
  ColorThief = null;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..');
const SWATCH_DIR = path.join(REPO_ROOT, '3d-sandbox/public/textures/swatches');
const MANIFEST_PATH = path.join(REPO_ROOT, '3d-sandbox/src/generated/fabric-database.json');
const DEFAULT_URLS_FILE = path.join(__dirname, 'data/sunbrella-urls.txt');
const DEFAULT_CATEGORIES_FILE = path.join(__dirname, 'data/sunbrella-categories.txt');

const USER_AGENT = 'CC-Patio-Fabric-Scraper/1.0 (+https://github.com/ccpatio; configurator asset pipeline)';

// ---------------------------------------------------------------------------
// Seed/demo fabrics — always available when live scrape is blocked or for CI
// ---------------------------------------------------------------------------

const SEED_FABRICS = [
  { name: 'Canvas Black', sku: '5408-0000' },
  { name: 'Canvas Natural', sku: '5435-0000' },
  { name: 'Canvas Air Blue', sku: '5410-0000' },
  { name: 'Canvas White', sku: '57003-0000' },
  { name: 'Canvas Navy', sku: '5439-0000' },
  { name: 'Canvas Jockey Red', sku: '5453-0000' },
  { name: 'Canvas Coal', sku: '5489-0000' },
  { name: 'Spectrum Carbon', sku: '48085-0000' },
  { name: 'Cabana Classic', sku: '58030-0000' },
  { name: 'Canvas Brick', sku: '5422-0000' },
];

/** Default browse categories when scraping live (outdoor upholstery focus). */
const DEFAULT_BROWSE_URLS = [
  'https://www.sunbrella.com/browse-fabrics/fabrics-by-use/outdoor-upholstery',
  'https://www.sunbrella.com/browse-fabrics/fabrics-by-use/all-fabrics/solids',
  'https://www.sunbrella.com/browse-fabrics/fabrics-by-use/all-fabrics/stripes',
  'https://www.sunbrella.com/browse-fabrics/fabrics-by-use/all-fabrics/black--solids',
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    mode: process.env.SUNBRELLA_SCRAPE_MODE || 'live',
    urlsFile: process.env.SUNBRELLA_URLS_FILE || DEFAULT_URLS_FILE,
    limit: Infinity,
    size: 1024,
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--mode=')) opts.mode = arg.split('=')[1];
    else if (arg.startsWith('--urls=')) opts.urlsFile = path.resolve(arg.split('=')[1]);
    else if (arg.startsWith('--limit=')) opts.limit = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--size=')) opts.size = parseInt(arg.split('=')[1], 10);
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node scripts/scrape_sunbrella.js [options]

  --mode=live|seed|urls   Scrape strategy (default: live, or SUNBRELLA_SCRAPE_MODE)
  --urls=PATH             Line-based URL list for mode=urls
  --limit=N               Max fabrics to download
  --size=512|1024         Square output dimension (requires sharp)
  --dry-run               Discover fabrics only; skip downloads
`);
      process.exit(0);
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Slugify fabric name → filename id, e.g. "Canvas Black" → "canvas-black". */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

/** Heuristic: stripes, cabana, check, plaid, etc. → "pattern", else "solid". */
function inferFabricType(name) {
  return /\b(stripe|striped|cabana|check|plaid|print|pattern|geo|tile|wave|pique|jacquard|basket|block|medallion|tweed|heather|maze|band|border)\b/i.test(
    name,
  )
    ? 'pattern'
    : 'solid';
}

/** Extract Sunbrella SKU from product URL slug. */
function skuFromHref(href) {
  const match = href.match(/(\d{4,6}-\d{4})(?:[^0-9]|$)/);
  return match ? match[1] : null;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const http = axios.create({
  timeout: 30000,
  headers: { 'User-Agent': USER_AGENT },
  maxRedirects: 5,
  validateStatus: (s) => s >= 200 && s < 400,
});

/** Glen Raven showroom swatch — best source when available. */
function glenRavenSwatchUrl(sku) {
  return `https://cdn.glenraven.net/sunbrella/_img/showroom/fabrics/Swatch/${sku}.jpg`;
}

/** Glen Raven rasterizer — optional upscale/crop server-side. */
function glenRavenRasterUrl(sku, size) {
  const src = `/sunbrella/_img/showroom/fabrics/Swatch/${sku}.jpg`;
  return `https://cdn.glenraven.net/_img/_rasterize.php?src=${encodeURIComponent(src)}&w=${size}&h=${size}`;
}

async function urlExists(url) {
  try {
    const res = await http.head(url);
    const ct = res.headers['content-type'] || '';
    return ct.includes('image');
  } catch {
    return false;
  }
}

async function downloadBuffer(url) {
  const res = await http.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

// ---------------------------------------------------------------------------
// Discovery — browse pages, product pages, seed, url list
// ---------------------------------------------------------------------------

/**
 * Parse Sunbrella browse/category HTML for fabric name + SKU + product URL.
 * Paginates with Magento-style ?p=N until no new SKUs appear.
 */
async function scrapeBrowseCategory(baseUrl, maxPages = 20) {
  const seen = new Map();
  let emptyStreak = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const url = page === 1 ? baseUrl : `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}p=${page}`;
    let html;
    try {
      const res = await http.get(url);
      html = res.data;
    } catch (err) {
      console.warn(`  [browse] failed page ${page} of ${baseUrl}: ${err.message}`);
      break;
    }

    const $ = cheerio.load(html);
    let added = 0;

    $('a[href*="sunbrella.com/sunbrella-"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const sku = skuFromHref(href);
      if (!sku) return;

      const name = $(el).text().trim();
      if (!name || name === 'View Fabric' || name.length < 3) return;
      if (seen.has(sku)) return;

      seen.set(sku, { name, sku, productUrl: href.split('?')[0] });
      added += 1;
    });

    if (added === 0) {
      emptyStreak += 1;
      if (emptyStreak >= 2) break;
    } else {
      emptyStreak = 0;
    }

    await sleep(400);
  }

  return [...seen.values()];
}

/** Load category URLs from file or built-in defaults. */
function loadBrowseUrls() {
  const fromFile = readLines(DEFAULT_CATEGORIES_FILE);
  return fromFile.length ? fromFile : DEFAULT_BROWSE_URLS;
}

/**
 * Parse a Sunbrella product page for title, SKU, and highest-res swatch image.
 * Used as fallback when Glen Raven CDN returns 404.
 */
async function scrapeProductPage(productUrl) {
  const res = await http.get(productUrl);
  const html = res.data;
  const $ = cheerio.load(html);

  const name =
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.replace(/\s*\(.*\)$/, '').trim() ||
    'Unknown Fabric';

  const sku =
    skuFromHref(productUrl) ||
    [...html.matchAll(/SKU\s+(\d{4,6}-\d{4})/gi)].map((m) => m[1])[0] ||
    null;

  const imageCandidates = [];
  $('meta[property="og:image"]').each((_, el) => {
    const content = $(el).attr('content');
    if (content) imageCandidates.push(content);
  });

  [...html.matchAll(/https?:\/\/www\.sunbrella\.com\/media\/catalog\/product\/[^"'\s]+\.(?:jpg|jpeg|png)/gi)].forEach(
    (m) => imageCandidates.push(m[0]),
  );

  // Prefer catalog swatch tiles (5/4/{sku}_*) over lifestyle shots
  const swatchLike = imageCandidates.find(
    (u) => sku && u.includes(sku) && /\/5\/4\//.test(u),
  );
  const imageUrl = swatchLike || imageCandidates.find((u) => sku && u.includes(sku)) || imageCandidates[0] || null;

  return { name, sku, productUrl, imageUrl };
}

/** mode=urls — each line: product URL, or "Name|SKU", or JSON object. */
async function parseUrlsFile(filePath) {
  const lines = readLines(filePath);
  const fabrics = [];

  for (const line of lines) {
    if (line.startsWith('{')) {
      try {
        fabrics.push(JSON.parse(line));
        continue;
      } catch {
        /* fall through */
      }
    }

    if (line.includes('|')) {
      const [name, sku] = line.split('|').map((s) => s.trim());
      fabrics.push({ name, sku });
      continue;
    }

    if (/sunbrella\.com/.test(line)) {
      fabrics.push(await scrapeProductPage(line));
      await sleep(300);
      continue;
    }

    console.warn(`  [urls] skipping unrecognized line: ${line}`);
  }

  return fabrics;
}

async function discoverFabrics(opts) {
  if (opts.mode === 'seed') {
    console.log(`[discover] seed mode — ${SEED_FABRICS.length} demo fabrics`);
    return { fabrics: SEED_FABRICS.map((f) => ({ ...f })), source: 'seed' };
  }

  if (opts.mode === 'urls') {
    console.log(`[discover] urls mode — reading ${opts.urlsFile}`);
    return { fabrics: await parseUrlsFile(opts.urlsFile), source: 'urls' };
  }

  // live mode
  const browseUrls = loadBrowseUrls();
  console.log(`[discover] live mode — ${browseUrls.length} browse categories`);
  const bySku = new Map();

  for (const categoryUrl of browseUrls) {
    console.log(`  scraping ${categoryUrl}`);
    try {
      const items = await scrapeBrowseCategory(categoryUrl);
      for (const item of items) {
        if (!bySku.has(item.sku)) bySku.set(item.sku, item);
      }
      console.log(`    → ${items.length} fabrics (${bySku.size} unique total)`);
    } catch (err) {
      console.warn(`    failed: ${err.message}`);
    }
    await sleep(500);
  }

  if (bySku.size === 0) {
    console.warn('[discover] live scrape returned 0 fabrics — falling back to seed mode');
    console.warn('  Reason: Sunbrella may block datacenter IPs or changed HTML structure.');
    return { fabrics: SEED_FABRICS.map((f) => ({ ...f })), source: 'seed-fallback' };
  }

  return { fabrics: [...bySku.values()], source: 'live' };
}

// ---------------------------------------------------------------------------
// Image download + processing
// ---------------------------------------------------------------------------

/** Resolve best swatch URL for a SKU, trying CDN then product page. */
async function resolveSwatchUrl(fabric, size) {
  const { sku, productUrl, imageUrl } = fabric;
  if (!sku) return imageUrl || null;

  const cdn = glenRavenSwatchUrl(sku);
  if (await urlExists(cdn)) {
    return size && sharp ? glenRavenRasterUrl(sku, size) : cdn;
  }

  if (imageUrl && (await urlExists(imageUrl))) return imageUrl;

  if (productUrl) {
    const page = await scrapeProductPage(productUrl);
    fabric.name = fabric.name || page.name;
    if (page.imageUrl && (await urlExists(page.imageUrl))) return page.imageUrl;
  }

  // Last resort: Magento path pattern (hash segment varies but often resolves)
  const magentoGuess = `https://www.sunbrella.com/media/catalog/product/5/4/${sku}_53578623_1200.jpg`;
  if (await urlExists(magentoGuess)) return magentoGuess;

  return null;
}

/** Dominant color as #RRGGBB — colorthief if present, else sharp 64px average. */
async function extractHexFallback(imagePath) {
  if (ColorThief) {
    try {
      const [r, g, b] = await ColorThief.getColor(imagePath);
      return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    } catch {
      /* fall through */
    }
  }

  if (!sharp) return '';

  try {
    const { data, info } = await sharp(imagePath)
      .resize(64, 64, { fit: 'cover' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let r = 0;
    let g = 0;
    let b = 0;
    const pixels = info.width * info.height;
    for (let i = 0; i < data.length; i += info.channels) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    r = Math.round(r / pixels);
    g = Math.round(g / pixels);
    b = Math.round(b / pixels);
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  } catch {
    return '';
  }
}

/** Crop/resize to square tile for repeat mapping in Three.js. */
async function normalizeSwatch(inputPath, outputPath, size) {
  if (!sharp) {
    if (inputPath !== outputPath) fs.copyFileSync(inputPath, outputPath);
    return;
  }

  await sharp(inputPath)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(outputPath);
}

async function processFabric(fabric, opts) {
  const id = slugify(fabric.name);
  const filename = `${id}.jpg`;
  const outputPath = path.join(SWATCH_DIR, filename);
  const texturePath = `/textures/swatches/${filename}`;

  const swatchUrl = await resolveSwatchUrl(fabric, opts.size);
  if (!swatchUrl) {
    console.warn(`  [skip] no swatch URL for ${fabric.name} (${fabric.sku})`);
    return null;
  }

  if (opts.dryRun) {
    console.log(`  [dry-run] ${fabric.name} ← ${swatchUrl}`);
    return {
      id,
      name: fabric.name,
      sku: fabric.sku || '',
      type: inferFabricType(fabric.name),
      hexFallback: '',
      texturePath,
      sourceUrl: swatchUrl,
    };
  }

  const tmpPath = path.join(SWATCH_DIR, `.tmp-${id}.jpg`);
  try {
    const buf = await downloadBuffer(swatchUrl);
    fs.writeFileSync(tmpPath, buf);
    await normalizeSwatch(tmpPath, outputPath, opts.size);
    const hexFallback = await extractHexFallback(outputPath);

    console.log(`  [ok] ${fabric.name} → ${filename} (${hexFallback || 'no hex'})`);

    return {
      id,
      name: fabric.name,
      sku: fabric.sku || '',
      type: inferFabricType(fabric.name),
      hexFallback,
      texturePath,
      sourceUrl: swatchUrl,
    };
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function writeManifest(fabrics, meta) {
  ensureDir(path.dirname(MANIFEST_PATH));

  const payload = {
    generatedAt: new Date().toISOString(),
    source: meta.source,
    count: fabrics.length,
    pbrMicroTextures: {
      normal: '/textures/canvas_normal.jpg',
      roughness: '/textures/canvas_roughness.jpg',
      note: 'Shared woven canvas micro-detail; per-fabric color/pattern comes from swatch map.',
    },
    fabrics: fabrics.map(({ id, name, sku, type, hexFallback, texturePath }) => ({
      id,
      name,
      sku,
      type,
      hexFallback,
      texturePath,
    })),
  };

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`\n[manifest] wrote ${MANIFEST_PATH} (${fabrics.length} fabrics)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log('Sunbrella swatch scraper');
  console.log(`  mode=${opts.mode} limit=${opts.limit} size=${opts.size} sharp=${!!sharp}`);

  ensureDir(SWATCH_DIR);
  ensureDir(path.dirname(MANIFEST_PATH));

  let { fabrics: discovered, source } = await discoverFabrics(opts);
  if (Number.isFinite(opts.limit)) discovered = discovered.slice(0, opts.limit);

  console.log(`\n[download] processing ${discovered.length} fabrics…`);
  const results = [];

  for (const fabric of discovered) {
    try {
      const entry = await processFabric(fabric, opts);
      if (entry) results.push(entry);
      await sleep(250);
    } catch (err) {
      console.warn(`  [error] ${fabric.name}: ${err.message}`);
    }
  }

  if (results.length === 0) {
    console.error('\n[fatal] no fabrics downloaded. Try --mode=seed or check network.');
    process.exit(1);
  }

  writeManifest(results, { source });
  console.log(`\nDone. ${results.length} swatches in ${SWATCH_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
