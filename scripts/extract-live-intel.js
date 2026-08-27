const fs = require('fs');
const path = require('path');
const https = require('https');

// Helper to load simple .env
function loadEnv(file) {
  if (fs.existsSync(file)) {
    const envConfig = fs.readFileSync(file, 'utf8');
    envConfig.split('\n').forEach(line => {
      const match = line.match(/^([^#\s][^=]+)=(.*)$/);
      if (match) {
        process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
      }
    });
  }
}

loadEnv(path.join(__dirname, '../topology/.env'));
loadEnv(path.join(__dirname, '../.env'));

const ghlToken = process.env.GHL_TOKEN || process.env.GHL_API_KEY || process.env.GHL_PRIVATE_APP_TOKEN;
const katanaToken = process.env.KATANA_API_KEY || process.env.KATANA_TOKEN;

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function run() {
  const outDir = path.join(__dirname, '../docs/blueprints');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let missing = 0;

  if (!ghlToken) {
    console.log("Missing GHL_TOKEN or GHL_API_KEY in .env files.");
    missing++;
  } else {
    console.log("Executing GHL Scrape...");
    try {
      const pipelines = await httpsGet(
        "https://services.leadconnectorhq.com/opportunities/pipelines?locationId=5N8TZzI6eW96vKo0ffED",
        { "Authorization": `Bearer ${ghlToken}`, "Version": "2021-07-28", "Accept": "application/json" }
      );
      fs.writeFileSync(path.join(outDir, 'ghl_pipelines_raw.json'), pipelines);
      
      const customFields = await httpsGet(
        "https://services.leadconnectorhq.com/locations/5N8TZzI6eW96vKo0ffED/customFields",
        { "Authorization": `Bearer ${ghlToken}`, "Version": "2021-07-28", "Accept": "application/json" }
      );
      fs.writeFileSync(path.join(outDir, 'ghl_custom_fields_raw.json'), customFields);
      console.log("GHL Scrape complete.");
    } catch(e) {
      console.error("GHL Scrape failed:", e);
    }
  }

  if (!katanaToken) {
    console.log("Missing KATANA_API_KEY or KATANA_TOKEN in .env files.");
  } else {
    console.log("Executing Katana Scrape...");
    try {
      const variants = await httpsGet(
        "https://api.katanamrp.com/v1/variants",
        { "Authorization": `Bearer ${katanaToken}`, "Accept": "application/json" }
      );
      fs.writeFileSync(path.join(outDir, 'katana_variants_raw.json'), variants);
      
      const recipes = await httpsGet(
        "https://api.katanamrp.com/v1/recipes",
        { "Authorization": `Bearer ${katanaToken}`, "Accept": "application/json" }
      );
      fs.writeFileSync(path.join(outDir, 'katana_recipes_raw.json'), recipes);
      console.log("Katana Scrape complete.");
    } catch(e) {
      console.error("Katana Scrape failed:", e);
    }
  }

  if (missing > 0) {
    console.log("Some required tokens were missing. Please populate them and re-run.");
  }
}

run();
