require('dotenv').config();
const fs = require('fs');
const path = require('path');

const apiKey = process.env.KATANA_API_KEY;

if (!apiKey) {
  console.error("❌ Missing KATANA_API_KEY in .env file.");
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${apiKey}`,
  'Accept': 'application/json'
};

async function fetchKatana(endpoint) {
  const url = `https://api.katanamrp.com/v1${endpoint}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Katana API Error: ${res.status} ${res.statusText} at ${url}`);
  }
  return res.json();
}

async function run() {
  try {
    console.log("🔍 Fetching Katana Variants (Products)...");
    // Limit to 50 for schema baseline extraction
    const variantsRes = await fetchKatana('/variants?limit=50');
    const variants = variantsRes.data || variantsRes;

    console.log("🔍 Fetching Katana Recipes (BOMs)...");
    const recipesRes = await fetchKatana('/recipes?limit=50');
    const recipes = recipesRes.data || recipesRes;

    const payload = {
      meta: {
        timestamp: new Date().toISOString(),
      },
      variants: Array.isArray(variants) ? variants : (variants ? [variants] : []),
      recipes: Array.isArray(recipes) ? recipes : (recipes ? [recipes] : [])
    };

    const outDir = path.resolve(__dirname, '../docs/blueprints');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    const outPath = path.join(outDir, 'katana_baseline_raw.json');
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`✅ Success! Data saved to docs/blueprints/katana_baseline_raw.json`);

  } catch (err) {
    console.error("❌ Katana Scrape failed:", err.message);
    process.exit(1);
  }
}

run();
