require('dotenv').config();
const fs = require('fs');
const path = require('path');

const token = process.env.GHL_TOKEN;
const locationId = process.env.GHL_LOCATION_ID;

if (!token || !locationId) {
  console.error("❌ Missing GHL_TOKEN or GHL_LOCATION_ID in .env file.");
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${token}`,
  'Version': '2021-07-28',
  'Accept': 'application/json'
};

async function fetchGHL(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GHL API Error: ${res.status} ${res.statusText} at ${url}`);
  }
  return res.json();
}

async function run() {
  try {
    console.log("🔍 Fetching Custom Fields...");
    const customFieldsRes = await fetchGHL(`https://services.leadconnectorhq.com/locations/${locationId}/customFields`);
    const customFields = customFieldsRes.customFields || [];

    console.log("🔍 Fetching Pipelines...");
    const pipelinesRes = await fetchGHL(`https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${locationId}`);
    const pipelines = pipelinesRes.pipelines || [];

    // Identify target pipelines
    const targetPipelineNames = ["Scottsdale", "Solana Beach"];
    let targetPipelineIds = pipelines
      .filter(p => targetPipelineNames.some(name => p.name.includes(name)))
      .map(p => p.id);

    console.log(`🔍 Found ${targetPipelineIds.length} target pipelines for Opportunities.`);
    
    let opportunities = [];
    if (targetPipelineIds.length > 0) {
      console.log("🔍 Fetching Sample Opportunities...");
      for (const pId of targetPipelineIds) {
        const oppsRes = await fetchGHL(`https://services.leadconnectorhq.com/opportunities/search?location_id=${locationId}&pipeline_id=${pId}&limit=2`);
        if (oppsRes.opportunities) {
          opportunities.push(...oppsRes.opportunities);
        }
      }
    } else {
        console.log("⚠️ Target pipelines not found by name, fetching general recent opportunities as fallback.");
        const oppsRes = await fetchGHL(`https://services.leadconnectorhq.com/opportunities/search?location_id=${locationId}&limit=2`);
        if (oppsRes.opportunities) {
          opportunities.push(...oppsRes.opportunities);
        }
    }

    const payload = {
      meta: {
        timestamp: new Date().toISOString(),
        locationId
      },
      customFields,
      pipelines,
      sampleOpportunities: opportunities
    };

    const outDir = path.resolve(__dirname, '../docs/blueprints');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    const outPath = path.join(outDir, 'ghl_wiring_baseline_raw.json');
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`✅ Success! Data saved to docs/blueprints/ghl_wiring_baseline_raw.json`);

  } catch (err) {
    console.error("❌ Scrape failed:", err.message);
    process.exit(1);
  }
}

run();
