import { v4 as uuidv4 } from "uuid";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { getDb } from "../../src/server/db/client";
import { sku_mappings as skuMappings } from "../../src/server/db/schema";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import net from "net";

async function isPortInUse(port: number) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

async function run() {
  const uuid = uuidv4();
  const fakeSku = `QA-TEST-${uuid.substring(0, 8).toUpperCase()}`;
  console.log(`\n🚨 ZERO-TRUST QA PROTOCOL: INITIATING LIFECYCLE QA 🚨`);
  console.log(`Generated Test UUID: ${uuid} (SKU: ${fakeSku})`);

  let serverProcess: any = null;
  const targetUrl = "http://localhost:3000";

  const portUsed = await isPortInUse(3000);
  let isServerStartedByUs = false;

  if (!portUsed) {
    console.log(`Starting Next.js production server on port 3000...`);
    const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
    serverProcess = spawn(cmd, ["run", "start"], { stdio: "ignore", shell: true });
    isServerStartedByUs = true;
    
    let booted = false;
    for(let i = 0; i < 30; i++) {
       try {
          const r = await fetch(targetUrl);
          if (r.ok) {
            booted = true;
            break;
          }
       } catch(e) {}
       await new Promise(r => setTimeout(r, 1000));
    }
    if (!booted) {
      console.error("Failed to boot Next.js server. Tests aborted.");
      process.exit(1);
    }
    console.log("Server booted successfully.");
  } else {
    console.log("Server already running on port 3000, using it...");
  }

  try {
    console.log(`\n[1/4] FIRE THE APPLICATION LAYER (HTTP POST)`);
    const postRes = await fetch(`${targetUrl}/api/qa-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid })
    });
    if (!postRes.ok) throw new Error(`POST failed with status ${postRes.status}`);
    console.log(`✅ Application Layer Responded OK`);

    console.log(`\n[2/4] THE DRIZZLE REFEREE (Database Proof of Write)`);
    const db = getDb();
    const row = await db.query.sku_mappings.findFirst({
      where: eq(skuMappings.global_sku, fakeSku)
    });
    if (!row || row.original_name !== `QA Test ${uuid}`) {
      throw new Error(`Drizzle query failed to find the exact UUID in database.`);
    }
    console.log(`✅ Drizzle Verified Write: ${row.global_sku}`);

    console.log(`\n[3/4] THE CACHE CHECK (Proof of Read)`);
    const getRes = await fetch(`${targetUrl}/api/qa-test?sku=${fakeSku}`);
    const json = await getRes.json();
    if (!json.ok || !json.data || json.data.original_name !== `QA Test ${uuid}`) {
      throw new Error("UUID not found in Next.js API response. Fetch failed!");
    }
    console.log(`✅ Cache Check Passed! UUID found via Next.js API.`);

    console.log(`\n[4/4] CLEANUP (Database Idempotency)`);
    await db.delete(skuMappings).where(eq(skuMappings.global_sku, fakeSku));
    const verifyDel = await db.query.sku_mappings.findFirst({
      where: eq(skuMappings.global_sku, fakeSku)
    });
    if (verifyDel) throw new Error("Failed to delete test row.");
    console.log(`✅ Cleanup Complete. Record deleted.\n`);
    
    console.log(`🎉 ALL PHASES PASSED. QA LIFECYCLE COMPLETE.`);
  } catch (error: any) {
    console.error(`\n❌ QA LIFECYCLE FAILED: ${error.message}`);
    process.exit(1);
  } finally {
    if (isServerStartedByUs) {
      console.log(`Shutting down Next.js server via API...`);
      try {
        await fetch(`${targetUrl}/api/qa-test`, { method: "DELETE" });
      } catch (e) {}
    } else {
       console.log(`Leaving server running since it was already active.`);
    }
    // Force exit to cleanup hanging child processes in Windows
    setTimeout(() => process.exit(0), 1000);
  }
}
run();
