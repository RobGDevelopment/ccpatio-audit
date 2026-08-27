require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const OAuthClient = require('intuit-oauth');

const clientId = process.env.QBO_CLIENT_ID ? process.env.QBO_CLIENT_ID.trim() : undefined;
const clientSecret = process.env.QBO_CLIENT_SECRET ? process.env.QBO_CLIENT_SECRET.trim() : undefined;

if (!clientId || !clientSecret) {
  console.error("❌ Missing QBO_CLIENT_ID or QBO_CLIENT_SECRET in .env file.");
  console.error("Please add them and try again.");
  process.exit(1);
}

console.log(`\n🔑 Initializing QBO Client...`);
console.log(`   Client ID Length: ${clientId.length}`);
console.log(`   Client Secret Length: ${clientSecret.length}\n`);

// Ensure the redirectUri exactly matches Intuit Developer dashboard configuration
const redirectUri = 'http://localhost:8000/callback';

// Explicitly instantiate with environment: 'sandbox' for Development keys
const oauthClient = new OAuthClient({
  clientId,
  clientSecret,
  environment: 'sandbox',
  redirectUri,
});

const server = http.createServer(async (req, res) => {
  if (req.url === '/') {
    const authUri = oauthClient.authorizeUri({
      scope: ['com.intuit.quickbooks.accounting'],
      state: 'ccpatio-audit-state',
    });
    res.writeHead(302, { Location: authUri });
    res.end();
  } else if (req.url.startsWith('/callback')) {
    try {
      const authResponse = await oauthClient.createToken(req.url);
      const realmId = oauthClient.getToken().realmId;
      console.log('\n✅ OAuth Token acquired successfully!');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <div style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1 style="color: #16A34A;">Authentication Successful!</h1>
          <p>You can close this tab and return to your terminal.</p>
        </div>
      `);
      
      await executeScrape(realmId);
    } catch (e) {
      console.error('\n❌ Error in OAuth callback:', e);
      if (e.authResponse && e.authResponse.json) {
        console.error('Details:', e.authResponse.json);
      }
      res.writeHead(500);
      res.end('Error parsing token. Check the terminal for logs.');
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

async function executeScrape(realmId) {
  console.log(`\n🔍 Starting read-only scrape for QBO Sandbox Realm ID: ${realmId}`);
  
  const baseUrl = 'https://sandbox-quickbooks.api.intuit.com';
    
  try {
    const blueprintsDir = path.resolve(__dirname, '../docs/blueprints');
    if (!fs.existsSync(blueprintsDir)) {
      fs.mkdirSync(blueprintsDir, { recursive: true });
    }

    // 1. Accounts Query
    console.log("Fetching Accounts (Active = true)...");
    const accountsRes = await oauthClient.makeApiCall({
      url: `${baseUrl}/v3/company/${realmId}/query?query=SELECT * FROM Account WHERE Active = true`,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    
    const accountsPath = path.join(blueprintsDir, 'qbo_accounts_raw.json');
    const accountsData = typeof accountsRes.getJson === 'function' 
      ? accountsRes.getJson() 
      : (accountsRes.json || JSON.parse(accountsRes.text || accountsRes.body || "{}"));
    fs.writeFileSync(accountsPath, JSON.stringify(accountsData, null, 2));
    console.log(`✅ Saved active Accounts to docs/blueprints/qbo_accounts_raw.json`);

    // 2. TaxCodes Query
    console.log("Fetching TaxCodes (Active = true)...");
    const taxCodesRes = await oauthClient.makeApiCall({
      url: `${baseUrl}/v3/company/${realmId}/query?query=SELECT * FROM TaxCode WHERE Active = true`,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    const taxCodesPath = path.join(blueprintsDir, 'qbo_taxcodes_raw.json');
    const taxCodesData = typeof taxCodesRes.getJson === 'function' 
      ? taxCodesRes.getJson() 
      : (taxCodesRes.json || JSON.parse(taxCodesRes.text || taxCodesRes.body || "{}"));
    fs.writeFileSync(taxCodesPath, JSON.stringify(taxCodesData, null, 2));
    console.log(`✅ Saved active TaxCodes to docs/blueprints/qbo_taxcodes_raw.json`);
    
    console.log("\n🎉 QBO Sandbox Scrape complete. Shutting down server...");
    process.exit(0);
    
  } catch (error) {
    console.error("\n❌ Failed during API call:", error);
    process.exit(1);
  }
}

server.listen(8000, () => {
  console.log(`
=========================================================
🚀 QBO OAuth Read-Only Scrape Server Running
=========================================================
1. Open your browser and navigate to:
   http://localhost:8000/

2. Log into Intuit and authorize the application.
3. Select the correct Sandbox tenant when prompted.
=========================================================
  `);
});
