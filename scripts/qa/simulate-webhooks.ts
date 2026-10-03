/**
 * QA Phase 4 — Katana webhook rejects unsigned calls and heals a renamed SKU.
 */
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../../src/server/db/client";
import { logistics_profiles, sku_mappings } from "../../src/server/db/schema";

const SECRET = process.env.KATANA_WEBHOOK_SECRET?.trim() || "qa-katana-webhook-secret";
const URL = "http://localhost:3000/api/webhooks/katana";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

async function post(body: string, signature?: string) {
  return fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signature ? { "x-sha2-signature": signature } : {}),
    },
    body,
  });
}

async function simulateKatanaWebhook() {
  console.log("[QA PHASE 4] Katana webhook signature and SKU auto-heal...");
  const variantId = randomInt(1_900_000_000, 2_000_000_000);
  const oldSku = `QA-HEAL-OLD-${randomUUID().slice(0, 8).toUpperCase()}`;
  const newSku = `QA-HEAL-NEW-${randomUUID().slice(0, 8).toUpperCase()}`;
  const db = getDb();
  let exitCode = 0;

  try {
    const unsigned = await post(JSON.stringify({ action: "variant.updated", object: { id: 1, sku: "X" } }));
    if (unsigned.status !== 401) {
      throw new Error(`Expected unsigned 401, got ${unsigned.status}: ${await unsigned.text()}`);
    }
    const unsignedBody = (await unsigned.json()) as { error?: string };
    if (unsignedBody.error !== "invalid_signature") {
      throw new Error(`Expected invalid_signature, got ${JSON.stringify(unsignedBody)}`);
    }

    const forged = JSON.stringify({
      action: "variant.updated",
      object: { id: variantId, sku: newSku },
    });
    const bad = await post(forged, "ab".repeat(32));
    if (bad.status !== 401) {
      throw new Error(`Expected forged signature 401, got ${bad.status}`);
    }

    await db.insert(logistics_profiles).values({
      katana_variant_id: variantId,
      variant_sku: oldSku,
      weight_lb: "33.5000",
      length_in: "70.0000",
      ltl_class: "175",
      lead_time_days: 4,
    });
    await db.insert(sku_mappings).values({
      global_sku: oldSku,
      category: "QA",
      item_type: "finished_good",
      original_name: "QA heal",
      katana_variant_id: variantId,
    });

    const healBody = JSON.stringify({
      resource_type: "variant",
      action: "variant.updated",
      webhook_id: 1,
      object: { id: variantId, sku: newSku.toLowerCase(), href: "https://api.katanamrp.com/v1/variants/1" },
    });
    const healed = await post(healBody, sign(healBody));
    const healedJson = (await healed.json()) as { ok?: boolean; healed?: boolean; error?: string };
    if (healed.status !== 200 || healedJson.healed !== true) {
      throw new Error(`Expected healed 200, got ${healed.status}: ${JSON.stringify(healedJson)}`);
    }

    const [profile] = await db
      .select({
        sku: logistics_profiles.variant_sku,
        weight: logistics_profiles.weight_lb,
        lengthIn: logistics_profiles.length_in,
        ltlClass: logistics_profiles.ltl_class,
        leadTimeDays: logistics_profiles.lead_time_days,
      })
      .from(logistics_profiles)
      .where(eq(logistics_profiles.katana_variant_id, variantId))
      .limit(1);
    if (profile?.sku !== newSku || profile.weight !== "33.5000" || profile.leadTimeDays !== 4) {
      throw new Error(`Logistics profile was not healed safely: ${JSON.stringify(profile)}`);
    }
    if (profile.lengthIn !== "70.0000" || profile.ltlClass !== "175") {
      throw new Error(`Logistics measurements changed: ${JSON.stringify(profile)}`);
    }

    const [mapping] = await db
      .select({ sku: sku_mappings.global_sku })
      .from(sku_mappings)
      .where(eq(sku_mappings.katana_variant_id, variantId))
      .limit(1);
    if (mapping?.sku !== newSku) {
      throw new Error(`Dictionary SKU was not healed: ${JSON.stringify(mapping)}`);
    }

    const orderBody = JSON.stringify({
      resource_type: "sales_order",
      action: "sales_order.updated",
      object: { id: 99, status: "PACKED" },
    });
    const ignored = await post(orderBody, sign(orderBody));
    const ignoredJson = (await ignored.json()) as { ignored?: boolean };
    if (ignored.status !== 200 || ignoredJson.ignored !== true) {
      throw new Error(`Expected sales order ignore, got ${ignored.status}: ${JSON.stringify(ignoredJson)}`);
    }

    console.log("[SUCCESS] Webhook Simulation Passed (signature + SKU auto-heal)");
  } catch (err) {
    console.error("[QA PHASE 4 FAILED]", err);
    exitCode = 1;
  } finally {
    await db.delete(sku_mappings).where(eq(sku_mappings.katana_variant_id, variantId));
    await db.delete(logistics_profiles).where(eq(logistics_profiles.katana_variant_id, variantId));
    await closeDb().catch(() => undefined);
  }
  process.exit(exitCode);
}

simulateKatanaWebhook();
