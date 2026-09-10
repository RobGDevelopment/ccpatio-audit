import { v4 as uuidv4 } from "uuid";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { getDb, closeDb } from "../../src/server/db/client";
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

  async function waitForHealthyHome(label: string): Promise<boolean> {
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(targetUrl);
        if (r.ok) {
          const html = await r.text();
          // Stale `next start` after qa:clean deletes `.next` serves crash HTML.
          if (
            !html.includes("This page couldn’t load") &&
            !html.includes("This page couldn't load")
          ) {
            console.log(label);
            return true;
          }
        }
      } catch {
        /* still booting */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  function spawnProdServer() {
    const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(cmd, ["run", "start"], {
      stdio: "ignore",
      shell: true,
      detached: true,
      windowsHide: true,
      env: {
        ...process.env,
        // Same mirror + God Mode contract Playwright webServer uses, so
        // reuseExistingServer during qa:phase3-e2e still hits a correct stack.
        E2E_GODMODE_SECRET:
          process.env.E2E_GODMODE_SECRET || "local-e2e-godmode-secret",
        KATANA_E2E_MIRROR: process.env.KATANA_E2E_MIRROR || "true",
        KATANA_API_BASE:
          process.env.KATANA_API_BASE ||
          "http://127.0.0.1:3000/api/qa/katana-mirror/v1",
        KATANA_API_KEY:
          process.env.KATANA_API_KEY ||
          process.env.KATANA_PERSONAL_ACCESS_TOKEN ||
          "e2e-mirror-token",
      },
    });
    child.unref();
    return child;
  }

  let portUsed = await isPortInUse(3000);
  let isServerStartedByUs = false;

  if (portUsed) {
    const healthy = await waitForHealthyHome(
      "Server already running on port 3000 and healthy — reusing it...",
    );
    if (!healthy) {
      console.warn(
        "Port 3000 is occupied by an unhealthy server (likely stale after qa:clean). Aborting reuse.",
      );
      console.error(
        "Free port 3000 (stop the old Next process) and re-run qa:lifecycle.",
      );
      process.exit(1);
    }
  } else {
    console.log(`Starting Next.js production server on port 3000...`);
    serverProcess = spawnProdServer();
    isServerStartedByUs = true;
    const booted = await waitForHealthyHome("Server booted successfully.");
    if (!booted) {
      console.error("Failed to boot Next.js server. Tests aborted.");
      process.exit(1);
    }
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
      console.log(
        `Leaving Next.js server running for subsequent qa:lifecycle phases (webhooks, e2e).`,
      );
    } else {
      console.log(`Leaving server running since it was already active.`);
    }
    await closeDb().catch(() => undefined);
    setTimeout(() => process.exit(0), 500);
  }
}
run();
