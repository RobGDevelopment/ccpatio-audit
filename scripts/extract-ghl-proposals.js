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
    console.log("🔍 Fetching advanced-stage Opportunities...");
    // Scottsdale Pipeline ID: hu9VUgAxItleNsiZRIYn
    const oppsRes = await fetchGHL(`https://services.leadconnectorhq.com/opportunities/search?location_id=${locationId}&pipeline_id=hu9VUgAxItleNsiZRIYn&limit=20`);
    const allOpps = oppsRes.opportunities || [];
    
    // Attempt to grab opps in advanced stages (e.g., 07.S -> a43ddce2-44e8-4f0a-b506-d927d50aee4a)
    // Or fallback to just any opps if there are none in that stage
    let targetOpps = allOpps.filter(o => o.pipelineStageId === 'a43ddce2-44e8-4f0a-b506-d927d50aee4a');
    if (targetOpps.length === 0) {
       targetOpps = allOpps.filter(o => o.contactId);
    }
    const opps = targetOpps.slice(0, 5);
    
    console.log(`🔍 Found ${opps.length} opportunities for proposal audit.`);

    const results = [];

    for (const opp of opps) {
      const contactId = opp.contactId;
      console.log(`🔍 Fetching details for Contact ${contactId}...`);
      
      let notes = [];
      try {
         const notesRes = await fetchGHL(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`);
         notes = notesRes.notes || [];
      } catch (e) {
         console.log(`⚠️ Could not fetch notes for ${contactId}: ${e.message}`);
      }
      
      let contactData = null;
      try {
         contactData = await fetchGHL(`https://services.leadconnectorhq.com/contacts/${contactId}`);
      } catch (e) {
         console.log(`⚠️ Could not fetch contact details for ${contactId}: ${e.message}`);
      }

      results.push({
        opportunityId: opp.id,
        opportunityName: opp.name,
        pipelineStageId: opp.pipelineStageId,
        contactId,
        contactCustomFields: contactData ? (contactData.contact.customFields || []) : [],
        notes
      });
    }

    const payload = {
      meta: {
        timestamp: new Date().toISOString(),
        locationId
      },
      audit: results
    };

    const outDir = path.resolve(__dirname, '../docs/blueprints');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    const outPath = path.join(outDir, 'ghl_proposals_baseline.json');
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`✅ Success! Data saved to docs/blueprints/ghl_proposals_baseline.json`);

  } catch (err) {
    console.error("❌ Scrape failed:", err.message);
    process.exit(1);
  }
}

run();
