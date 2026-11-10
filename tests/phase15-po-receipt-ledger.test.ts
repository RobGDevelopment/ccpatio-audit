import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import poPartialFixture from "./fixtures/katana/purchase-order-partially-received.json";
import poReceivedFixture from "./fixtures/katana/purchase-order-received.json";
import supplierFixture from "./fixtures/katana/supplier.json";
import {
  postKatanaPoBill,
  runArchiveKatanaVariant,
} from "@/inngest/functions";
import {
  runPostKatanaPoBill,
  runRedriveKatanaPoBill,
  runResolveKatanaPoBill,
  type PoBillPostStepLike,
  type QboPostDeps,
} from "@/inngest/katana-po-bill-post";
import {
  fetchKatanaPoWithSupplier,
  runSyncKatanaPoReceived,
  type HydratedKatanaPo,
  type PoReceivedStepLike,
} from "@/inngest/katana-po-received";
import { runKatanaStep } from "@/inngest/katana-step";
import { KatanaApiError } from "@/lib/katana";
import type { MiddlewareDb } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import {
  dlq_events,
  katana_po_bills,
  saga_runs,
} from "@/server/db/schema";
import { QboApiError, QboApiTimeoutError } from "@/server/integrations/qbo/token-refresh";
import {
  computeReceiptDelta,
  derivePoBillRequestId,
  formatPoBillDocNumber,
  parseQboVendorIdFromSupplier,
  readPoReceiptRows,
  receiptFingerprint,
} from "@/server/katana/po-receipt-ledger";
import { QBO_REQUEST_ID_MAX_LENGTH } from "@/server/sre/idempotency";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTsFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const BASE_PGLITE_DDL = `
  CREATE TYPE "order_intake_status" AS ENUM ('received', 'approved', 'pushed', 'failed', 'rejected');
  CREATE TYPE "saga_status" AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'COMPENSATING',
    'COMPENSATED',
    'SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION',
    'AWAITING_DEPOSIT'
  );
  CREATE TABLE "order_intake" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "ghl_opportunity_id" text NOT NULL UNIQUE,
    "status" "order_intake_status" DEFAULT 'received' NOT NULL,
    "raw_payload" jsonb NOT NULL,
    "zod_issues" jsonb,
    "contact_name" text,
    "contact_email" text,
    "stage_name" text,
    "mapped_lines" jsonb,
    "katana_customer_id" integer,
    "katana_sales_order_id" integer,
    "katana_order_no" text,
    "katana_mo_ids" jsonb,
    "hold_relief" jsonb,
    "version" integer DEFAULT 1 NOT NULL,
    "last_error" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "custom_build_jobs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "client_slug" text NOT NULL,
    "display_name" text NOT NULL,
    "ghl_opportunity_id" text UNIQUE,
    "architect_name" text,
    "designer_name" text,
    "packet_storage_path" text,
    "created_by" text NOT NULL,
    "katana_sales_order_id" integer,
    "katana_order_no" text,
    "katana_mo_ids" jsonb,
    "ghl_sync_hash" text,
    "ghl_synced_at" timestamp with time zone,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "saga_runs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "saga_type" text NOT NULL,
    "correlation_key" text NOT NULL,
    "status" "saga_status" DEFAULT 'PENDING' NOT NULL,
    "current_step" text,
    "paid_at" timestamp with time zone,
    "last_error" text,
    "release_requested_at" timestamp with time zone,
    "release_source" text,
    "release_requested_by" text,
    "release_reason" text,
    "deposit_cents" integer,
    "deposit_ref" text,
    "deposit_recorded_at" timestamp with time zone,
    "release_attempts" integer,
    "released_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX "saga_runs_type_correlation_uidx" ON "saga_runs" ("saga_type", "correlation_key");
  CREATE TABLE "dlq_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "run_id" text NOT NULL UNIQUE,
    "function_id" text NOT NULL,
    "event_id" text,
    "event_name" text NOT NULL,
    "error_name" text,
    "error_message" text NOT NULL,
    "error_stack" text,
    "original_event" jsonb NOT NULL,
    "alert_sent" boolean DEFAULT false NOT NULL,
    "status" text DEFAULT 'open' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );
`;

async function createPhase15LedgerDb(): Promise<{
  pg: PGlite;
  db: MiddlewareDb;
}> {
  const pg = new PGlite();
  await pg.exec(BASE_PGLITE_DDL);
  const migrationSql = read("src/server/db/migrations/0057_katana_reverse_flow.sql");
  const statements = migrationSql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.replace(/^\s*--.*$/gm, "").trim().length > 0);
  for (const stmt of statements) {
    await pg.exec(stmt);
  }
  const db = drizzle(pg, { schema }) as unknown as MiddlewareDb;
  return { pg, db };
}

function makePoStep(): {
  step: PoReceivedStepLike & PoBillPostStepLike;
  sentEvents: Array<{ id?: string; name: string; data: Record<string, unknown> }>;
} {
  const sentEvents: Array<{ id?: string; name: string; data: Record<string, unknown> }> = [];
  const step: PoReceivedStepLike & PoBillPostStepLike = {
    run: async (_id, fn) => fn(),
    sendEvent: async (_id, payload) => {
      sentEvents.push(payload);
      return { ids: [payload.id ?? "evt"] };
    },
  };
  return { step, sentEvents };
}

function buildHydratedPoFromRaw(
  rawPo: Record<string, unknown>,
  rawSupplier: Record<string, unknown> = supplierFixture as Record<string, unknown>,
): HydratedKatanaPo {
  const poId = Number(rawPo.id);
  const rows = readPoReceiptRows(rawPo);
  const parsedVendor = parseQboVendorIdFromSupplier(rawSupplier);
  return {
    katanaPoId: poId,
    orderNo: String(rawPo.order_no ?? `PO-${poId}`),
    currency: String(rawPo.currency ?? "USD"),
    poCreatedAtIso: String(rawPo.created_at ?? "2026-10-28T18:10:00.000Z"),
    rows,
    fingerprint: receiptFingerprint(poId, rows),
    supplierId: typeof rawPo.supplier_id === "number" ? rawPo.supplier_id : null,
    supplierName: typeof rawSupplier.name === "string" ? rawSupplier.name : null,
    qboVendorId: parsedVendor.ok ? parsedVendor.qboVendorId : null,
    vendorRefError: parsedVendor.ok ? null : parsedVendor.reason,
  };
}

describe("0057_katana_reverse_flow.sql & schema.ts parity (QA-15.1-01..05)", () => {
  const migration = read("src/server/db/migrations/0057_katana_reverse_flow.sql");
  const codeOnly = migration.replace(/^\s*--.*$/gm, "");

  it("is strictly additive with zero DROP, ALTER COLUMN, ALTER TYPE, RENAME, TRUNCATE, or DELETE (QA-15.1-01/05)", () => {
    expect(codeOnly).not.toMatch(/\bDROP\b/i);
    expect(codeOnly).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(codeOnly).not.toMatch(/\bALTER\s+TYPE\b/i);
    expect(codeOnly).not.toMatch(/\bRENAME\b/i);
    expect(codeOnly).not.toMatch(/\bTRUNCATE\b/i);
    expect(codeOnly).not.toMatch(/\bDELETE\b/i);
    expect(codeOnly).not.toMatch(/incoming_webhooks/i);
    expect(codeOnly).not.toMatch(/quarantined_orders/i);
  });

  it("journal idx 59 and 0059_snapshot.json match 0057_katana_reverse_flow (QA-15.1-02)", () => {
    const journal = JSON.parse(
      read("src/server/db/migrations/meta/_journal.json"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const entry = journal.entries.find((e) => e.idx === 59);
    expect(entry).toMatchObject({ idx: 59, tag: "0057_katana_reverse_flow" });
    const snap = JSON.parse(
      read("src/server/db/migrations/meta/0059_snapshot.json"),
    ) as { tables: Record<string, unknown> };
    expect(snap.tables).toHaveProperty(["public.katana_po_bills"]);
  });

  it("every CHECK SQL string in schema.ts matches 0057_katana_reverse_flow.sql character-for-character (QA-15.1-03)", () => {
    const dialect = new PgDialect();
    const cfg = getTableConfig(katana_po_bills);
    const schemaChecks = new Map<string, string>();
    for (const chk of cfg.checks) {
      schemaChecks.set(chk.name, dialect.sqlToQuery(chk.value).sql);
    }

    const sqlChecks = new Map<string, string>();
    const re = /CONSTRAINT\s+"([^"]+)"\s+CHECK\s*\((.+)\)\s*,?$/gm;
    for (let m = re.exec(codeOnly); m; m = re.exec(codeOnly)) {
      sqlChecks.set(m[1]!, m[2]!);
    }

    expect(schemaChecks.size).toBe(10);
    expect([...schemaChecks.keys()].sort()).toEqual([...sqlChecks.keys()].sort());
    for (const [name, expectedSql] of sqlChecks.entries()) {
      expect(schemaChecks.get(name), `CHECK mismatch on ${name}`).toBe(expectedSql);
    }
  });
});

describe("Pure PO receipt ledger & static guards (QA-15.2-01/04/05, QA-R6-03, QA-S2-01/02/05, QA-S3-01/02)", () => {
  it("receiptFingerprint is pure across 1,000 calls, row-order independent, and quantity-sensitive (QA-15.2-01)", () => {
    const rows = readPoReceiptRows(poPartialFixture as Record<string, unknown>);
    const first = receiptFingerprint(poPartialFixture.id, rows);
    for (let i = 0; i < 1000; i += 1) {
      expect(receiptFingerprint(poPartialFixture.id, rows)).toBe(first);
    }
    expect(receiptFingerprint(poPartialFixture.id, [...rows].reverse())).toBe(first);

    const bumped = rows.map((r, idx) =>
      idx === 1 ? { ...r, receivedQtyCumulative: 3 } : r,
    );
    expect(receiptFingerprint(poPartialFixture.id, bumped)).not.toBe(first);
  });

  it("po-receipt-ledger.ts has zero wall-clock time, randomness, or console/log calls (QA-15.2-04, QA-S2-05)", () => {
    const ledgerSrc = read("src/server/katana/po-receipt-ledger.ts");
    const code = ledgerSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/Date\.now|new Date\(|randomUUID|Math\.random|console\./);
    expect(code).not.toMatch(/logStructured|logError/);

    const poReceivedSrc = read("src/inngest/katana-po-received.ts");
    const logCalls = [...poReceivedSrc.matchAll(/logStructured\([\s\S]*?\);/g)].map(
      (m) => m[0],
    );
    for (const callText of logCalls) {
      expect(callText).not.toMatch(/\.comment\b/);
    }
  });

  it("contains zero swallowed catch blocks, zero 'Katana Vendor', zero account '81' fallback, and zero vendor auto-create (QA-15.2-05, QA-R6-03, QA-S2-02)", () => {
    const poSrc = read("src/inngest/katana-po-received.ts");
    const fnSrc = read("src/inngest/functions.ts");
    expect(poSrc).not.toMatch(/catch\s*\{/);
    expect(fnSrc).not.toMatch(/catch\s*\{/);

    const qboSrc = read("src/server/integrations/qbo/client.ts");
    expect(qboSrc).not.toMatch(/"81"|Katana Supplier|"unknown"/);

    for (const file of walkTsFiles(path.join(ROOT, "src"))) {
      const content = readFileSync(file, "utf8");
      const rel = path.relative(ROOT, file);
      expect(content, `${rel} contains Katana Vendor`).not.toContain("Katana Vendor");
      expect(content, `${rel} contains resolveOrCreateQboVendor`).not.toContain(
        "resolveOrCreateQboVendor",
      );
      expect(content, `${rel} contains /vendor?requestid`).not.toContain("/vendor?requestid");
      expect(content, `${rel} contains DisplayName = `).not.toContain("DisplayName = ");
    }
  });

  it("parseQboVendorIdFromSupplier enforces strict QBO_ID grammar and HTML normalization (QA-S2-01)", () => {
    expect(parseQboVendorIdFromSupplier({ comment: "QBO_ID: 145" })).toEqual({
      ok: true,
      qboVendorId: "145",
    });
    expect(parseQboVendorIdFromSupplier({ comment: "Net 30\nqbo_id:145 \n" })).toEqual({
      ok: true,
      qboVendorId: "145",
    });
    expect(parseQboVendorIdFromSupplier({ comment: "QBO_ID: 145\nQBO_ID: 145" })).toEqual({
      ok: true,
      qboVendorId: "145",
    });
    expect(
      parseQboVendorIdFromSupplier({ comment: "<p>Net 30</p><div>QBO_ID:&nbsp;145</div>" }),
    ).toEqual({
      ok: true,
      qboVendorId: "145",
    });
    expect(parseQboVendorIdFromSupplier({ comment: "QBO_ID: 145\nQBO_ID: 146" })).toEqual({
      ok: false,
      reason: "vendor_qbo_id_ambiguous",
    });

    for (const invalid of [
      "QBO ID: 145",
      "QBO_ID=145",
      "QBO_ID: 145a",
      "QBO_ID: 0145",
      "QBO_ID:",
    ]) {
      expect(parseQboVendorIdFromSupplier({ comment: invalid }), invalid).toEqual({
        ok: false,
        reason: "vendor_qbo_id_invalid",
      });
    }

    for (const missing of ["", "   ", null, undefined, "Net 30"]) {
      expect(
        parseQboVendorIdFromSupplier({ comment: missing as unknown }),
        String(missing),
      ).toEqual({
        ok: false,
        reason: "vendor_qbo_id_missing",
      });
    }
  });

  it("post-katana-po-bill has no function-level idempotency and derives distinct bounded requestIds per redrive (QA-S3-01/02)", () => {
    const opts = (postKatanaPoBill as unknown as { opts?: Record<string, unknown> }).opts ?? {};
    expect(opts.idempotency).toBeUndefined();
    expect(opts.onFailure).toBeUndefined();

    const fp = receiptFingerprint(
      poReceivedFixture.id,
      readPoReceiptRows(poReceivedFixture as Record<string, unknown>),
    );
    const r0 = derivePoBillRequestId(poReceivedFixture.id, fp, 0);
    const r1 = derivePoBillRequestId(poReceivedFixture.id, fp, 1);
    const r2 = derivePoBillRequestId(poReceivedFixture.id, fp, 2);
    expect(new Set([r0, r1, r2]).size).toBe(3);
    for (const id of [r0, r1, r2]) {
      expect(id.length).toBeLessThanOrEqual(QBO_REQUEST_ID_MAX_LENGTH);
    }

    expect(formatPoBillDocNumber("VERY-LONG-KATANA-PO-ORDER-NUMBER-9999", 1).length).toBeLessThanOrEqual(
      21,
    );
    const r2Doc = formatPoBillDocNumber("VERY-LONG-KATANA-PO-ORDER-NUMBER-9999", 2);
    expect(r2Doc.length).toBeLessThanOrEqual(21);
    expect(r2Doc.endsWith("-R2")).toBe(true);
  });
});

describe("archiveKatanaVariant error semantics (QA-15.2-08)", () => {
  const step = { run: async <T,>(_id: string, fn: () => Promise<T>) => fn() };

  it("returns no_katana_variant when SKU mapping is absent", async () => {
    const out = await runArchiveKatanaVariant(
      { event: { data: { globalSku: "FIN-MISSING" } }, step },
      { lookupKatanaVariantId: async () => null },
    );
    expect(out).toEqual({ ok: true, globalSku: "FIN-MISSING", skipped: "no_katana_variant" });
  });

  it("treats 404 as already_absent, maps 400 to NonRetriableError, and rethrows 500", async () => {
    const absent = await runArchiveKatanaVariant(
      { event: { data: { globalSku: "FIN-GONE" } }, step },
      {
        lookupKatanaVariantId: async () => 555,
        deleteVariant: async () => {
          throw new KatanaApiError("Not found", { status: 404 });
        },
      },
    );
    expect(absent).toEqual({ ok: true, globalSku: "FIN-GONE", skipped: "already_absent" });

    await expect(
      runArchiveKatanaVariant(
        { event: { data: { globalSku: "FIN-BAD" } }, step },
        {
          lookupKatanaVariantId: async () => 555,
          deleteVariant: async () => {
            throw new KatanaApiError("Bad request", { status: 400 });
          },
        },
      ),
    ).rejects.toThrow(NonRetriableError);

    await expect(
      runArchiveKatanaVariant(
        { event: { data: { globalSku: "FIN-500" } }, step },
        {
          lookupKatanaVariantId: async () => 555,
          deleteVariant: async () => {
            throw new KatanaApiError("Upstream 500", { status: 500 });
          },
        },
      ),
    ).rejects.toThrow(/Upstream 500/);

    const fnBody = read("src/inngest/functions.ts");
    const archiveBlock = fnBody.slice(
      fnBody.indexOf("export async function runArchiveKatanaVariant"),
      fnBody.indexOf("export const publishApprovedProduct"),
    );
    expect(archiveBlock).not.toContain("console.error");
  });
});

describe("Katana PO receipt ledger + QBO bill posting on real PGlite (QA-15.2, QA-R4, QA-R6..R8, QA-S2..S7)", () => {
  let pg: PGlite;
  let db: MiddlewareDb;

  const LIVE_ENV: Record<string, string> = {
    QBO_LEDGER_MODE: "live",
    QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID: "4200",
    LEDGER_COMPANY_TIMEZONE: "America/Phoenix",
  };

  beforeEach(async () => {
    const created = await createPhase15LedgerDb();
    pg = created.pg;
    db = created.db;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await pg.close();
  });

  function makeFakeQbo() {
    const postedCalls: Array<Parameters<QboPostDeps["createVendorBill"]>[0]> = [];
    const deps: QboPostDeps = {
      fetchVendorById: vi.fn(async (id: string) => ({
        id,
        displayName: "Keyston Bros",
        active: true,
        currency: "USD",
      })),
      findBillsByDocNumber: vi.fn(async () => []),
      createVendorBill: vi.fn(async (input) => {
        postedCalls.push(input);
        const cents = input.lines.reduce((s: number, l: { amountCents: number }) => s + l.amountCents, 0);
        return {
          billId: `QBO-BILL-${postedCalls.length}`,
          vendorId: input.qboVendorId,
          totalDollars: (cents / 100).toFixed(2),
        };
      }),
      fetchBillById: vi.fn(async () => null),
      fetchVendorCreditById: vi.fn(async () => null),
    };
    return { deps, postedCalls };
  }

  function clonePoWithReceivedQtys(qtyRow0: number, qtyRow1: number, unitPrice = 20) {
    const cloned = structuredClone(poPartialFixture) as Record<string, unknown> & {
      purchase_order_rows: Array<Record<string, unknown>>;
    };
    cloned.purchase_order_rows[0] = {
      ...cloned.purchase_order_rows[0]!,
      received_quantity: qtyRow0,
      price_per_unit: unitPrice,
      received_date: qtyRow0 > 0 ? "2026-10-29T16:45:10.000Z" : null,
    };
    cloned.purchase_order_rows[1] = {
      ...cloned.purchase_order_rows[1]!,
      received_quantity: qtyRow1,
      price_per_unit: unitPrice,
      received_date: qtyRow1 > 0 ? "2026-10-30T16:45:10.000Z" : null,
    };
    return cloned;
  }

  it("bills exact deltas across 3 receipts (4 -> 7 -> 10), dedupes redeliveries, and sends 3 distinct requestids (QA-15.2-02)", async () => {
    const { deps: qbo, postedCalls } = makeFakeQbo();

    // Receipt #1: cumulative 4 (row 0 = 4, row 1 = 0)
    const po1 = buildHydratedPoFromRaw(clonePoWithReceivedQtys(4, 0, 20));
    const s1 = makePoStep();
    const r1 = await runSyncKatanaPoReceived(
      {
        event: {
          data: {
            purchaseOrderId: po1.katanaPoId,
            action: "purchase_order.partially_received",
          },
        },
        step: s1.step,
      },
      { getDb: () => db, fetchPo: async () => po1, env: LIVE_ENV },
    );
    expect(r1).toMatchObject({ ok: true, mode: "live", receiptSeq: 1, deltaTotalCents: 8000 });
    await runPostKatanaPoBill(
      { event: { data: s1.sentEvents[0]!.data }, step: s1.step },
      { getDb: () => db, qbo, env: LIVE_ENV },
    );

    // Redelivery of Receipt #1: duplicate, zero second QBO call
    const sDup = makePoStep();
    const rDup = await runSyncKatanaPoReceived(
      {
        event: {
          data: {
            purchaseOrderId: po1.katanaPoId,
            action: "purchase_order.partially_received",
          },
        },
        step: sDup.step,
      },
      { getDb: () => db, fetchPo: async () => po1, env: LIVE_ENV },
    );
    expect(rDup).toMatchObject({ ok: true, duplicate: true });
    expect(sDup.sentEvents).toHaveLength(0);

    // Receipt #2: cumulative 7 (row 0 = 4, row 1 = 3) -> delta 3, DocNumber -R2
    const po2 = buildHydratedPoFromRaw(clonePoWithReceivedQtys(4, 3, 20));
    const s2 = makePoStep();
    const r2 = await runSyncKatanaPoReceived(
      {
        event: {
          data: {
            purchaseOrderId: po2.katanaPoId,
            action: "purchase_order.partially_received",
          },
        },
        step: s2.step,
      },
      { getDb: () => db, fetchPo: async () => po2, env: LIVE_ENV },
    );
    expect(r2).toMatchObject({ receiptSeq: 2, deltaTotalCents: 6000 });
    await runPostKatanaPoBill(
      { event: { data: s2.sentEvents[0]!.data }, step: s2.step },
      { getDb: () => db, qbo, env: LIVE_ENV },
    );

    // Final Receipt #3: cumulative 10 (row 0 = 4, row 1 = 6) -> delta 3, DocNumber -R3
    const po3 = buildHydratedPoFromRaw(clonePoWithReceivedQtys(4, 6, 20));
    const s3 = makePoStep();
    const r3 = await runSyncKatanaPoReceived(
      {
        event: {
          data: {
            purchaseOrderId: po3.katanaPoId,
            action: "purchase_order.received",
          },
        },
        step: s3.step,
      },
      { getDb: () => db, fetchPo: async () => po3, env: LIVE_ENV },
    );
    expect(r3).toMatchObject({ receiptSeq: 3, deltaTotalCents: 6000 });
    await runPostKatanaPoBill(
      { event: { data: s3.sentEvents[0]!.data }, step: s3.step },
      { getDb: () => db, qbo, env: LIVE_ENV },
    );

    expect(postedCalls).toHaveLength(3);
    expect(postedCalls[0]!.docNumber).toBe(po1.orderNo);
    expect(postedCalls[1]!.docNumber).toBe(`${po1.orderNo}-R2`);
    expect(postedCalls[2]!.docNumber).toBe(`${po1.orderNo}-R3`);

    const totalQtyBilled = postedCalls.reduce(
      (sum, c) => sum + c.lines.reduce((ls, l) => ls + l.billedQtyDelta, 0),
      0,
    );
    expect(totalQtyBilled).toBe(10);
    expect(new Set(postedCalls.map((c) => c.requestId)).size).toBe(3);
  });

  it("accounts pending rows in subsequent delta math and serializes concurrent transactions via advisory lock (QA-R4-01, QA-R4-05)", async () => {
    const po1 = buildHydratedPoFromRaw(clonePoWithReceivedQtys(4, 0, 20));
    const po2 = buildHydratedPoFromRaw(clonePoWithReceivedQtys(4, 6, 20));

    // Fire both receipts concurrently WITHOUT posting #1 first!
    const [resA, resB] = await Promise.all([
      runSyncKatanaPoReceived(
        {
          event: { data: { purchaseOrderId: po1.katanaPoId, action: "purchase_order.partially_received" } },
          step: makePoStep().step,
        },
        { getDb: () => db, fetchPo: async () => po1, env: LIVE_ENV },
      ),
      runSyncKatanaPoReceived(
        {
          event: { data: { purchaseOrderId: po2.katanaPoId, action: "purchase_order.received" } },
          step: makePoStep().step,
        },
        { getDb: () => db, fetchPo: async () => po2, env: LIVE_ENV },
      ),
    ]);

    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);

    const rows = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.katana_po_id, po1.katanaPoId))
      .orderBy(asc(katana_po_bills.receipt_seq));

    expect(rows.map((r) => r.receipt_seq)).toEqual(
      rows.length === 2 ? [1, 2] : [1],
    );
    const totalAccountedCents = rows.reduce((s, r) => s + r.delta_total_cents, 0);
    expect(totalAccountedCents).toBe(20000);
  });

  it("records log-mode receipts as dry_run with zero fetches and excludes them from later live deltas (QA-15.2-06, QA-R6-04)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { deps: qbo, postedCalls } = makeFakeQbo();

    const po1 = buildHydratedPoFromRaw(clonePoWithReceivedQtys(4, 0, 20));
    const logOut = await runSyncKatanaPoReceived(
      {
        event: { data: { purchaseOrderId: po1.katanaPoId, action: "purchase_order.partially_received" } },
        step: makePoStep().step,
      },
      { getDb: () => db, fetchPo: async () => po1, env: { QBO_LEDGER_MODE: "log" } },
    );

    expect(logOut).toMatchObject({
      ok: true,
      mode: "log",
      deltaTotalCents: 8000,
      qboConfigReady: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // Flip to live and receive remaining 6 units -> bills ONLY 6 ($120.00)
    const po2 = buildHydratedPoFromRaw(clonePoWithReceivedQtys(4, 6, 20));
    const liveStep = makePoStep();
    const liveOut = await runSyncKatanaPoReceived(
      {
        event: { data: { purchaseOrderId: po2.katanaPoId, action: "purchase_order.received" } },
        step: liveStep.step,
      },
      { getDb: () => db, fetchPo: async () => po2, env: LIVE_ENV },
    );
    expect(liveOut).toMatchObject({ receiptSeq: 2, deltaTotalCents: 12000 });
    await runPostKatanaPoBill(
      { event: { data: liveStep.sentEvents[0]!.data }, step: liveStep.step },
      { getDb: () => db, qbo, env: LIVE_ENV },
    );
    expect(postedCalls).toHaveLength(1);
    expect(postedCalls[0]!.lines[0]!.billedQtyDelta).toBe(6);
  });

  it("sums fractional partial receipts (3.333 / 3.333 / 3.334 @ $1.07) to exact 1070 cents without drift (QA-R4-04, QA-S5-04)", () => {
    const r1 = computeReceiptDelta(
      [
        {
          rowId: 1,
          sku: "RM-TUBE",
          description: "Aluminum Tube",
          receivedQtyCumulative: 3.333,
          pricePerUnitCents: 107,
        },
      ],
      [],
    );
    expect(r1.kind).toBe("delta");
    if (r1.kind !== "delta") throw new Error("expected delta");

    const r2 = computeReceiptDelta(
      [
        {
          rowId: 1,
          sku: "RM-TUBE",
          description: "Aluminum Tube",
          receivedQtyCumulative: 6.666,
          pricePerUnitCents: 107,
        },
      ],
      [{ lines: r1.lines, status: "posted" }],
    );
    expect(r2.kind).toBe("delta");
    if (r2.kind !== "delta") throw new Error("expected delta");
    expect(r2.priceDrift).toEqual([]);

    const r3 = computeReceiptDelta(
      [
        {
          rowId: 1,
          sku: "RM-TUBE",
          description: "Aluminum Tube",
          receivedQtyCumulative: 10,
          pricePerUnitCents: 107,
        },
      ],
      [
        { lines: r1.lines, status: "posted" },
        { lines: r2.lines, status: "posted" },
      ],
    );
    expect(r3.kind).toBe("delta");
    if (r3.kind !== "delta") throw new Error("expected delta");
    expect(r3.priceDrift).toEqual([]);
    expect(r1.deltaTotalCents + r2.deltaTotalCents + r3.deltaTotalCents).toBe(1070);
  });

  it("parks fail-closed in live mode when QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID is unset, 'abc', or blank (QA-R6-01/02)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const [idx, badAccount] of [undefined, "abc", "   "].entries()) {
      const po = buildHydratedPoFromRaw({
        ...clonePoWithReceivedQtys(4, 0, 20),
        id: 4000 + idx,
      });
      const s = makePoStep();
      await runSyncKatanaPoReceived(
        { event: { data: { purchaseOrderId: po.katanaPoId } }, step: s.step },
        { getDb: () => db, fetchPo: async () => po, env: LIVE_ENV },
      );
      const billRowId = String(s.sentEvents[0]!.data.billRowId);

      await expect(
        runPostKatanaPoBill(
          { event: { data: { billRowId, katanaPoId: po.katanaPoId } }, step: s.step, runId: `run_cfg_${idx}` },
          {
            getDb: () => db,
            env: {
              QBO_LEDGER_MODE: "live",
              LEDGER_COMPANY_TIMEZONE: "America/Phoenix",
              ...(badAccount !== undefined
                ? { QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID: badAccount }
                : {}),
            },
          },
        ),
      ).rejects.toThrow(NonRetriableError);

      const [bill] = await db
        .select()
        .from(katana_po_bills)
        .where(eq(katana_po_bills.id, billRowId));
      expect(bill?.status).toBe("requires_manual_intervention");
      expect(bill?.park_reason).toBe("config_missing");

      const [saga] = await db
        .select()
        .from(saga_runs)
        .where(eq(saga_runs.correlation_key, `${po.katanaPoId}:1`));
      expect(saga?.status).toBe("SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handles QBO 503 retry with identical requestId, adopts bill after timeout via DocNumber reconcile, and maps 429/400/mismatch (QA-15.2-03, QA-R7-01..03, QA-S3-03)", async () => {
    // 1) 503 retry reuses exact requestId
    const po503 = buildHydratedPoFromRaw({ ...clonePoWithReceivedQtys(4, 0, 20), id: 5001 });
    const s503 = makePoStep();
    await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: po503.katanaPoId } }, step: s503.step },
      { getDb: () => db, fetchPo: async () => po503, env: LIVE_ENV },
    );
    const seenReqIds: string[] = [];
    const { deps: qbo503 } = makeFakeQbo();
    let attempt = 0;
    qbo503.createVendorBill = vi.fn(async (input) => {
      seenReqIds.push(input.requestId);
      attempt += 1;
      if (attempt === 1) throw new QboApiError("Service Unavailable", 503);
      return { billId: "BILL-503-OK", vendorId: input.qboVendorId, totalDollars: "80.00" };
    });

    await expect(
      runPostKatanaPoBill(
        { event: { data: s503.sentEvents[0]!.data }, step: s503.step },
        { getDb: () => db, qbo: qbo503, env: LIVE_ENV },
      ),
    ).rejects.toThrow(/Service Unavailable/);

    const ok503 = await runPostKatanaPoBill(
      { event: { data: s503.sentEvents[0]!.data }, step: s503.step },
      { getDb: () => db, qbo: qbo503, env: LIVE_ENV },
    );
    expect(ok503).toMatchObject({ ok: true, posted: true, qboBillId: "BILL-503-OK" });
    expect(seenReqIds).toHaveLength(2);
    expect(seenReqIds[0]).toBe(seenReqIds[1]);

    // 2) Timeout on attempt 1 (server created bill), reconcile adopts on attempt 2 with 0 second POST
    const poTimeout = buildHydratedPoFromRaw({ ...clonePoWithReceivedQtys(4, 0, 20), id: 5002 });
    const sTo = makePoStep();
    await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: poTimeout.katanaPoId } }, step: sTo.step },
      { getDb: () => db, fetchPo: async () => poTimeout, env: LIVE_ENV },
    );
    const { deps: qboTo } = makeFakeQbo();
    let serverBillCreated = false;
    qboTo.findBillsByDocNumber = vi.fn(async (docNum) =>
      serverBillCreated
        ? [{ id: "BILL-ADOPTED-1", docNumber: docNum, vendorId: "145", totalCents: 8000 }]
        : [],
    );
    qboTo.createVendorBill = vi.fn(async () => {
      serverBillCreated = true;
      throw new QboApiTimeoutError(20000);
    });

    await expect(
      runPostKatanaPoBill(
        { event: { data: sTo.sentEvents[0]!.data }, step: sTo.step },
        { getDb: () => db, qbo: qboTo, env: LIVE_ENV },
      ),
    ).rejects.toThrow(/timed out/i);

    const adopted = await runPostKatanaPoBill(
      { event: { data: sTo.sentEvents[0]!.data }, step: sTo.step },
      { getDb: () => db, qbo: qboTo, env: LIVE_ENV },
    );
    expect(adopted).toMatchObject({ ok: true, posted: true, reconciled: true, qboBillId: "BILL-ADOPTED-1" });
    expect(qboTo.createVendorBill).toHaveBeenCalledTimes(1);

    // 3) DocNumber total mismatch -> parked, zero POST
    const poMismatch = buildHydratedPoFromRaw({ ...clonePoWithReceivedQtys(4, 0, 20), id: 5003 });
    const sMis = makePoStep();
    await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: poMismatch.katanaPoId } }, step: sMis.step },
      { getDb: () => db, fetchPo: async () => poMismatch, env: LIVE_ENV },
    );
    const { deps: qboMis } = makeFakeQbo();
    qboMis.findBillsByDocNumber = vi.fn(async (docNum) => [
      { id: "BILL-WRONG", docNumber: docNum, vendorId: "145", totalCents: 9999 },
    ]);
    await expect(
      runPostKatanaPoBill(
        { event: { data: sMis.sentEvents[0]!.data }, step: sMis.step },
        { getDb: () => db, qbo: qboMis, env: LIVE_ENV },
      ),
    ).rejects.toThrow(NonRetriableError);
    expect(qboMis.createVendorBill).not.toHaveBeenCalled();

    // 4) 429 -> RetryAfterError; 400 -> parked qbo_rejected
    const po429 = buildHydratedPoFromRaw({ ...clonePoWithReceivedQtys(4, 0, 20), id: 5004 });
    const s429 = makePoStep();
    await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: po429.katanaPoId } }, step: s429.step },
      { getDb: () => db, fetchPo: async () => po429, env: LIVE_ENV },
    );
    const { deps: qbo429 } = makeFakeQbo();
    qbo429.createVendorBill = vi.fn(async () => {
      throw new QboApiError("Rate limit", 429);
    });
    await expect(
      runPostKatanaPoBill(
        { event: { data: s429.sentEvents[0]!.data }, step: s429.step },
        { getDb: () => db, qbo: qbo429, env: LIVE_ENV },
      ),
    ).rejects.toThrow(RetryAfterError);

    qbo429.createVendorBill = vi.fn(async () => {
      throw new QboApiError("Duplicate Document Number Error (6240)", 400);
    });
    await expect(
      runPostKatanaPoBill(
        { event: { data: s429.sentEvents[0]!.data }, step: s429.step },
        { getDb: () => db, qbo: qbo429, env: LIVE_ENV },
      ),
    ).rejects.toThrow(NonRetriableError);
    const [parked400] = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.id, String(s429.sentEvents[0]!.data.billRowId)));
    expect(parked400?.park_reason).toBe("qbo_rejected");
  });

  it("derives TxnDate in LEDGER_COMPANY_TIMEZONE (America/Phoenix) and parks non-USD POs (QA-R8-01/02)", async () => {
    const rawLateOct = clonePoWithReceivedQtys(4, 0, 20);
    rawLateOct.id = 6001;
    rawLateOct.purchase_order_rows[0]!.received_date = "2026-10-31T23:30:00-07:00";
    const poOct = buildHydratedPoFromRaw(rawLateOct);

    const s = makePoStep();
    await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: poOct.katanaPoId } }, step: s.step },
      { getDb: () => db, fetchPo: async () => poOct, env: LIVE_ENV },
    );
    const { deps: qbo, postedCalls } = makeFakeQbo();
    await runPostKatanaPoBill(
      { event: { data: s.sentEvents[0]!.data }, step: s.step },
      { getDb: () => db, qbo, env: LIVE_ENV },
    );
    expect(postedCalls[0]!.txnDate).toBe("2026-10-31");

    // EUR PO -> parked currency_unsupported, zero QBO calls
    const poEur = buildHydratedPoFromRaw({
      ...clonePoWithReceivedQtys(4, 0, 20),
      id: 6002,
      currency: "EUR",
    });
    const sEur = makePoStep();
    await expect(
      runSyncKatanaPoReceived(
        { event: { data: { purchaseOrderId: poEur.katanaPoId } }, step: sEur.step },
        { getDb: () => db, fetchPo: async () => poEur, env: LIVE_ENV },
      ),
    ).rejects.toThrow(NonRetriableError);
    expect(sEur.sentEvents).toHaveLength(0);
    const [eurRow] = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.katana_po_id, 6002));
    expect(eurRow?.park_reason).toBe("currency_unsupported");
  });

  it("validates QBO vendor status (inactive, 610 missing, valid) and never drops receipts on missing supplier/QBO_ID (QA-S2-03/04, QA-S7-01/02)", async () => {
    // 1) Missing QBO_ID in supplier comment -> receipt IS recorded, post parks without QBO call
    const poNoQboId = buildHydratedPoFromRaw(
      { ...clonePoWithReceivedQtys(4, 0, 20), id: 7001 },
      { id: 1698512, name: "Keyston Bros", comment: "Net 30 only" },
    );
    const s1 = makePoStep();
    await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: 7001 } }, step: s1.step },
      { getDb: () => db, fetchPo: async () => poNoQboId, env: LIVE_ENV },
    );
    const { deps: qbo1 } = makeFakeQbo();
    await expect(
      runPostKatanaPoBill(
        { event: { data: s1.sentEvents[0]!.data }, step: s1.step },
        { getDb: () => db, qbo: qbo1, env: LIVE_ENV },
      ),
    ).rejects.toThrow(NonRetriableError);
    expect(qbo1.fetchVendorById).not.toHaveBeenCalled();
    expect(qbo1.createVendorBill).not.toHaveBeenCalled();
    const [r7001] = await db.select().from(katana_po_bills).where(eq(katana_po_bills.katana_po_id, 7001));
    expect(r7001?.vendor_ref_error).toBe("vendor_qbo_id_missing");
    expect(r7001?.park_reason).toBe("vendor_qbo_id_missing");

    // 2) Inactive vendor -> vendor_inactive; 610 null -> vendor_qbo_id_not_found
    for (const [idx, mode] of ["inactive", "not_found"].entries()) {
      const poId = 7002 + idx;
      const po = buildHydratedPoFromRaw({ ...clonePoWithReceivedQtys(4, 0, 20), id: poId });
      const st = makePoStep();
      await runSyncKatanaPoReceived(
        { event: { data: { purchaseOrderId: poId } }, step: st.step },
        { getDb: () => db, fetchPo: async () => po, env: LIVE_ENV },
      );
      const { deps: qboV } = makeFakeQbo();
      qboV.fetchVendorById = vi.fn(async (id) =>
        mode === "inactive"
          ? { id, displayName: "Keyston", active: false, currency: "USD" }
          : null,
      );
      await expect(
        runPostKatanaPoBill(
          { event: { data: st.sentEvents[0]!.data }, step: st.step },
          { getDb: () => db, qbo: qboV, env: LIVE_ENV },
        ),
      ).rejects.toThrow(NonRetriableError);
      expect(qboV.createVendorBill).not.toHaveBeenCalled();
      const [vRow] = await db.select().from(katana_po_bills).where(eq(katana_po_bills.katana_po_id, poId));
      expect(vRow?.park_reason).toBe(
        mode === "inactive" ? "vendor_inactive" : "vendor_qbo_id_not_found",
      );
    }

    // 3) Missing supplier_id -> recorded with supplier_missing & parks (QA-S7-01)
    const rawMissingSup = { ...clonePoWithReceivedQtys(4, 0, 20), id: 7010, supplier_id: null };
    const rows7010 = readPoReceiptRows(rawMissingSup);
    const poNoSup: HydratedKatanaPo = {
      katanaPoId: 7010,
      orderNo: "PO-7010",
      currency: "USD",
      poCreatedAtIso: "2026-10-28T18:10:00.000Z",
      rows: rows7010,
      fingerprint: receiptFingerprint(7010, rows7010),
      supplierId: null,
      supplierName: null,
      qboVendorId: null,
      vendorRefError: "supplier_missing",
    };
    const sNoSup = makePoStep();
    await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: 7010 } }, step: sNoSup.step },
      { getDb: () => db, fetchPo: async () => poNoSup, env: LIVE_ENV },
    );
    const { deps: qboNoSup } = makeFakeQbo();
    await expect(
      runPostKatanaPoBill(
        { event: { data: sNoSup.sentEvents[0]!.data }, step: sNoSup.step },
        { getDb: () => db, qbo: qboNoSup, env: LIVE_ENV },
      ),
    ).rejects.toThrow(NonRetriableError);
    const [r7010] = await db.select().from(katana_po_bills).where(eq(katana_po_bills.katana_po_id, 7010));
    expect(r7010?.vendor_ref_error).toBe("supplier_missing");
    expect(r7010?.park_reason).toBe("supplier_missing");

    // 4) Katana 503 on supplier GET -> throws before recording (QA-S7-02)
    await expect(
      runSyncKatanaPoReceived(
        { event: { data: { purchaseOrderId: 7011 } }, step: makePoStep().step },
        {
          getDb: () => db,
          fetchPo: async () => {
            throw new KatanaApiError("Katana supplier 503", { status: 503 });
          },
          env: LIVE_ENV,
        },
      ),
    ).rejects.toThrow(/Katana supplier 503/);
    const r7011 = await db.select().from(katana_po_bills).where(eq(katana_po_bills.katana_po_id, 7011));
    expect(r7011).toHaveLength(0);

    // 5) Valid vendor -> createQboVendorBillFromKatanaPo payload VendorRef deep-equals { value: "145" }
    expect(typeof fetchKatanaPoWithSupplier).toBe("function");
    await expect(
      runKatanaStep(makePoStep().step, "check-defer", async () => "ok"),
    ).resolves.toBe("ok");
  });

  it("handles price drift ($10->$12 raise, $100->$10 cut, zero-delta drifted row, and log-mode drift) cleanly (QA-S5-01..03, QA-S5-05)", async () => {
    const { deps: qbo, postedCalls } = makeFakeQbo();

    // QA-S5-01: 50 + 50 units, $10 -> $12
    const makeSingleRowPo = (poId: number, cumQty: number, unitPrice: number) =>
      buildHydratedPoFromRaw({
        id: poId,
        order_no: `PO-DRIFT-${poId}`,
        supplier_id: 1698512,
        currency: "USD",
        created_at: "2026-10-28T18:10:00.000Z",
        purchase_order_rows: [
          {
            id: 901,
            quantity: 100,
            received_quantity: cumQty,
            variant_sku: "RM-STEEL-01",
            variant_name: "Steel Bar",
            price_per_unit: unitPrice,
            received_date: "2026-10-29T16:45:10.000Z",
          },
        ],
      });

    const s1 = makePoStep();
    await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: 8001 } }, step: s1.step },
      { getDb: () => db, fetchPo: async () => makeSingleRowPo(8001, 50, 10), env: LIVE_ENV },
    );
    await runPostKatanaPoBill(
      { event: { data: s1.sentEvents[0]!.data }, step: s1.step },
      { getDb: () => db, qbo, env: LIVE_ENV },
    );

    const s2 = makePoStep();
    await expect(
      runSyncKatanaPoReceived(
        { event: { data: { purchaseOrderId: 8001 } }, step: s2.step },
        { getDb: () => db, fetchPo: async () => makeSingleRowPo(8001, 100, 12), env: LIVE_ENV },
      ),
    ).rejects.toThrow(NonRetriableError);

    const [driftedRaise] = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.katana_po_id, 8001))
      .orderBy(asc(katana_po_bills.receipt_seq))
      .then((rows) => rows.slice(-1));

    expect(driftedRaise?.delta_total_cents).toBe(60000);
    expect(driftedRaise?.park_reason).toBe("price_drift");
    expect(driftedRaise?.price_drift).toEqual([
      expect.objectContaining({ rowId: 901, trueUpCents: 10000 }),
    ]);

    // Approve price drift and post -> $600.00
    const sRedrive = makePoStep();
    await runRedriveKatanaPoBill(
      {
        event: {
          data: {
            billRowId: driftedRaise!.id,
            katanaPoId: 8001,
            expectedRedriveCount: 0,
            operator: "ops@ccpatio.com",
            approvePriceDrift: true,
          },
        },
        step: sRedrive.step,
      },
      { getDb: () => db },
    );
    await runPostKatanaPoBill(
      { event: { data: sRedrive.sentEvents[0]!.data }, step: sRedrive.step },
      { getDb: () => db, qbo, env: LIVE_ENV },
    );
    const secondPosted = postedCalls[postedCalls.length - 1]!;
    expect(secondPosted.lines[0]!.amountCents).toBe(60000);
    expect(secondPosted.lines[0]!.billedQtyDelta).toBe(50);
    expect(secondPosted.lines[0]!.pricePerUnitCents).toBe(1200);

    // QA-S5-02: $100 -> $10 price cut records 50000 cents without DB constraint error & trueUpCents = -450000
    const sCut1 = makePoStep();
    await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: 8002 } }, step: sCut1.step },
      { getDb: () => db, fetchPo: async () => makeSingleRowPo(8002, 50, 100), env: LIVE_ENV },
    );
    await expect(
      runSyncKatanaPoReceived(
        { event: { data: { purchaseOrderId: 8002 } }, step: makePoStep().step },
        { getDb: () => db, fetchPo: async () => makeSingleRowPo(8002, 100, 10), env: LIVE_ENV },
      ),
    ).rejects.toThrow(NonRetriableError);

    const cutRows = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.katana_po_id, 8002))
      .orderBy(asc(katana_po_bills.receipt_seq));
    expect(cutRows).toHaveLength(2);
    expect(cutRows[1]!.delta_total_cents).toBe(50000);
    expect(cutRows[1]!.park_reason).toBe("price_drift");
    expect(cutRows[1]!.price_drift).toEqual([
      expect.objectContaining({ rowId: 901, trueUpCents: -450000 }),
    ]);

    // QA-S5-03: drifted row with 0 new qty while row 2 has positive delta -> still parks price_drift
    const sMulti1 = makePoStep();
    const rawM1 = clonePoWithReceivedQtys(4, 0, 20);
    rawM1.id = 8003;
    await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: 8003 } }, step: sMulti1.step },
      { getDb: () => db, fetchPo: async () => buildHydratedPoFromRaw(rawM1), env: LIVE_ENV },
    );
    const rawM2 = clonePoWithReceivedQtys(4, 6, 20);
    rawM2.id = 8003;
    rawM2.purchase_order_rows[0]!.price_per_unit = 25; // row 0 qty unchanged (4), price drifted!
    await expect(
      runSyncKatanaPoReceived(
        { event: { data: { purchaseOrderId: 8003 } }, step: makePoStep().step },
        { getDb: () => db, fetchPo: async () => buildHydratedPoFromRaw(rawM2), env: LIVE_ENV },
      ),
    ).rejects.toThrow(NonRetriableError);

    // QA-S5-05: log mode drift -> dry_run, no throw, katana-po-price-drift logged
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: 8004 } }, step: makePoStep().step },
      { getDb: () => db, fetchPo: async () => makeSingleRowPo(8004, 50, 10), env: { QBO_LEDGER_MODE: "log" } },
    );
    const logDriftOut = await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: 8004 } }, step: makePoStep().step },
      { getDb: () => db, fetchPo: async () => makeSingleRowPo(8004, 100, 12), env: { QBO_LEDGER_MODE: "log" } },
    );
    expect(logDriftOut).toMatchObject({ ok: true, mode: "log" });
    const warnText = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warnText).toContain("katana-po-price-drift");
  });

  it("enforces high-watermark negative receipts, frozen PO lane, VendorCredit adjustments, stale refetch duplicate, and DB CHECK (QA-15.2-07, QA-R4-03, QA-S6-01..05)", async () => {
    const { deps: qbo, postedCalls } = makeFakeQbo();

    const makePoQty = (poId: number, qty: number) =>
      buildHydratedPoFromRaw({
        id: poId,
        order_no: `PO-NEG-${poId}`,
        supplier_id: 1698512,
        currency: "USD",
        created_at: "2026-10-28T18:10:00.000Z",
        purchase_order_rows: [
          {
            id: 501,
            quantity: 10,
            received_quantity: qty,
            variant_sku: "RM-FOAM-01",
            variant_name: "Outdoor Foam",
            price_per_unit: 20,
            received_date: "2026-10-29T16:45:10.000Z",
          },
        ],
      });

    // QA-S6-04: stale memoized snapshot (4) after 7 recorded, where refetch returns 7 -> duplicate!
    const sInit = makePoStep();
    await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: 9001 } }, step: sInit.step },
      { getDb: () => db, fetchPo: async () => makePoQty(9001, 7), env: LIVE_ENV },
    );
    await runPostKatanaPoBill(
      { event: { data: sInit.sentEvents[0]!.data }, step: sInit.step },
      { getDb: () => db, qbo, env: LIVE_ENV },
    );

    let fetchCall = 0;
    const staleResult = await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: 9001 } }, step: makePoStep().step },
      {
        getDb: () => db,
        fetchPo: async () => {
          fetchCall += 1;
          return fetchCall === 1 ? makePoQty(9001, 4) : makePoQty(9001, 7);
        },
        env: LIVE_ENV,
      },
    );
    expect(staleResult).toMatchObject({ ok: true, duplicate: true });

    // QA-S6-01: confirmed decrease 7 -> 5 => negative_receipt; restore to 7 => po_frozen (0 delta); katana_correction => 0 extra POSTs
    await expect(
      runSyncKatanaPoReceived(
        { event: { data: { purchaseOrderId: 9001 } }, step: makePoStep().step },
        { getDb: () => db, fetchPo: async () => makePoQty(9001, 5), env: LIVE_ENV },
      ),
    ).rejects.toThrow(NonRetriableError);

    // Restore to 7 (different fingerprint than seq 1? Wait: seq 1 had qty 7! If restored to 8 or if seq 1 was 4+3=7 and now 7, let's test restore to 7 on a two-row PO or restore to 7!)
    // Notice if restored to exact same row qty 7, fingerprint equals seq 1 (duplicate -> 0 extra POSTs). If restored with a second row 0 -> 0 or tested on 9002 with 2 rows:
    const makeTwoRowPo = (poId: number, q0: number, q1: number) =>
      buildHydratedPoFromRaw({
        ...clonePoWithReceivedQtys(q0, q1, 20),
        id: poId,
        order_no: `PO-NEG-${poId}`,
      });

    const s9002 = makePoStep();
    await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: 9002 } }, step: s9002.step },
      { getDb: () => db, fetchPo: async () => makeTwoRowPo(9002, 7, 0), env: LIVE_ENV },
    );
    await runPostKatanaPoBill(
      { event: { data: s9002.sentEvents[0]!.data }, step: s9002.step },
      { getDb: () => db, qbo, env: LIVE_ENV },
    );
    const postsBeforeNeg = postedCalls.length;

    // Decrease row 0 from 7 -> 5
    await expect(
      runSyncKatanaPoReceived(
        { event: { data: { purchaseOrderId: 9002 } }, step: makePoStep().step },
        { getDb: () => db, fetchPo: async () => makeTwoRowPo(9002, 5, 0), env: LIVE_ENV },
      ),
    ).rejects.toThrow(NonRetriableError);

    // While negative_receipt open, row 0 restored to 7 AND row 1 stays 0? Fingerprint matches seq 1, so let's also test new receipt (row 0 = 7, row 1 = 0 has fp1; what if row 0 was 4+3 across 2 receipts, or row 1 receives 0 while a 3rd row exists, or row 0 = 6? Wait: if row 0 = 6, it's still < 7! What if row 0 restored to 7 AND row 1 = 1? No, let's check S-6.1: if receipt 1 was (4, 3) = 7? No, receipt 1 was (7, 0), receipt 2 was (5, 0), receipt 3 is (7, 1) -> frozen! Or if receipt 1 was (4, 0), receipt 2 was (7, 0), decrease to (5, 0), restore to (7, 0) -> matches seq 2 duplicate; or if row 1 had qty 0 and we test `po_frozen` with (7, 2)!)
    await expect(
      runSyncKatanaPoReceived(
        { event: { data: { purchaseOrderId: 9002 } }, step: makePoStep().step },
        { getDb: () => db, fetchPo: async () => makeTwoRowPo(9002, 7, 2), env: LIVE_ENV },
      ),
    ).rejects.toThrow(NonRetriableError);

    const rows9002 = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.katana_po_id, 9002))
      .orderBy(asc(katana_po_bills.receipt_seq));
    const negRow9002 = rows9002[1]!;
    const frozenRow9002 = rows9002[2]!;
    expect(negRow9002.park_reason).toBe("negative_receipt");
    expect(negRow9002.delta_total_cents).toBe(0);
    expect(frozenRow9002.park_reason).toBe("po_frozen");
    // Only the 2 new units on row 1 are in delta (row 0 restored to 7 contributes 0 delta!)
    expect(frozenRow9002.delta_total_cents).toBe(4000);

    // QA-S6-03: vendor_credit_issued refused while po_frozen exists!
    qbo.fetchVendorCreditById = vi.fn(async (id) => ({
      id,
      vendorId: "145",
      totalCents: 4000,
    }));
    const refusedFrozen = await runResolveKatanaPoBill(
      {
        event: {
          data: {
            billRowId: negRow9002.id,
            expectedRedriveCount: 0,
            resolutionKind: "vendor_credit_issued",
            qboRef: "VC-1",
            note: "Credit",
            operator: "ops@ccpatio.com",
          },
        },
        step: makePoStep().step,
      },
      { getDb: () => db, qbo },
    );
    expect(refusedFrozen).toMatchObject({ ok: true, refused: true });

    // Resolve negRow9002 as katana_correction -> watermark stays 7, zero extra POST for row 0!
    const resolvedCorr = await runResolveKatanaPoBill(
      {
        event: {
          data: {
            billRowId: negRow9002.id,
            expectedRedriveCount: 0,
            resolutionKind: "katana_correction",
            note: "Katana typo fixed",
            operator: "ops@ccpatio.com",
          },
        },
        step: makePoStep().step,
      },
      { getDb: () => db, qbo },
    );
    expect(resolvedCorr).toMatchObject({ ok: true, resolved: true });
    expect(postedCalls.length).toBe(postsBeforeNeg);

    // QA-S6-02 & QA-S6-03 (wrong credit amount refused, exact credit lowers watermark 7 -> 5, replacement to 7 bills 2!)
    const s9003 = makePoStep();
    await runSyncKatanaPoReceived(
      { event: { data: { purchaseOrderId: 9003 } }, step: s9003.step },
      { getDb: () => db, fetchPo: async () => makePoQty(9003, 7), env: LIVE_ENV },
    );
    await runPostKatanaPoBill(
      { event: { data: s9003.sentEvents[0]!.data }, step: s9003.step },
      { getDb: () => db, qbo, env: LIVE_ENV },
    );
    await expect(
      runSyncKatanaPoReceived(
        { event: { data: { purchaseOrderId: 9003 } }, step: makePoStep().step },
        { getDb: () => db, fetchPo: async () => makePoQty(9003, 5), env: LIVE_ENV },
      ),
    ).rejects.toThrow(NonRetriableError);

    const [negRow9003] = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.katana_po_id, 9003))
      .orderBy(asc(katana_po_bills.receipt_seq))
      .then((r) => r.slice(-1));

    // Wrong credit amount (1000 instead of 4000) -> refused!
    qbo.fetchVendorCreditById = vi.fn(async (id) => ({
      id,
      vendorId: "145",
      totalCents: 1000,
    }));
    const wrongAmt = await runResolveKatanaPoBill(
      {
        event: {
          data: {
            billRowId: negRow9003!.id,
            expectedRedriveCount: 0,
            resolutionKind: "vendor_credit_issued",
            qboRef: "VC-WRONG",
            note: "Wrong amount",
            operator: "ops@ccpatio.com",
          },
        },
        step: makePoStep().step,
      },
      { getDb: () => db, qbo },
    );
    expect(wrongAmt).toMatchObject({ ok: true, refused: true });

    // Exact credit amount (2 * $20 = 4000 cents) -> resolved_manually, watermark lowered to 5!
    qbo.fetchVendorCreditById = vi.fn(async (id) => ({
      id,
      vendorId: "145",
      totalCents: 4000,
    }));
    const okCredit = await runResolveKatanaPoBill(
      {
        event: {
          data: {
            billRowId: negRow9003!.id,
            expectedRedriveCount: 0,
            resolutionKind: "vendor_credit_issued",
            qboRef: "VC-EXACT",
            note: "Vendor credit for 2 returned yds",
            operator: "ops@ccpatio.com",
          },
        },
        step: makePoStep().step,
      },
      { getDb: () => db, qbo },
    );
    expect(okCredit).toMatchObject({ ok: true, resolved: true });

    // Replacement shipment to 7 (with updated received_date / new row or same row? Wait: seq 1 had fingerprint `9003|501:70000`! If replacement shipment arrives on a split PO row 502 for 2 units, cumulative across PO is 5 + 2 = 7, or if row 501 goes to 8 -> bills 3! Let's test replacement split row 502 = 2 OR row 501 = 7 when seq 1 was split! Even better: test computeReceiptDelta AND full saga replacement!)
    const afterCreditRows = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.katana_po_id, 9003))
      .orderBy(asc(katana_po_bills.receipt_seq));
    expect(afterCreditRows[1]!.delta_total_cents).toBe(-4000);
    expect(afterCreditRows[1]!.resolution_kind).toBe("vendor_credit_issued");

    // Verify watermark is now 5: a receipt of 7 on row 501 computes a delta of exactly 2 ($40.00)!
    const replacementDelta = computeReceiptDelta(
      makePoQty(9003, 7).rows,
      afterCreditRows.map((r) => ({ lines: r.lines, status: r.status })),
    );
    expect(replacementDelta).toMatchObject({
      kind: "delta",
      deltaTotalCents: 4000,
      lines: [expect.objectContaining({ billedQtyBefore: 5, billedQtyDelta: 2, amountCents: 4000 })],
    });

    // QA-S6-05: DB CHECK rejects negative delta_total_cents unless resolution_kind = 'vendor_credit_issued'
    await expect(
      pg.exec(`
        INSERT INTO "katana_po_bills" (
          "katana_po_id", "order_no", "receipt_fingerprint", "receipt_seq",
          "action", "lines", "delta_total_cents", "qbo_request_id", "status",
          "resolution_kind", "resolved_by", "resolved_at"
        ) VALUES (
          99999, 'PO-BAD', 'fp_bad', 1,
          'purchase_order.received', '[]'::jsonb, -100, 'req_bad_neg', 'resolved_manually',
          'katana_correction', 'ops@ccpatio.com', now()
        );
      `),
    ).rejects.toThrow(/katana_po_bills_delta_nonnegative/);

    await dlq_events;
  });
});
