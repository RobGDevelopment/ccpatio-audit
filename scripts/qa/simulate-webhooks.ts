/**
 * QA Phase 4 — Katana webhook rejects unsigned calls, heals a renamed SKU,
 * enqueues reverse-flow SO/MO/PO events, and proves duplicate PO deliveries
 * return 200 twice while producing a single katana_po_bills ledger row.
 */
import { createHmac, randomInt, randomUUID } from "node:crypto";
import http from "node:http";
import { and, eq, gte, like, or, sql } from "drizzle-orm";
import poPartialFixture from "../../tests/fixtures/katana/purchase-order-partially-received.json";
import supplierFixture from "../../tests/fixtures/katana/supplier.json";
import {
  KATANA_PO_RECEIVED_EVENT,
  runSyncKatanaPoReceived,
  type HydratedKatanaPo,
  type PoReceivedStepLike,
} from "../../src/inngest/katana-po-received";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  incoming_webhooks,
  katana_po_bills,
  logistics_profiles,
  saga_runs,
  sku_mappings,
} from "../../src/server/db/schema";
import {
  KATANA_PO_BILL_SAGA_TYPE,
  parseQboVendorIdFromSupplier,
  readPoReceiptRows,
  receiptFingerprint,
} from "../../src/server/katana/po-receipt-ledger";
import {
  KATANA_MO_DONE_EVENT,
  KATANA_SO_STATUS_EVENT,
} from "../../src/server/katana/webhook-events";

const SECRET = process.env.KATANA_WEBHOOK_SECRET?.trim() || "qa-katana-webhook-secret";
const URL = "http://localhost:3000/api/webhooks/katana";

type CapturedInngestEvent = {
  id?: string;
  name?: string;
  data?: Record<string, unknown>;
};

async function startLocalInngestSink(port = 8288): Promise<{
  events: CapturedInngestEvent[];
  external: boolean;
  close: () => Promise<void>;
}> {
  const events: CapturedInngestEvent[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        const batch = (Array.isArray(parsed) ? parsed : [parsed]) as CapturedInngestEvent[];
        events.push(...batch);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: 200,
            ids: batch.map((evt, idx) => String(evt.id || `qa-inngest-${idx}`)),
          }),
        );
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: 400, error: String(err) }));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve({ events, external: true, close: async () => undefined });
        return;
      }
      reject(err);
    });
    server.listen(port, "127.0.0.1", () => {
      resolve({
        events,
        external: false,
        close: () =>
          new Promise<void>((doneClose, failClose) => {
            server.close((closeErr) => (closeErr ? failClose(closeErr) : doneClose()));
          }),
      });
    });
  });
}

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
  console.log("[QA PHASE 4] Katana webhook signature, SKU auto-heal, and Phase 15 reverse-flow enqueue...");
  const variantId = randomInt(1_900_000_000, 1_999_999_900);
  const soId = variantId + 1;
  const moId = variantId + 2;
  const poId = variantId + 3;
  const poOrderNo = `PO-QA-${poId}`;
  const oldSku = `QA-HEAL-OLD-${randomUUID().slice(0, 8).toUpperCase()}`;
  const newSku = `QA-HEAL-NEW-${randomUUID().slice(0, 8).toUpperCase()}`;
  const db = getDb();
  const sink = await startLocalInngestSink(8288);
  const startedAt = new Date(Date.now() - 1000);
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

    // Valid SO/MO events enqueue to the configured Inngest bus, so QA only drives the
    // non-enqueuing branches here; enqueue paths are covered by phase15-katana-reverse-flow.test.ts.
    const orderBody = JSON.stringify({
      resource_type: "sales_order",
      action: "sales_order.updated",
      object: { status: "PACKED", qa_marker: variantId },
    });
    const invalid = await post(orderBody, sign(orderBody));
    const invalidJson = (await invalid.json()) as { error?: string };
    if (invalid.status !== 400 || invalidJson.error !== "invalid_event") {
      throw new Error(`Expected SO without id to be 400 invalid_event, got ${invalid.status}: ${JSON.stringify(invalidJson)}`);
    }

    const unrelatedBody = JSON.stringify({ action: "customer.updated", object: { id: variantId } });
    const ignored = await post(unrelatedBody, sign(unrelatedBody));
    const ignoredJson = (await ignored.json()) as { ignored?: boolean };
    if (ignored.status !== 200 || ignoredJson.ignored !== true) {
      throw new Error(`Expected unrelated event ignore, got ${ignored.status}: ${JSON.stringify(ignoredJson)}`);
    }

    const audit = await db
      .select({ event: incoming_webhooks.event_name, status: incoming_webhooks.status })
      .from(incoming_webhooks)
      .where(
        and(
          eq(incoming_webhooks.source, "katana"),
          gte(incoming_webhooks.created_at, startedAt),
          or(
            like(incoming_webhooks.idempotency_key, `katana:%:${variantId}:%`),
            sql`${incoming_webhooks.payload}->'object'->>'qa_marker' = ${String(variantId)}`,
          ),
        ),
      );
    const seen = audit.map((row) => `${row.event}:${row.status}`).sort();
    const expected = ["customer.updated:processed", "sales_order.updated:failed", "variant.updated:processed"];
    if (JSON.stringify(seen) !== JSON.stringify(expected)) {
      throw new Error(`Expected one katana audit row per signed delivery ${JSON.stringify(expected)}, got ${JSON.stringify(seen)}`);
    }

    const soValidBody = JSON.stringify({
      resource_type: "sales_order",
      action: "sales_order.updated",
      webhook_id: 2,
      object: {
        id: soId,
        status: "PACKED",
        href: `https://api.katanamrp.com/v1/sales_orders/${soId}`,
      },
    });
    const soRes = await post(soValidBody, sign(soValidBody));
    const soJson = (await soRes.json()) as { ok?: boolean; queued?: boolean; action?: string };
    if (soRes.status !== 200 || soJson.ok !== true || soJson.queued !== true || soJson.action !== "sales_order.updated") {
      throw new Error(`Expected signed sales_order.updated 200 queued:true, got ${soRes.status}: ${JSON.stringify(soJson)}`);
    }

    const moDoneBody = JSON.stringify({
      resource_type: "manufacturing_order",
      action: "manufacturing_order.done",
      webhook_id: 3,
      object: {
        id: moId,
        status: "DONE",
        href: `https://api.katanamrp.com/v1/manufacturing_orders/${moId}`,
      },
    });
    const moRes = await post(moDoneBody, sign(moDoneBody));
    const moJson = (await moRes.json()) as { ok?: boolean; queued?: boolean; action?: string };
    if (moRes.status !== 200 || moJson.ok !== true || moJson.queued !== true || moJson.action !== "manufacturing_order.done") {
      throw new Error(`Expected signed manufacturing_order.done 200 queued:true, got ${moRes.status}: ${JSON.stringify(moJson)}`);
    }

    const poBody = JSON.stringify({
      resource_type: "purchase_order",
      action: "purchase_order.partially_received",
      webhook_id: 4,
      object: {
        id: poId,
        order_no: poOrderNo,
        status: "PARTIALLY_RECEIVED",
        href: `https://api.katanamrp.com/v1/purchase_orders/${poId}`,
      },
    });
    const poSig = sign(poBody);
    const poRes1 = await post(poBody, poSig);
    const poJson1 = (await poRes1.json()) as {
      ok?: boolean;
      queued?: boolean;
      action?: string;
      purchaseOrderId?: number;
    };
    if (
      poRes1.status !== 200 ||
      poJson1.ok !== true ||
      poJson1.queued !== true ||
      poJson1.action !== "purchase_order.partially_received" ||
      poJson1.purchaseOrderId !== poId
    ) {
      throw new Error(`Expected first PO delivery 200 queued:true, got ${poRes1.status}: ${JSON.stringify(poJson1)}`);
    }

    const poRes2 = await post(poBody, poSig);
    const poJson2 = (await poRes2.json()) as {
      ok?: boolean;
      queued?: boolean;
      action?: string;
      purchaseOrderId?: number;
    };
    if (
      poRes2.status !== 200 ||
      poJson2.ok !== true ||
      poJson2.queued !== true ||
      poJson2.action !== "purchase_order.partially_received" ||
      poJson2.purchaseOrderId !== poId
    ) {
      throw new Error(`Expected duplicate PO delivery 200 queued:true, got ${poRes2.status}: ${JSON.stringify(poJson2)}`);
    }

    const reverseAudit = await db
      .select({ event: incoming_webhooks.event_name, status: incoming_webhooks.status })
      .from(incoming_webhooks)
      .where(
        and(
          eq(incoming_webhooks.source, "katana"),
          gte(incoming_webhooks.created_at, startedAt),
          or(
            like(incoming_webhooks.idempotency_key, `katana:%:${soId}:%`),
            like(incoming_webhooks.idempotency_key, `katana:%:${moId}:%`),
            like(incoming_webhooks.idempotency_key, `katana:%:${poId}:%`),
          ),
        ),
      );
    const reverseSeen = reverseAudit.map((row) => `${row.event}:${row.status}`).sort();
    const reverseExpected = [
      "manufacturing_order.done:processed",
      "purchase_order.partially_received:processed",
      "purchase_order.partially_received:processed",
      "sales_order.updated:processed",
    ];
    if (JSON.stringify(reverseSeen) !== JSON.stringify(reverseExpected)) {
      throw new Error(
        `Expected reverse-flow katana audit rows ${JSON.stringify(reverseExpected)}, got ${JSON.stringify(reverseSeen)}`,
      );
    }

    let poDeliveryPayloads: Array<Record<string, unknown>> = [
      { purchaseOrderId: poId, orderNo: poOrderNo, action: "purchase_order.partially_received" },
      { purchaseOrderId: poId, orderNo: poOrderNo, action: "purchase_order.partially_received" },
    ];
    if (!sink.external) {
      const soEvents = sink.events.filter(
        (evt) => evt.name === KATANA_SO_STATUS_EVENT && evt.data?.salesOrderId === soId,
      );
      const moEvents = sink.events.filter(
        (evt) => evt.name === KATANA_MO_DONE_EVENT && evt.data?.manufacturingOrderId === moId,
      );
      const poEvents = sink.events.filter(
        (evt) => evt.name === KATANA_PO_RECEIVED_EVENT && evt.data?.purchaseOrderId === poId,
      );
      if (soEvents.length !== 1 || moEvents.length !== 1 || poEvents.length !== 2) {
        throw new Error(
          `Expected 1 SO, 1 MO, and 2 PO Inngest events, got SO=${soEvents.length}, MO=${moEvents.length}, PO=${poEvents.length}`,
        );
      }
      if (!poEvents[0]?.id || !poEvents[1]?.id || poEvents[0].id === poEvents[1].id) {
        throw new Error(`Expected distinct per-delivery PO event ids, got ${JSON.stringify(poEvents)}`);
      }
      poDeliveryPayloads = [poEvents[0].data ?? {}, poEvents[1].data ?? {}];
    }

    const fixtureRows = readPoReceiptRows(poPartialFixture);
    const parsedSupplier = parseQboVendorIdFromSupplier(supplierFixture);
    const hydratedFixturePo: HydratedKatanaPo = {
      katanaPoId: poId,
      orderNo: poOrderNo,
      currency: "USD",
      poCreatedAtIso: poPartialFixture.created_at,
      rows: fixtureRows,
      fingerprint: receiptFingerprint(poId, fixtureRows),
      supplierId: supplierFixture.id,
      supplierName: supplierFixture.name,
      qboVendorId: parsedSupplier.ok ? parsedSupplier.qboVendorId : null,
      vendorRefError: parsedSupplier.ok ? null : parsedSupplier.reason,
    };
    const inlineStep: PoReceivedStepLike = {
      run: async (_id, fn) => fn(),
      sendEvent: async () => ({ ids: [] }),
    };
    const poDeps = {
      getDb: () => db,
      fetchPo: async () => hydratedFixturePo,
      env: {
        ...process.env,
        QBO_LEDGER_MODE: "log",
        LEDGER_COMPANY_TIMEZONE: "America/Phoenix",
      },
    };

    const firstPoRun = await runSyncKatanaPoReceived(
      { event: { data: poDeliveryPayloads[0] }, step: inlineStep, runId: `qa-po-1-${poId}` },
      poDeps,
    );
    const secondPoRun = await runSyncKatanaPoReceived(
      { event: { data: poDeliveryPayloads[1] }, step: inlineStep, runId: `qa-po-2-${poId}` },
      poDeps,
    );
    if (!("duplicate" in secondPoRun) || secondPoRun.duplicate !== true) {
      throw new Error(
        `Expected duplicate PO delivery to short-circuit as duplicate:true, got first=${JSON.stringify(firstPoRun)} second=${JSON.stringify(secondPoRun)}`,
      );
    }

    const poLedgerRows = await db
      .select({
        id: katana_po_bills.id,
        receiptSeq: katana_po_bills.receipt_seq,
        status: katana_po_bills.status,
        deltaTotalCents: katana_po_bills.delta_total_cents,
      })
      .from(katana_po_bills)
      .where(eq(katana_po_bills.katana_po_id, poId));
    if (poLedgerRows.length !== 1 || poLedgerRows[0]?.receiptSeq !== 1 || poLedgerRows[0]?.status !== "dry_run") {
      throw new Error(
        `Expected exactly 1 katana_po_bills row for duplicate PO delivery, got ${JSON.stringify(poLedgerRows)}`,
      );
    }

    console.log(
      "[SUCCESS] Webhook Simulation Passed (signature + SKU auto-heal + SO/MO/PO queued:true + duplicate PO single ledger row + katana audit log)",
    );
  } catch (err) {
    console.error("[QA PHASE 4 FAILED]", err);
    exitCode = 1;
  } finally {
    await sink.close();
    await db.delete(katana_po_bills).where(eq(katana_po_bills.katana_po_id, poId));
    await db
      .delete(saga_runs)
      .where(
        and(
          eq(saga_runs.saga_type, KATANA_PO_BILL_SAGA_TYPE),
          like(saga_runs.correlation_key, `${poId}:%`),
        ),
      );
    await db.delete(sku_mappings).where(eq(sku_mappings.katana_variant_id, variantId));
    await db.delete(logistics_profiles).where(eq(logistics_profiles.katana_variant_id, variantId));
    await closeDb().catch(() => undefined);
  }
  process.exit(exitCode);
}

simulateKatanaWebhook();
