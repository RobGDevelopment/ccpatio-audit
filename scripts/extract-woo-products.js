require('dotenv').config();
const fs = require('fs');
const path = require('path');

const consumerKey = process.env.WC_CONSUMER_KEY;
const consumerSecret = process.env.WC_CONSUMER_SECRET;

// Assuming ccpatio.com for this audit since it wasn't specified
const WOO_URL = process.env.WOO_URL || 'https://ccpatio.com';

if (!consumerKey || !consumerSecret) {
  console.error("❌ Missing WC_CONSUMER_KEY or WC_CONSUMER_SECRET in .env file.");
  process.exit(1);
}

const authHeader = 'Basic ' + Buffer.from(consumerKey + ':' + consumerSecret).toString('base64');
const headers = {
  'Authorization': authHeader,
  'Accept': 'application/json'
};

async function fetchWoo(endpoint) {
  const url = `${WOO_URL}${endpoint}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`WooCommerce API Error: ${res.status} ${res.statusText} at ${url}`);
  }
  return res.json();
}

async function run() {
  try {
    console.log(`🔍 Fetching Standard Products from ${WOO_URL}...`);
    // Fetch 2 variable products
    const products = await fetchWoo('/wp-json/wc/v3/products?type=variable&per_page=2');
    
    let variations = [];
    if (products.length > 0) {
        const targetProductId = products[0].id;
        console.log(`🔍 Fetching Variations for Product ID ${targetProductId}...`);
        variations = await fetchWoo(`/wp-json/wc/v3/products/${targetProductId}/variations`);
    }

    const payload = {
      meta: {
        timestamp: new Date().toISOString(),
        source: WOO_URL
      },
      products,
      variations
    };

    const outDir = path.resolve(__dirname, '../docs/blueprints');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    const outPath = path.join(outDir, 'woo_baseline_raw.json');
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`✅ Success! Data saved to docs/blueprints/woo_baseline_raw.json`);

  } catch (err) {
    console.error("❌ WooCommerce Scrape failed:", err.message);
    process.exit(1);
  }
}

run();
