import { createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import moListFixture from "./fixtures/katana/manufacturing-orders-by-so.json";
import poPartialFixture from "./fixtures/katana/purchase-order-partially-received.json";
import poReceivedFixture from "./fixtures/katana/purchase-order-received.json";
import soGhlFixture from "./fixtures/katana/sales-order-ghl.json";
import supplierFixture from "./fixtures/katana/supplier.json";
import { inngest } from "@/inngest/client";
import { resolveDlqContext } from "@/inngest/dlq-context";
import {
  archiveKatanaVariant,
  healKatanaVariantSkuFn,
  inngestFunctions,
  katanaMoDone,
  katanaOrderStatusReconcile,
  postKatanaPoBill,
  pushGhlFactoryStage,
  redriveKatanaPoBill,
  refreshKatanaPoBillVendor,
  resolveKatanaPoBill,
  syncKatanaOrderStatus,
  syncKatanaPoReceived,
} from "@/inngest/functions";
import {
  GHL_FACTORY_STAGE_PUSH_EVENT,
  runPushGhlFactoryStage,
  type PushGhlStageStepLike,
} from "@/inngest/ghl-factory-stage-push";
import {
  KATANA_MO_DONE_EVENT,
  KATANA_SO_STATUS_EVENT,
  RECONCILE_BATCH_LIMIT,
  fetchKatanaSalesOrderSnapshot,
  formatReconcileHourBucket,
  listKatanaMoSnapshotsForSalesOrder,
  runKatanaMoDone,
  runKatanaOrderStatusReconcile,
  runSyncKatanaOrderStatus,
  type MoDoneStepLike,
  type OrderStatusStepLike,
  type ReconcileStepLike,
} from "@/inngest/katana-order-status";
import {
  runPostKatanaPoBill,
  runRedriveKatanaPoBill,
  runResolveKatanaPoBill,
  type PoBillPostStepLike,
  type QboPostDeps,
} from "@/inngest/katana-po-bill-post";
import {
  fetchKatanaPoSupplierOnly,
  fetchKatanaPoWithSupplier,
  runRefreshKatanaPoBillVendor,
  runSyncKatanaPoReceived,
  type HydratedKatanaPo,
  type HydratedKatanaSupplier,
  type PoReceivedStepLike,
} from "@/inngest/katana-po-received";
import type { MiddlewareDb } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import {
  custom_build_job_items,
  custom_build_jobs,
  dlq_events,
  incoming_webhooks,
  katana_po_bills,
  order_intake,
  saga_runs,
} from "@/server/db/schema";
import {
  assertStageConfigDisjoint,
  moveOpportunityStage,
  stageIdFor,
  validateGhlStageConfigAgainstPipelines,
  type GhlStageEnvMap,
  type MoveOpportunityStageDeps,
} from "@/server/ghl/opportunity-stage";
import type { GhlResult } from "@/server/ghl/private-api";
import {
  deriveFactoryStage,
  laneForOrderNo,
  opportunityIdFromOrderNo,
  parseOrderNoLane,
  readManufacturingOrderSnapshot,
  readSalesOrderSnapshot,
  type KatanaMoSnapshot,
  type KatanaSoSnapshot,
} from "@/server/katana/order-status";
import {
  KATANA_PO_BILL_REDRIVE_EVENT,
  KATANA_PO_BILL_RESOLVE_EVENT,
  KATANA_PO_BILL_SAGA_TYPE,
  derivePoBillRequestId,
  parseQboVendorIdFromSupplier,
  readPoReceiptRows,
  receiptFingerprint,
} from "@/server/katana/po-receipt-ledger";
import { loadKatanaVariantSku } from "@/server/katana/variant-webhook";
import { PATH_A_GHL_SYNC_REQUESTED_EVENT, PATH_A_SAGA_TYPE } from "@/server/path-a/events";
import {
  canPushGhlFactoryStage,
  getKatanaReverseSyncMode,
} from "@/server/pipeline/katana-reverse-mode";
import { KATANA_TENANT_CONCURRENCY } from "@/server/sre/katana-throttle";
import { runPoBillsCli, type OutboundPoBillDomainEvent } from "../scripts/ops/redrive-parked-po-bills";

const activeTestDbRef = vi.hoisted(() => ({
  current: null as MiddlewareDb | null,
}));

vi.mock("@/server/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/db/client")>();
  return {
    ...actual,
    getDb: () => activeTestDbRef.current ?? actual.getDb(),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function importSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const specs: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    specs.push(m[1]!);
  }
  return specs;
}

function walkFiles(dir: string, exts = /\.(ts|tsx)$/, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, exts, out);
    else if (exts.test(entry.name)) out.push(full);
  }
  return out;
}

function optsOf(fn: unknown): Record<string, unknown> {
  return ((fn as { opts?: Record<string, unknown> }).opts ?? {}) as Record<string, unknown>;
}

function concurrencyEntries(fn: unknown): Array<Record<string, unknown>> {
  const c = optsOf(fn).concurrency;
  if (!c) return [];
  return (Array.isArray(c) ? c : [c]) as Array<Record<string, unknown>>;
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
  CREATE TABLE "custom_build_job_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "job_id" uuid NOT NULL REFERENCES "custom_build_jobs"("id") ON DELETE RESTRICT,
    "global_sku" text NOT NULL UNIQUE,
    "quantity" integer DEFAULT 1 NOT NULL,
    "design_status" text DEFAULT 'awaiting_cad' NOT NULL,
    "cad_upload_id" uuid,
    "finalized_dossier_hash" text,
    "finalized_at" timestamp with time zone,
    "finalized_by" text,
    "katana_sales_order_row_id" integer,
    "katana_mo_id" integer,
    "released_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "incoming_webhooks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "source" text NOT NULL,
    "event_name" text NOT NULL,
    "idempotency_key" text NOT NULL UNIQUE,
    "payload" jsonb NOT NULL,
    "status" text DEFAULT 'received' NOT NULL,
    "error_message" text,
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

async function createPhase15ResilienceDb(): Promise<{
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

function makeOrderStatusStep() {
  const sentEvents: Array<{
    stepId: string;
    id?: string;
    name: string;
    data: { opportunityId: string };
  }> = [];
  const step: OrderStatusStepLike = {
    run: async (_id, fn) => fn(),
    sendEvent: async (stepId, payload) => {
      sentEvents.push({ stepId, ...payload });
      return { ids: [payload.id ?? "evt"] };
    },
  };
  return { step, sentEvents };
}

function makeMoDoneStep(onSleep?: () => Promise<void> | void) {
  const sentEvents: Array<{
    stepId: string;
    id?: string;
    name: string;
    data: Record<string, unknown>;
  }> = [];
  const sleeps: Array<{ id: string; duration: string }> = [];
  const step: MoDoneStepLike = {
    run: async (_id, fn) => fn(),
    sleep: async (id, duration) => {
      sleeps.push({ id, duration });
      if (onSleep) await onSleep();
    },
    sendEvent: async (stepId, payload) => {
      sentEvents.push({ stepId, ...payload });
      return { ids: [payload.id ?? "evt"] };
    },
  };
  return { step, sentEvents, sleeps };
}

function makePushGhlStep() {
  const sentEvents: Array<{
    stepId: string;
    id?: string;
    name: string;
    data: Record<string, unknown>;
  }> = [];
  const step: PushGhlStageStepLike = {
    run: async (_id, fn) => fn(),
    sendEvent: async (stepId, payload) => {
      sentEvents.push({ stepId, ...payload });
      return { ids: [payload.id ?? "evt"] };
    },
  };
  return { step, sentEvents };
}

function makePoStep() {
  const sentEvents: Array<{
    stepId: string;
    id?: string;
    name: string;
    data: Record<string, unknown>;
  }> = [];
  const step: PoReceivedStepLike & PoBillPostStepLike = {
    run: async (_id, fn) => fn(),
    sendEvent: async (stepId, payload) => {
      sentEvents.push({ stepId, ...payload });
      return { ids: [payload.id ?? "evt"] };
    },
  };
  return { step, sentEvents };
}

function makeHydratedPoFromFixtures(overrides?: {
  rawPo?: Record<string, unknown>;
  rawSupplier?: Record<string, unknown> | null;
  supplierId?: number | null;
}): HydratedKatanaPo {
  const rawPo = overrides?.rawPo ?? (structuredClone(poPartialFixture) as Record<string, unknown>);
  const rawSupplier =
    overrides?.rawSupplier !== undefined
      ? overrides.rawSupplier
      : (structuredClone(supplierFixture) as Record<string, unknown>);
  const rows = readPoReceiptRows(rawPo);
  const fingerprint = receiptFingerprint(Number(rawPo.id), rows);
  const supplierId =
    overrides?.supplierId !== undefined ? overrides.supplierId : Number(rawPo.supplier_id ?? 4021901);

  if (supplierId === null) {
    return {
      katanaPoId: Number(rawPo.id),
      orderNo: String(rawPo.order_no ?? `PO-${rawPo.id}`),
      currency: String(rawPo.currency ?? "USD").toUpperCase(),
      poCreatedAtIso: String(rawPo.created_at ?? "2026-04-10T16:00:00.000Z"),
      supplierId: null,
      supplierName: null,
      qboVendorId: null,
      vendorRefError: "supplier_missing",
      rows,
      fingerprint,
    };
  }

  if (rawSupplier === null) {
    return {
      katanaPoId: Number(rawPo.id),
      orderNo: String(rawPo.order_no ?? `PO-${rawPo.id}`),
      currency: String(rawPo.currency ?? "USD").toUpperCase(),
      poCreatedAtIso: String(rawPo.created_at ?? "2026-04-10T16:00:00.000Z"),
      supplierId,
      supplierName: null,
      qboVendorId: null,
      vendorRefError: "supplier_not_found",
      rows,
      fingerprint,
    };
  }

  const parsedVendor = parseQboVendorIdFromSupplier(rawSupplier);
  return {
    katanaPoId: Number(rawPo.id),
    orderNo: String(rawPo.order_no ?? `PO-${rawPo.id}`),
    currency: String(rawPo.currency ?? "USD").toUpperCase(),
    poCreatedAtIso: String(rawPo.created_at ?? "2026-04-10T16:00:00.000Z"),
    supplierId,
    supplierName: typeof rawSupplier.name === "string" ? rawSupplier.name : null,
    qboVendorId: parsedVendor.ok ? parsedVendor.qboVendorId : null,
    vendorRefError: parsedVendor.ok ? null : parsedVendor.reason,
    rows,
    fingerprint,
  };
}

const VALID_QBO_ENV: Record<string, string> = {
  QBO_LEDGER_MODE: "live",
  QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID: "4200",
  LEDGER_COMPANY_TIMEZONE: "America/Phoenix",
};

const VALID_GHL_ENV: GhlStageEnvMap = {
  KATANA_REVERSE_SYNC_MODE: "live",
  GHL_LOCATION_ID: "loc_ccpatio_1",
  GHL_FACTORY_PIPELINE_ID: "pipe_factory_1",
  GHL_FACTORY_STAGE_IDS: "stg_produce_factory_1",
  GHL_WON_STAGE_IDS: "stg_won_1",
  GHL_STAGE_ID_IN_PRODUCTION: "stg_in_prod",
  GHL_STAGE_ID_BUILD_COMPLETE: "stg_build_done",
  GHL_STAGE_ID_READY_TO_SHIP: "stg_ready_ship",
  GHL_STAGE_ID_DELIVERED: "stg_delivered",
};

const VALID_PIPELINES_PAYLOAD = {
  pipelines: [
    {
      id: "pipe_factory_1",
      name: "Factory Production",
      stages: [
        { id: "stg_produce_factory_1", name: "Produce Factory Order" },
        { id: "stg_won_1", name: "Won Deposit" },
        { id: "stg_in_prod", name: "In Production" },
        { id: "stg_build_done", name: "Build Complete" },
        { id: "stg_ready_ship", name: "Ready To Ship" },
        { id: "stg_delivered", name: "Delivered" },
      ],
    },
  ],
};

function makeHappyQboDeps(overrides: Partial<QboPostDeps> = {}): QboPostDeps {
  return {
    fetchVendorById: vi.fn(async (vendorId: string) => ({
      id: vendorId,
      displayName: "Sunbrella Fabrics Trade",
      active: true,
      currency: "USD",
    })),
    findBillsByDocNumber: vi.fn(async () => []),
    createVendorBill: vi.fn(async (input) => ({
      billId: "qbo_bill_9001",
      vendorId: input.qboVendorId,
      totalDollars: (
        input.lines.reduce((s: number, l: { amountCents: number }) => s + l.amountCents, 0) / 100
      ).toFixed(2),
    })),
    fetchBillById: vi.fn(async (id: string) => ({
      id,
      docNumber: "PO-2026-0418",
      vendorId: "145",
      totalCents: 55000,
      currency: "USD",
    })),
    fetchVendorCreditById: vi.fn(async (id: string) => ({
      id,
      vendorId: "145",
      totalCents: 11000,
      currency: "USD",
    })),
    ...overrides,
  };
}

describe("Section I & static architecture guards (QA-I-01/06/08, QA-15.4-08/09, QA-R1, QA-R5, QA-R9, QA-R11-07, QA-R13, QA-S1-05, QA-S4-06/08, QA-S8)", () => {
  it("QA-I-01: zero deprecated Woo URL env names across src/, scripts/, tests/, and .env.example", () => {
    const deprecatedPattern = new RegExp(
      [
        "WOOCOMMERCE_" + "API_URL",
        "WOOCOMMERCE_" + "BASE_URL",
        "WOOCOMMERCE_" + "STORE_URL",
        "WOO_" + "API_URL",
        "WOO_" + "URL\\b",
        "WC_" + "STORE_URL",
      ].join("|"),
    );

    const files = [
      ...walkFiles(path.join(ROOT, "src")),
      ...walkFiles(path.join(ROOT, "scripts")),
      ...walkFiles(path.join(ROOT, "tests")),
      path.join(ROOT, ".env.example"),
    ];

    const hits = files.filter((f) => deprecatedPattern.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("QA-I-06: ledger-mode.ts and katana-reverse-mode.ts contain zero module-scope process.env reads", () => {
    for (const rel of [
      "src/server/pipeline/ledger-mode.ts",
      "src/server/pipeline/katana-reverse-mode.ts",
    ]) {
      const code = stripComments(read(rel));
      expect(code, rel).not.toMatch(/^(?:export\s+)?(?:const|let|var)\s+\w+[^\n]*process\.env/m);
    }

    expect(getKatanaReverseSyncMode({})).toBe("log");
    expect(getKatanaReverseSyncMode({ KATANA_REVERSE_SYNC_MODE: "LIVE" })).toBe("live");
    expect(getKatanaReverseSyncMode({ KATANA_REVERSE_SYNC_MODE: "unexpected" })).toBe("log");
    expect(canPushGhlFactoryStage({})).toBe(false);
    expect(canPushGhlFactoryStage({ KATANA_REVERSE_SYNC_MODE: "live" })).toBe(true);
  });

  it("QA-I-08: assertStageConfigDisjoint rejects overlap with GHL_FACTORY_STAGE_IDS, GHL_WON_STAGE_IDS, and duplicate GHL_STAGE_ID_* values", () => {
    expect(() => assertStageConfigDisjoint(VALID_GHL_ENV)).not.toThrow();

    expect(() =>
      assertStageConfigDisjoint({
        ...VALID_GHL_ENV,
        GHL_STAGE_ID_IN_PRODUCTION: "stg_produce_factory_1",
      }),
    ).toThrow(/overlaps GHL_FACTORY_STAGE_IDS or GHL_WON_STAGE_IDS/);

    expect(() =>
      assertStageConfigDisjoint({
        ...VALID_GHL_ENV,
        GHL_STAGE_ID_DELIVERED: "stg_won_1",
      }),
    ).toThrow(/overlaps GHL_FACTORY_STAGE_IDS or GHL_WON_STAGE_IDS/);

    expect(() =>
      assertStageConfigDisjoint({
        ...VALID_GHL_ENV,
        GHL_STAGE_ID_READY_TO_SHIP: "stg_build_done",
      }),
    ).toThrow(/duplicate target stage id/);
  });

  it("QA-15.4-08 & QA-R11-07: opportunity-stage.ts has zero Katana imports and zero .includes(; katana-order-status.ts has zero fetchKatana; Phase 15 files never mutate Katana except archiveKatanaVariant", () => {
    const oppStageSrc = stripComments(read("src/server/ghl/opportunity-stage.ts"));
    expect(oppStageSrc).not.toContain("@/lib/katana");
    expect(oppStageSrc).not.toContain(".includes(");

    const orderStatusInngestSrc = stripComments(read("src/inngest/katana-order-status.ts"));
    expect(orderStatusInngestSrc).not.toContain("fetchKatana(");

    const phase15NonArchiveFiles = [
      "src/server/katana/order-status.ts",
      "src/server/katana/po-receipt-ledger.ts",
      "src/server/katana/variant-webhook.ts",
      "src/server/katana/webhook-events.ts",
      "src/server/ghl/opportunity-stage.ts",
      "src/server/pipeline/katana-reverse-mode.ts",
      "src/inngest/katana-order-status.ts",
      "src/inngest/ghl-factory-stage-push.ts",
      "src/inngest/katana-po-received.ts",
      "src/inngest/katana-po-bill-post.ts",
      "src/inngest/katana-variant-heal.ts",
      "src/app/api/webhooks/katana/route.ts",
      "scripts/ops/redrive-parked-po-bills.ts",
    ];
    for (const rel of phase15NonArchiveFiles) {
      const code = stripComments(read(rel));
      expect(code, rel).not.toMatch(/katanaFetch[\s\S]{0,120}method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    }

    const fnCode = stripComments(read("src/inngest/functions.ts"));
    expect(fnCode).toContain('katanaFetch<unknown>(`/variants/${variantId}`, { method: "DELETE" })');
  });

  it("QA-15.4-09 & QA-R1-01..03: Katana-slot isolation, QBO/GHL isolation, concurrency/throttle/onFailure invariants, and unique registered IDs", () => {
    const katanaSlotPhase15Files = [
      "src/inngest/katana-po-received.ts",
      "src/inngest/katana-order-status.ts",
      "src/inngest/katana-variant-heal.ts",
    ];
    const forbiddenDownstreamSpecs = [
      "@/server/integrations/qbo",
      "@/server/ghl/private-api",
      "@/server/ghl/opportunity-stage",
      "@/lib/woocommerce-catalog",
      "@/lib/clover-catalog",
    ];
    for (const rel of katanaSlotPhase15Files) {
      const specs = importSpecifiers(read(rel));
      for (const spec of specs) {
        for (const forbidden of forbiddenDownstreamSpecs) {
          expect(spec.startsWith(forbidden), `${rel} must not import ${spec}`).toBe(false);
        }
      }
    }

    for (const rel of [
      "src/inngest/katana-po-bill-post.ts",
      "src/inngest/ghl-factory-stage-push.ts",
    ]) {
      const code = stripComments(read(rel));
      const specs = importSpecifiers(code);
      expect(specs).not.toContain("@/lib/katana");
      expect(specs).not.toContain("@/lib/katana/client");
      expect(specs).not.toContain("./katana-step");
      expect(code).not.toContain("KATANA_TENANT_CONCURRENCY");
    }

    expect(concurrencyEntries(postKatanaPoBill)).toContainEqual({
      limit: 2,
      key: '"qbo-realm"',
      scope: "env",
    });
    expect(optsOf(pushGhlFactoryStage).throttle).toBeDefined();

    for (const fn of [
      syncKatanaOrderStatus,
      syncKatanaPoReceived,
      refreshKatanaPoBillVendor,
      healKatanaVariantSkuFn,
      archiveKatanaVariant,
    ]) {
      expect(concurrencyEntries(fn)).toContainEqual(KATANA_TENANT_CONCURRENCY);
    }

    for (const fn of [
      katanaMoDone,
      katanaOrderStatusReconcile,
      postKatanaPoBill,
      redriveKatanaPoBill,
      resolveKatanaPoBill,
      pushGhlFactoryStage,
    ]) {
      expect(concurrencyEntries(fn)).not.toContainEqual(KATANA_TENANT_CONCURRENCY);
    }

    for (const fn of [
      syncKatanaPoReceived,
      refreshKatanaPoBillVendor,
      postKatanaPoBill,
      redriveKatanaPoBill,
      resolveKatanaPoBill,
      katanaMoDone,
      syncKatanaOrderStatus,
      katanaOrderStatusReconcile,
      pushGhlFactoryStage,
      healKatanaVariantSkuFn,
    ]) {
      expect(optsOf(fn).onFailure).toBeUndefined();
    }

    const ids = inngestFunctions.map((fn) =>
      (fn as unknown as { id: (prefix?: string) => string }).id(),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("QA-R5-01..02: zero getMutexDb in runtime directories and zero external HTTP calls inside .transaction( blocks", () => {
    const runtimeDirs = [
      path.join(ROOT, "src", "inngest"),
      path.join(ROOT, "src", "server", "katana"),
      path.join(ROOT, "src", "server", "ghl"),
      path.join(ROOT, "src", "app", "api", "webhooks", "katana"),
    ];
    for (const dir of runtimeDirs) {
      for (const file of walkFiles(dir)) {
        const code = stripComments(readFileSync(file, "utf8"));
        expect(code, path.relative(ROOT, file)).not.toContain("getMutexDb");
      }
    }

    const phase15TxFiles = [
      "src/inngest/katana-po-received.ts",
      "src/inngest/katana-po-bill-post.ts",
      "src/inngest/katana-order-status.ts",
      "src/inngest/ghl-factory-stage-push.ts",
    ];
    for (const rel of phase15TxFiles) {
      const code = stripComments(read(rel));
      const txRegex = /\.transaction\s*\(\s*async\s*\([^)]*\)\s*=>\s*\{/g;
      for (let match = txRegex.exec(code); match; match = txRegex.exec(code)) {
        let depth = 1;
        let idx = match.index + match[0].length;
        while (idx < code.length && depth > 0) {
          if (code[idx] === "{") depth += 1;
          else if (code[idx] === "}") depth -= 1;
          idx += 1;
        }
        const txBody = code.slice(match.index, idx);
        expect(txBody, `${rel} transaction body`).not.toMatch(
          /\b(?:qboFetch|createQboVendorBillFromKatanaPo|ghlGet|ghlPut|katanaFetch)\s*\(/,
        );
      }
    }
  });

  it("QA-R9-01..03: Katana readers enforce runKatanaStep defer context and never use deprecated MO linkage filter", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await expect(fetchKatanaSalesOrderSnapshot(91804422)).rejects.toThrow(
        /must run inside runKatanaStep/,
      );
      await expect(listKatanaMoSnapshotsForSalesOrder(91804422)).rejects.toThrow(
        /must run inside runKatanaStep/,
      );
      await expect(fetchKatanaPoWithSupplier(55109204)).rejects.toThrow(
        /must run inside runKatanaStep/,
      );
      await expect(fetchKatanaPoSupplierOnly(55109204)).rejects.toThrow(
        /must run inside runKatanaStep/,
      );
      await expect(loadKatanaVariantSku(21004501)).rejects.toThrow(
        /must run inside runKatanaStep/,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }

    for (const dir of [
      path.join(ROOT, "src", "inngest"),
      path.join(ROOT, "src", "server", "katana"),
    ]) {
      for (const file of walkFiles(dir)) {
        const code = stripComments(readFileSync(file, "utf8"));
        expect(code, path.relative(ROOT, file)).not.toContain("is_linked_to_sales_order");
        expect(code, path.relative(ROOT, file)).not.toContain("listManufacturingOrdersForSalesOrder");
      }
    }
  });

  it("QA-R13-01 & QA-S8-01: all 10 Phase 15 function IDs resolve via resolveDlqContext to existing app routes", () => {
    const cases: Array<{ id: string; data: Record<string, unknown>; expectedRouteDir: string }> = [
      {
        id: "sync-katana-po-received",
        data: { purchaseOrderId: 55109204, orderNo: "PO-2026-0418" },
        expectedRouteDir: "src/app/mission-control",
      },
      {
        id: "post-katana-po-bill",
        data: { billRowId: "bill-1", katanaPoId: 55109204 },
        expectedRouteDir: "src/app/mission-control",
      },
      {
        id: "redrive-katana-po-bill",
        data: { billRowId: "bill-1", katanaPoId: 55109204 },
        expectedRouteDir: "src/app/mission-control",
      },
      {
        id: "refresh-katana-po-bill-vendor",
        data: { billRowId: "bill-1", katanaPoId: 55109204 },
        expectedRouteDir: "src/app/mission-control",
      },
      {
        id: "resolve-katana-po-bill",
        data: { billRowId: "bill-1", katanaPoId: 55109204 },
        expectedRouteDir: "src/app/mission-control",
      },
      {
        id: "sync-katana-order-status",
        data: { salesOrderId: 91804422 },
        expectedRouteDir: "src/app/admin/order-triage",
      },
      {
        id: "push-ghl-factory-stage",
        data: { opportunityId: "opp01HZX8R9K2M3N4P5Q6" },
        expectedRouteDir: "src/app/admin/order-triage",
      },
      {
        id: "katana-mo-done",
        data: { manufacturingOrderId: 77001901 },
        expectedRouteDir: "src/app/admin/order-triage",
      },
      {
        id: "heal-katana-variant-sku",
        data: { variantId: 21004501 },
        expectedRouteDir: "src/app/admin/dictionary",
      },
      {
        id: "katana-order-status-reconcile",
        data: {},
        expectedRouteDir: "src/app/admin/order-triage",
      },
    ];

    for (const item of cases) {
      for (const fnId of [item.id, `ccpatio-middleware-${item.id}`]) {
        const ctx = resolveDlqContext(fnId, { data: item.data });
        expect(ctx.resolutionPath, fnId).toBeDefined();
        expect(ctx.source, fnId).toBeDefined();
        const dirFull = path.join(ROOT, item.expectedRouteDir);
        expect(existsSync(dirFull) && statSync(dirFull).isDirectory(), item.expectedRouteDir).toBe(true);
      }
    }
  });

  it("QA-S4-06 & QA-S4-08: ops CLI is strictly SELECT-only with zero Katana/QBO imports, and zero /api/admin/redrive routes exist", () => {
    const cliRaw = read("scripts/ops/redrive-parked-po-bills.ts");
    const cliCode = stripComments(cliRaw);
    const specs = importSpecifiers(cliRaw);

    for (const spec of specs) {
      expect(spec).not.toMatch(/^@\/lib\/katana/);
      expect(spec).not.toMatch(/^@\/server\/integrations\/qbo/);
    }
    expect(cliCode).not.toContain(".insert(");
    expect(cliCode).not.toContain(".update(");
    expect(cliCode).not.toContain(".delete(");
    expect(cliCode).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i);

    for (const file of walkFiles(path.join(ROOT, "src"))) {
      const normalized = file.replace(/\\/g, "/");
      expect(normalized).not.toContain("api/admin/redrive");
      expect(readFileSync(file, "utf8")).not.toContain("api/admin/redrive");
    }
  });
});

describe("Katana order-status & GHL stage push resilience (QA-15.4-02..07, QA-R2, QA-R3, QA-R9-03/04, QA-R10, QA-R11, QA-R12, QA-R14, QA-S1)", () => {
  let pg: PGlite;
  let db: MiddlewareDb;

  beforeEach(async () => {
    const created = await createPhase15ResilienceDb();
    pg = created.pg;
    db = created.db;
    activeTestDbRef.current = db;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    activeTestDbRef.current = null;
    vi.restoreAllMocks();
    await pg.close();
  });

  it("QA-15.4-02 & QA-S1-05: GHL-lane SO IN_PROGRESS sets factory_stage='in_production' without touching status/version and emits ONLY { opportunityId }", async () => {
    const oppId = "opp_fixture_01";
    const [seeded] = await db
      .insert(order_intake)
      .values({
        ghl_opportunity_id: oppId,
        status: "pushed",
        raw_payload: { id: oppId },
        katana_sales_order_id: 53609101,
        katana_order_no: `GHL-${oppId}`,
        katana_mo_ids: [19833041, 19833042],
        version: 4,
      })
      .returning();

    const soSnap = readSalesOrderSnapshot(soGhlFixture);
    const mos: KatanaMoSnapshot[] = [
      { id: 19833041, salesOrderId: 53609101, status: "DONE" },
      { id: 19833042, salesOrderId: 53609101, status: "IN_PROGRESS" },
    ];

    const { step, sentEvents } = makeOrderStatusStep();
    const res = await runSyncKatanaOrderStatus(
      {
        event: { data: { salesOrderId: 53609101 } },
        step,
      },
      {
        getDb: () => db,
        fetchSalesOrder: async () => soSnap,
        listMosForSalesOrder: async () => mos,
        nowIso: () => "2026-04-12T15:00:00.000Z",
      },
    );

    expect(res).toEqual({
      ok: true,
      lane: "ghl_factory",
      stage: "in_production",
      opportunityId: oppId,
    });

    const [after] = await db
      .select()
      .from(order_intake)
      .where(eq(order_intake.id, seeded!.id));
    expect(after?.factory_stage).toBe("in_production");
    expect(after?.status).toBe("pushed");
    expect(after?.version).toBe(4);
    expect(after?.katana_so_status).toBe("NOT_SHIPPED");
    expect(after?.katana_production_status).toBe("IN_PROGRESS");

    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0]?.name).toBe(GHL_FACTORY_STAGE_PUSH_EVENT);
    expect(Object.keys(sentEvents[0]!.data)).toEqual(["opportunityId"]);
    expect(sentEvents[0]?.data).toEqual({ opportunityId: oppId });
  });

  it("QA-15.4-03: KATANA_REVERSE_SYNC_MODE unset updates hub row and makes zero GHL GET/PUT calls", async () => {
    const oppId = "opp_dry_run_1";
    await db.insert(order_intake).values({
      ghl_opportunity_id: oppId,
      status: "pushed",
      raw_payload: { id: oppId },
      factory_stage: "in_production",
    });

    const getGhl = vi.fn();
    const putGhl = vi.fn();
    const { step } = makePushGhlStep();

    const res = await runPushGhlFactoryStage(
      { event: { data: { opportunityId: oppId } }, step },
      {
        getDb: () => db,
        ghl: { getGhl, putGhl },
        env: { ...VALID_GHL_ENV, KATANA_REVERSE_SYNC_MODE: undefined },
      },
    );

    expect(res).toEqual({
      ok: true,
      dryRun: true,
      stage: "in_production",
    });
    expect(getGhl).not.toHaveBeenCalled();
    expect(putGhl).not.toHaveBeenCalled();
  });

  it("QA-15.4-04/05/07 & QA-R11-02..04: live push moves forward with { pipelineId, pipelineStageId } only, skips monotonic/foreign/lost/wrong-location, is idempotent on repeat, and maps 401/429/error", async () => {
    const oppId = "opp_live_move_1";
    await db.insert(order_intake).values({
      ghl_opportunity_id: oppId,
      status: "pushed",
      raw_payload: { id: oppId },
      factory_stage: "build_complete",
    });

    let remoteStageId = "stg_in_prod";
    const getGhl = vi.fn(async (p: string): Promise<GhlResult> => {
      if (p.startsWith("/opportunities/pipelines")) {
        return { ok: true, body: VALID_PIPELINES_PAYLOAD, locationId: "loc_ccpatio_1" };
      }
      return {
        ok: true,
        locationId: "loc_ccpatio_1",
        body: {
          opportunity: {
            id: oppId,
            locationId: "loc_ccpatio_1",
            status: "open",
            pipelineId: "pipe_factory_1",
            pipelineStageId: remoteStageId,
          },
        },
      };
    });
    const putGhl = vi.fn(async (_p: string, body: unknown): Promise<GhlResult> => {
      remoteStageId = (body as { pipelineStageId: string }).pipelineStageId;
      return { ok: true, body: { ok: true }, locationId: "loc_ccpatio_1" };
    });

    const firstStep = makePushGhlStep();
    const res1 = await runPushGhlFactoryStage(
      { event: { data: { opportunityId: oppId } }, step: firstStep.step },
      { getDb: () => db, ghl: { getGhl, putGhl }, env: VALID_GHL_ENV },
    );
    expect(res1).toMatchObject({ ok: true, moved: true, stage: "build_complete" });
    expect(putGhl).toHaveBeenCalledTimes(1);
    expect(putGhl.mock.calls[0]?.[1]).toEqual({
      pipelineId: "pipe_factory_1",
      pipelineStageId: "stg_build_done",
    });
    expect(Object.keys(putGhl.mock.calls[0]?.[1] as object)).toEqual([
      "pipelineId",
      "pipelineStageId",
    ]);

    // Second run with identical hub state makes zero GHL PUTs (QA-15.4-05).
    putGhl.mockClear();
    const secondStep = makePushGhlStep();
    const res2 = await runPushGhlFactoryStage(
      { event: { data: { opportunityId: oppId } }, step: secondStep.step },
      { getDb: () => db, ghl: { getGhl, putGhl }, env: VALID_GHL_ENV },
    );
    expect(res2).toEqual({ ok: true, skipped: "already_pushed", stage: "build_complete" });
    expect(putGhl).not.toHaveBeenCalled();

    // Direct moveOpportunityStage matrix: already_at_or_past, foreign_stage, lost, wrong_location.
    const makeStaticDeps = (oppOverrides: Record<string, unknown>): MoveOpportunityStageDeps => ({
      getGhl: vi.fn(async (): Promise<GhlResult> => ({
        ok: true,
        locationId: "loc_ccpatio_1",
        body: {
          opportunity: {
            id: "opp_matrix",
            locationId: "loc_ccpatio_1",
            status: "open",
            pipelineId: "pipe_factory_1",
            pipelineStageId: "stg_delivered",
            ...oppOverrides,
          },
        },
      })),
      putGhl: vi.fn(async (): Promise<GhlResult> => ({ ok: true, body: {}, locationId: "loc_ccpatio_1" })),
    });

    const atDeliveredDeps = makeStaticDeps({ pipelineStageId: "stg_delivered" });
    expect(
      await moveOpportunityStage(
        { opportunityId: "opp_matrix", targetStage: "build_complete", env: VALID_GHL_ENV },
        atDeliveredDeps,
      ),
    ).toEqual({ moved: false, reason: "already_at_or_past" });
    expect(atDeliveredDeps.putGhl).not.toHaveBeenCalled();

    const foreignStageDeps = makeStaticDeps({ pipelineStageId: "stg_sales_discovery_99" });
    expect(
      await moveOpportunityStage(
        { opportunityId: "opp_matrix", targetStage: "in_production", env: VALID_GHL_ENV },
        foreignStageDeps,
      ),
    ).toEqual({ moved: false, reason: "foreign_stage" });
    expect(foreignStageDeps.putGhl).not.toHaveBeenCalled();

    const lostDeps = makeStaticDeps({ status: "lost", pipelineStageId: "stg_in_prod" });
    expect(
      await moveOpportunityStage(
        { opportunityId: "opp_matrix", targetStage: "build_complete", env: VALID_GHL_ENV },
        lostDeps,
      ),
    ).toEqual({ moved: false, reason: "foreign_status" });
    expect(lostDeps.putGhl).not.toHaveBeenCalled();

    const wrongLocDeps = makeStaticDeps({ locationId: "loc_other_tenant", pipelineStageId: "stg_in_prod" });
    expect(
      await moveOpportunityStage(
        { opportunityId: "opp_matrix", targetStage: "build_complete", env: VALID_GHL_ENV },
        wrongLocDeps,
      ),
    ).toEqual({ moved: false, reason: "wrong_location" });
    expect(wrongLocDeps.putGhl).not.toHaveBeenCalled();

    // Transport error classification (QA-15.4-07): 401 -> NonRetriableError, 429 -> RetryAfterError, generic -> Error.
    const oppErr = "opp_err_1";
    await db.insert(order_intake).values({
      ghl_opportunity_id: oppErr,
      status: "pushed",
      raw_payload: { id: oppErr },
      factory_stage: "in_production",
    });

    await expect(
      runPushGhlFactoryStage(
        { event: { data: { opportunityId: oppErr } }, step: makePushGhlStep().step },
        {
          getDb: () => db,
          env: VALID_GHL_ENV,
          ghl: {
            getGhl: async () => ({
              ok: false,
              error: "GoHighLevel returned 401.",
            }),
            putGhl: vi.fn(),
          },
        },
      ),
    ).rejects.toBeInstanceOf(NonRetriableError);

    await expect(
      runPushGhlFactoryStage(
        { event: { data: { opportunityId: oppErr } }, step: makePushGhlStep().step },
        {
          getDb: () => db,
          env: VALID_GHL_ENV,
          ghl: {
            getGhl: async (p) =>
              p.startsWith("/opportunities/pipelines")
                ? { ok: true, body: VALID_PIPELINES_PAYLOAD, locationId: "loc_ccpatio_1" }
                : {
                    ok: true,
                    locationId: "loc_ccpatio_1",
                    body: {
                      opportunity: {
                        id: oppErr,
                        locationId: "loc_ccpatio_1",
                        status: "open",
                        pipelineId: "pipe_factory_1",
                        pipelineStageId: "stg_produce_factory_1",
                      },
                    },
                  },
            putGhl: async () => ({
              ok: false,
              error: "GoHighLevel returned 429.",
            }),
          },
        },
      ),
    ).rejects.toBeInstanceOf(RetryAfterError);

    await expect(
      runPushGhlFactoryStage(
        { event: { data: { opportunityId: oppErr } }, step: makePushGhlStep().step },
        {
          getDb: () => db,
          env: VALID_GHL_ENV,
          ghl: {
            getGhl: async (p) =>
              p.startsWith("/opportunities/pipelines")
                ? { ok: true, body: VALID_PIPELINES_PAYLOAD, locationId: "loc_ccpatio_1" }
                : {
                    ok: true,
                    locationId: "loc_ccpatio_1",
                    body: {
                      opportunity: {
                        id: oppErr,
                        locationId: "loc_ccpatio_1",
                        status: "open",
                        pipelineId: "pipe_factory_1",
                        pipelineStageId: "stg_produce_factory_1",
                      },
                    },
                  },
            putGhl: async () => ({
              ok: false,
              error: "GoHighLevel returned 502.",
            }),
          },
        },
      ),
    ).rejects.toThrow("GoHighLevel returned 502.");
  });

  it("QA-15.4-06 & QA-R2-03: WOO- and unknown order_no prefixes skip cleanly with zero DB writes and zero GHL events", async () => {
    const orderNos = [
      "WOO-10455",
      "WOO-9",
      "HOLD-123",
      "MIG-HOLD-FABRIC-20260811",
      "ghl-x",
      "GHL-",
    ];

    expect(parseOrderNoLane("WOO-10455")).toEqual({ lane: "woo", externalId: "10455" });
    expect(laneForOrderNo("WOO-9")).toBe("woo");
    expect(laneForOrderNo("WOO-")).toBe("unknown");
    for (const candidate of orderNos) {
      expect(["ghl_factory", "path_a"]).not.toContain(laneForOrderNo(candidate));
    }
    expect(opportunityIdFromOrderNo("HOLD-123")).toBeNull();
    expect(opportunityIdFromOrderNo("MIG-HOLD-FABRIC-20260811")).toBeNull();
    expect(opportunityIdFromOrderNo("ghl-x")).toBeNull();
    expect(opportunityIdFromOrderNo("GHL-")).toBeNull();

    for (const orderNo of orderNos) {
      const { step, sentEvents } = makeOrderStatusStep();
      const res = await runSyncKatanaOrderStatus(
        { event: { data: { salesOrderId: 88001 } }, step },
        {
          getDb: () => db,
          fetchSalesOrder: async () => ({
            id: 88001,
            orderNo,
            status: "DELIVERED",
            productionStatus: "DONE",
          }),
          listMosForSalesOrder: async () => [],
          nowIso: () => "2026-04-12T16:00:00.000Z",
        },
      );
      expect(res.ok).toBe(true);
      expect(sentEvents).toHaveLength(0);
    }

    const intakeCount = await db.select().from(order_intake);
    const jobCount = await db.select().from(custom_build_jobs);
    expect(intakeCount).toHaveLength(0);
    expect(jobCount).toHaveLength(0);
  });

  it("QA-R2-01..02: NULL katana_sales_order_id updates via ghl_opportunity_id; conflicting katana_sales_order_id throws NonRetriableError", async () => {
    await db.insert(order_intake).values({
      ghl_opportunity_id: "opp1",
      status: "pushed",
      raw_payload: { id: "opp1" },
      katana_sales_order_id: null,
      katana_mo_ids: [501],
    });

    const step1 = makeOrderStatusStep();
    const okRes = await runSyncKatanaOrderStatus(
      { event: { data: { salesOrderId: 333 } }, step: step1.step },
      {
        getDb: () => db,
        fetchSalesOrder: async () => ({
          id: 333,
          orderNo: "GHL-opp1",
          status: "NOT_SHIPPED",
          productionStatus: "IN_PROGRESS",
        }),
        listMosForSalesOrder: async () => [{ id: 501, salesOrderId: 333, status: "DONE" }],
        nowIso: () => "2026-04-12T16:10:00.000Z",
      },
    );
    expect(okRes).toMatchObject({ ok: true, stage: "build_complete", opportunityId: "opp1" });

    // Conflicting katana_sales_order_id = 111 vs incoming SO 222 -> NonRetriableError, zero writes/sends.
    await db.insert(order_intake).values({
      ghl_opportunity_id: "opp_conflict",
      status: "pushed",
      raw_payload: { id: "opp_conflict" },
      katana_sales_order_id: 111,
      factory_stage: "in_production",
    });

    const stepConflict = makeOrderStatusStep();
    await expect(
      runSyncKatanaOrderStatus(
        { event: { data: { salesOrderId: 222 } }, step: stepConflict.step },
        {
          getDb: () => db,
          fetchSalesOrder: async () => ({
            id: 222,
            orderNo: "GHL-opp_conflict",
            status: "DELIVERED",
            productionStatus: "DONE",
          }),
          listMosForSalesOrder: async () => [],
          nowIso: () => "2026-04-12T16:15:00.000Z",
        },
      ),
    ).rejects.toBeInstanceOf(NonRetriableError);

    expect(stepConflict.sentEvents).toHaveLength(0);
    const [unchanged] = await db
      .select()
      .from(order_intake)
      .where(eq(order_intake.ghl_opportunity_id, "opp_conflict"));
    expect(unchanged?.factory_stage).toBe("in_production");
  });

  it("QA-R3-01..02 & QA-S1-01/03: compare-and-set observedAt rejects stale snapshots, COALESCE rank prevents regressions, and MO-first race settles cleanly without false regression warnings", async () => {
    const oppId = "opp_cas_1";
    await db.insert(order_intake).values({
      ghl_opportunity_id: oppId,
      status: "pushed",
      raw_payload: { id: oppId },
      katana_sales_order_id: 7001,
      katana_mo_ids: [801],
    });

    // 1. NULL -> in_production at T2.
    await runSyncKatanaOrderStatus(
      { event: { data: { salesOrderId: 7001 } }, step: makeOrderStatusStep().step },
      {
        getDb: () => db,
        fetchSalesOrder: async () => ({
          id: 7001,
          orderNo: `GHL-${oppId}`,
          status: "NOT_SHIPPED",
          productionStatus: "IN_PROGRESS",
        }),
        listMosForSalesOrder: async () => [{ id: 801, salesOrderId: 7001, status: "IN_PROGRESS" }],
        nowIso: () => "2026-04-12T12:00:00.000Z",
      },
    );

    // 2. Stale observedAt (T1 < T2) updates 0 rows -> stale_snapshot.
    const staleRes = await runSyncKatanaOrderStatus(
      { event: { data: { salesOrderId: 7001 } }, step: makeOrderStatusStep().step },
      {
        getDb: () => db,
        fetchSalesOrder: async () => ({
          id: 7001,
          orderNo: `GHL-${oppId}`,
          status: "DELIVERED",
          productionStatus: "DONE",
        }),
        listMosForSalesOrder: async () => [{ id: 801, salesOrderId: 7001, status: "DONE" }],
        nowIso: () => "2026-04-12T11:59:00.000Z",
      },
    );
    expect(staleRes).toEqual({ ok: true, skipped: "stale_snapshot" });

    // 3. Advance to build_complete (T3), then test derived NULL (T4) keeps build_complete via COALESCE.
    await runSyncKatanaOrderStatus(
      { event: { data: { salesOrderId: 7001 } }, step: makeOrderStatusStep().step },
      {
        getDb: () => db,
        fetchSalesOrder: async () => ({
          id: 7001,
          orderNo: `GHL-${oppId}`,
          status: "NOT_SHIPPED",
          productionStatus: "IN_PROGRESS",
        }),
        listMosForSalesOrder: async () => [{ id: 801, salesOrderId: 7001, status: "DONE" }],
        nowIso: () => "2026-04-12T12:05:00.000Z",
      },
    );

    const warnLogs: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((msg) => {
      warnLogs.push(String(msg));
    });

    await runSyncKatanaOrderStatus(
      { event: { data: { salesOrderId: 7001 } }, step: makeOrderStatusStep().step },
      {
        getDb: () => db,
        fetchSalesOrder: async () => ({
          id: 7001,
          orderNo: `GHL-${oppId}`,
          status: "NOT_SHIPPED",
          productionStatus: "NOT_STARTED",
        }),
        listMosForSalesOrder: async () => [{ id: 801, salesOrderId: 7001, status: "NOT_STARTED" }],
        nowIso: () => "2026-04-12T12:06:00.000Z",
      },
    );

    const [afterNullDerived] = await db
      .select()
      .from(order_intake)
      .where(eq(order_intake.ghl_opportunity_id, oppId));
    expect(afterNullDerived?.factory_stage).toBe("build_complete");
    expect(warnLogs.some((l) => l.includes("katana-status-regression"))).toBe(true);

    // 4. Advance to delivered (T5), then newer in_production (T6) keeps delivered and logs regression.
    await runSyncKatanaOrderStatus(
      { event: { data: { salesOrderId: 7001 } }, step: makeOrderStatusStep().step },
      {
        getDb: () => db,
        fetchSalesOrder: async () => ({
          id: 7001,
          orderNo: `GHL-${oppId}`,
          status: "DELIVERED",
          productionStatus: "DONE",
        }),
        listMosForSalesOrder: async () => [{ id: 801, salesOrderId: 7001, status: "DONE" }],
        nowIso: () => "2026-04-12T12:10:00.000Z",
      },
    );
    warnLogs.length = 0;

    await runSyncKatanaOrderStatus(
      { event: { data: { salesOrderId: 7001 } }, step: makeOrderStatusStep().step },
      {
        getDb: () => db,
        fetchSalesOrder: async () => ({
          id: 7001,
          orderNo: `GHL-${oppId}`,
          status: "NOT_SHIPPED",
          productionStatus: "IN_PROGRESS",
        }),
        listMosForSalesOrder: async () => [{ id: 801, salesOrderId: 7001, status: "IN_PROGRESS" }],
        nowIso: () => "2026-04-12T12:11:00.000Z",
      },
    );
    const [afterDelivered] = await db
      .select()
      .from(order_intake)
      .where(eq(order_intake.ghl_opportunity_id, oppId));
    expect(afterDelivered?.factory_stage).toBe("delivered");
    expect(warnLogs.some((l) => l.includes("katana-status-regression"))).toBe(true);

    // 5. MO-first sequence (QA-S1-01): manufacturing_order.done followed by sales_order.updated
    // with all expected MOs DONE yields build_complete, 0 regression logs, and push_requested.
    const oppMoFirst = "opp_mo_first_1";
    await db.insert(order_intake).values({
      ghl_opportunity_id: oppMoFirst,
      status: "pushed",
      raw_payload: { id: oppMoFirst },
      katana_sales_order_id: 7002,
      katana_mo_ids: [901],
    });
    warnLogs.length = 0;

    const moDoneStep = makeMoDoneStep();
    const moRes = await runKatanaMoDone(
      { event: { data: { manufacturingOrderId: 901 } }, step: moDoneStep.step },
      { getDb: () => db },
    );
    expect(moRes).toEqual({ ok: true, salesOrderId: 7002 });

    const syncStepA = makeOrderStatusStep();
    await runSyncKatanaOrderStatus(
      { event: { data: { salesOrderId: 7002 } }, step: syncStepA.step },
      {
        getDb: () => db,
        fetchSalesOrder: async () => ({
          id: 7002,
          orderNo: `GHL-${oppMoFirst}`,
          status: "NOT_SHIPPED",
          productionStatus: "IN_PROGRESS",
        }),
        listMosForSalesOrder: async () => [{ id: 901, salesOrderId: 7002, status: "DONE" }],
        nowIso: () => "2026-04-12T13:00:00.000Z",
      },
    );
    // Simulate GHL push completing so ghl_stage_pushed = build_complete, then sales_order.updated arrives:
    await db
      .update(order_intake)
      .set({ ghl_stage_pushed: "build_complete" })
      .where(eq(order_intake.ghl_opportunity_id, oppMoFirst));

    const syncStepB = makeOrderStatusStep();
    await runSyncKatanaOrderStatus(
      { event: { data: { salesOrderId: 7002 } }, step: syncStepB.step },
      {
        getDb: () => db,
        fetchSalesOrder: async () => ({
          id: 7002,
          orderNo: `GHL-${oppMoFirst}`,
          status: "NOT_SHIPPED",
          productionStatus: "DONE",
        }),
        listMosForSalesOrder: async () => [{ id: 901, salesOrderId: 7002, status: "DONE" }],
        nowIso: () => "2026-04-12T13:00:05.000Z",
      },
    );

    expect(syncStepA.sentEvents).toHaveLength(1);
    expect(syncStepB.sentEvents).toHaveLength(0);
    expect(warnLogs.some((l) => l.includes("katana-status-regression"))).toBe(false);
  });

  it("QA-R9-04 & QA-S1-04: runKatanaMoDone makes zero fetch calls across hit, sleep-and-recheck hit, and sleep-and-miss", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Case 1: Immediate hit via custom_build_job_items.
    const [job] = await db
      .insert(custom_build_jobs)
      .values({
        client_slug: "acme",
        display_name: "Acme Patio",
        ghl_opportunity_id: "opp_patha_mo_1",
        created_by: "ops@ccpatio.com",
        katana_sales_order_id: 95001,
        katana_order_no: "PATHA-opp_patha_mo_1",
      })
      .returning();
    await db.insert(custom_build_job_items).values({
      job_id: job!.id,
      global_sku: "FIN-TEST-MO-1",
      katana_mo_id: 4401,
    });

    const hitStep = makeMoDoneStep();
    const hitRes = await runKatanaMoDone(
      { event: { data: { manufacturingOrderId: 4401 } }, step: hitStep.step },
      { getDb: () => db },
    );
    expect(hitRes).toEqual({ ok: true, salesOrderId: 95001 });
    expect(hitStep.sleeps).toHaveLength(0);
    expect(hitStep.sentEvents).toHaveLength(1);

    // Case 2: so_not_persisted_yet before sleep -> persisted during 2m sleep -> hit after recheck.
    const [pendingIntake] = await db
      .insert(order_intake)
      .values({
        ghl_opportunity_id: "opp_race_mo",
        status: "approved",
        raw_payload: { id: "opp_race_mo" },
        katana_sales_order_id: null,
        katana_mo_ids: [4402],
      })
      .returning();

    const waitHitStep = makeMoDoneStep(async () => {
      await db
        .update(order_intake)
        .set({ katana_sales_order_id: 95002, status: "pushed" })
        .where(eq(order_intake.id, pendingIntake!.id));
    });
    const waitHitRes = await runKatanaMoDone(
      { event: { data: { manufacturingOrderId: 4402 } }, step: waitHitStep.step },
      { getDb: () => db },
    );
    expect(waitHitStep.sleeps).toEqual([{ id: "await-hub-persist", duration: "2m" }]);
    expect(waitHitRes).toEqual({ ok: true, salesOrderId: 95002 });
    expect(waitHitStep.sentEvents).toHaveLength(1);

    // Case 3: Unknown MO -> sleeps once and returns mo_not_in_hub with zero sends.
    const missStep = makeMoDoneStep();
    const missRes = await runKatanaMoDone(
      { event: { data: { manufacturingOrderId: 999999 } }, step: missStep.step },
      { getDb: () => db },
    );
    expect(missStep.sleeps).toEqual([{ id: "await-hub-persist", duration: "2m" }]);
    expect(missRes).toEqual({ ok: true, skipped: "mo_not_in_hub" });
    expect(missStep.sentEvents).toHaveLength(0);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("QA-R11-05 & QA-S1-02: cross-lane aggregation uses minimum live rank, blocks when a live Path A row is NULL, and ignores COMPENSATED Path A rows", async () => {
    const oppId = "opp_cross_lane_1";
    await db.insert(order_intake).values({
      ghl_opportunity_id: oppId,
      status: "pushed",
      raw_payload: { id: oppId },
      factory_stage: "delivered",
    });
    const [job] = await db
      .insert(custom_build_jobs)
      .values({
        client_slug: "cross",
        display_name: "Cross Lane Build",
        ghl_opportunity_id: oppId,
        created_by: "ops@ccpatio.com",
        factory_stage: null,
      })
      .returning();
    await db.insert(saga_runs).values({
      saga_type: PATH_A_SAGA_TYPE,
      correlation_key: oppId,
      status: "IN_PROGRESS",
    });

    const putGhl = vi.fn(async (): Promise<GhlResult> => ({
      ok: true,
      body: {},
      locationId: "loc_ccpatio_1",
    }));
    const getGhl = vi.fn(async (p: string): Promise<GhlResult> =>
      p.startsWith("/opportunities/pipelines")
        ? { ok: true, body: VALID_PIPELINES_PAYLOAD, locationId: "loc_ccpatio_1" }
        : {
            ok: true,
            locationId: "loc_ccpatio_1",
            body: {
              opportunity: {
                id: oppId,
                locationId: "loc_ccpatio_1",
                status: "open",
                pipelineId: "pipe_factory_1",
                pipelineStageId: "stg_produce_factory_1",
              },
            },
          },
    );

    // 1. Live Path A row with NULL factory_stage blocks GHL push (awaiting_all_lanes).
    const blockedRes = await runPushGhlFactoryStage(
      { event: { data: { opportunityId: oppId } }, step: makePushGhlStep().step },
      { getDb: () => db, ghl: { getGhl, putGhl }, env: VALID_GHL_ENV },
    );
    expect(blockedRes).toEqual({ ok: true, skipped: "awaiting_all_lanes", stage: null });
    expect(putGhl).not.toHaveBeenCalled();

    // 2. Path A advances to in_production -> min(delivered, in_production) pushes in_production + emits PATH_A_GHL_SYNC_REQUESTED_EVENT.
    await db
      .update(custom_build_jobs)
      .set({ factory_stage: "in_production" })
      .where(eq(custom_build_jobs.id, job!.id));

    const minPushStep = makePushGhlStep();
    const minRes = await runPushGhlFactoryStage(
      { event: { data: { opportunityId: oppId } }, step: minPushStep.step },
      { getDb: () => db, ghl: { getGhl, putGhl }, env: VALID_GHL_ENV },
    );
    expect(minRes).toMatchObject({ ok: true, moved: true, stage: "in_production" });
    expect(putGhl).toHaveBeenLastCalledWith(`/opportunities/${oppId}`, {
      pipelineId: "pipe_factory_1",
      pipelineStageId: "stg_in_prod",
    });
    expect(minPushStep.sentEvents.some((e) => e.name === PATH_A_GHL_SYNC_REQUESTED_EVENT)).toBe(
      true,
    );

    // 3. Path A saga becomes COMPENSATED -> excluded from live lanes -> pushes delivered!
    await db
      .update(custom_build_jobs)
      .set({ factory_stage: null })
      .where(eq(custom_build_jobs.id, job!.id));
    await db
      .update(saga_runs)
      .set({ status: "COMPENSATED" })
      .where(eq(saga_runs.correlation_key, oppId));

    const compRes = await runPushGhlFactoryStage(
      { event: { data: { opportunityId: oppId } }, step: makePushGhlStep().step },
      { getDb: () => db, ghl: { getGhl, putGhl }, env: VALID_GHL_ENV },
    );
    expect(compRes).toMatchObject({ ok: true, moved: true, stage: "delivered" });
    expect(putGhl).toHaveBeenLastCalledWith(`/opportunities/${oppId}`, {
      pipelineId: "pipe_factory_1",
      pipelineStageId: "stg_delivered",
    });
  });

  it("QA-R11-01 & QA-R11-06: pipeline validation rejects invalid stage configs with zero PUTs, and post-write GET race logs ghl-stage-race-detected without throwing", async () => {
    // 1. Target stage outside pipeline -> NonRetriableError.
    expect(() =>
      validateGhlStageConfigAgainstPipelines(VALID_PIPELINES_PAYLOAD, {
        ...VALID_GHL_ENV,
        GHL_STAGE_ID_DELIVERED: "stg_outside_pipeline",
      }),
    ).toThrow(/does not belong to pipeline/);

    // 2. Duplicate target stage IDs -> throws.
    expect(() =>
      validateGhlStageConfigAgainstPipelines(VALID_PIPELINES_PAYLOAD, {
        ...VALID_GHL_ENV,
        GHL_STAGE_ID_READY_TO_SHIP: "stg_build_done",
      }),
    ).toThrow(/duplicate target stage id/);

    // 3. Target stage ID in GHL_WON_STAGE_IDS -> throws.
    expect(() =>
      validateGhlStageConfigAgainstPipelines(VALID_PIPELINES_PAYLOAD, {
        ...VALID_GHL_ENV,
        GHL_STAGE_ID_IN_PRODUCTION: "stg_won_1",
      }),
    ).toThrow(/echo-loop hazard/);

    // 4. Target stage named "produce factory order " -> throws.
    const echoNamedPipelines = {
      pipelines: [
        {
          id: "pipe_factory_1",
          stages: [
            { id: "stg_in_prod", name: "produce factory order " },
            { id: "stg_build_done", name: "Build Complete" },
            { id: "stg_ready_ship", name: "Ready To Ship" },
            { id: "stg_delivered", name: "Delivered" },
          ],
        },
      ],
    };
    expect(() =>
      validateGhlStageConfigAgainstPipelines(echoNamedPipelines, VALID_GHL_ENV),
    ).toThrow(/echo-loop hazard/);

    // Verify runPushGhlFactoryStage wraps pipeline validation failure in NonRetriableError with 0 PUTs.
    const oppBadCfg = "opp_bad_cfg";
    await db.insert(order_intake).values({
      ghl_opportunity_id: oppBadCfg,
      status: "pushed",
      raw_payload: { id: oppBadCfg },
      factory_stage: "in_production",
    });
    const putNever = vi.fn();
    await expect(
      runPushGhlFactoryStage(
        { event: { data: { opportunityId: oppBadCfg } }, step: makePushGhlStep().step },
        {
          getDb: () => db,
          env: VALID_GHL_ENV,
          ghl: {
            getGhl: async () => ({
              ok: true,
              body: echoNamedPipelines,
              locationId: "loc_ccpatio_1",
            }),
            putGhl: putNever,
          },
        },
      ),
    ).rejects.toBeInstanceOf(NonRetriableError);
    expect(putNever).not.toHaveBeenCalled();

    // 5. Post-write verification race (QA-R11-06): logs ghl-stage-race-detected without throwing.
    const warnLogs: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((msg) => {
      warnLogs.push(String(msg));
    });

    let getCount = 0;
    const raceResult = await moveOpportunityStage(
      { opportunityId: "opp_race_1", targetStage: "build_complete", env: VALID_GHL_ENV },
      {
        getGhl: async () => {
          getCount += 1;
          return {
            ok: true,
            locationId: "loc_ccpatio_1",
            body: {
              opportunity: {
                id: "opp_race_1",
                locationId: "loc_ccpatio_1",
                status: getCount === 1 ? "open" : "lost",
                pipelineId: "pipe_factory_1",
                pipelineStageId: getCount === 1 ? "stg_in_prod" : "stg_human_override",
              },
            },
          };
        },
        putGhl: async () => ({ ok: true, body: {}, locationId: "loc_ccpatio_1" }),
      },
    );

    expect(raceResult).toEqual({
      moved: true,
      fromStageId: "stg_in_prod",
      targetStageId: "stg_build_done",
      raceDetected: true,
    });
    expect(warnLogs.some((l) => l.includes("ghl-stage-race-detected"))).toBe(true);
  });

  it("QA-R9-03 & QA-R12-01..02: deriveFactoryStage enforces expectedMoIds superset, ignores foreign sales_order_id MOs, and blocks empty expectedMoIds when SO is IN_PROGRESS", () => {
    const soInProgress: KatanaSoSnapshot = {
      id: 91804422,
      orderNo: "GHL-opp01HZX8R9K2M3N4P5Q6",
      status: "NOT_SHIPPED",
      productionStatus: "IN_PROGRESS",
    };

    // Expected [1, 2, 3], listed [1 DONE, 2 DONE] -> in_production (not build_complete).
    expect(
      deriveFactoryStage(
        soInProgress,
        [
          { id: 1, salesOrderId: 91804422, status: "DONE" },
          { id: 2, salesOrderId: 91804422, status: "DONE" },
        ],
        [1, 2, 3],
      ),
    ).toBe("in_production");

    // Expected [], listed MOs all DONE while SO is IN_PROGRESS -> in_production (not build_complete).
    expect(
      deriveFactoryStage(
        soInProgress,
        [
          { id: 1, salesOrderId: 91804422, status: "DONE" },
          { id: 2, salesOrderId: 91804422, status: "DONE" },
        ],
        [],
      ),
    ).toBe("in_production");

    // Foreign MO with sales_order_id !== so.id is ignored even if NOT_STARTED.
    const fixtureSo = readSalesOrderSnapshot(soGhlFixture);
    const fixtureMosWithForeign: KatanaMoSnapshot[] = [
      { id: 19833041, salesOrderId: fixtureSo.id, status: "DONE" },
      { id: 19833042, salesOrderId: fixtureSo.id, status: "DONE" },
      { id: 19839999, salesOrderId: 99999999, status: "NOT_STARTED" },
    ];
    expect(
      deriveFactoryStage(fixtureSo, fixtureMosWithForeign, [19833041, 19833042]),
    ).toBe("build_complete");
    // And raw moListFixture (where 19833042 is IN_PROGRESS) stays in_production:
    expect(
      deriveFactoryStage(
        fixtureSo,
        moListFixture.data.map(readManufacturingOrderSnapshot),
        [19833041, 19833042],
      ),
    ).toBe("in_production");
  });

  it("QA-R10-02..04: 50 concurrent signed Katana webhooks succeed with p95 < 1000ms and 50 audit rows; 5x SO replay is idempotent; reconcile cron caps at 25 with deterministic hourly IDs and 0 fetches", async () => {
    const secret = "phase15_storm_secret";
    process.env.KATANA_WEBHOOK_SECRET = secret;
    const sendSpy = vi.spyOn(inngest, "send").mockResolvedValue({ ids: ["evt_storm"] });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { POST: postKatanaWebhook } = await import("@/app/api/webhooks/katana/route");

    const latenciesMs: number[] = [];
    const responses = await Promise.all(
      Array.from({ length: 50 }, async (_, idx) => {
        const raw = JSON.stringify({
          action: "sales_order.updated",
          object: { id: 91804400 + idx },
        });
        const sig = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
        const t0 = performance.now();
        const res = await postKatanaWebhook(
          new Request("http://localhost/api/webhooks/katana", {
            method: "POST",
            body: raw,
            headers: { "x-sha2-signature": sig },
          }),
        );
        latenciesMs.push(performance.now() - t0);
        return res;
      }),
    );

    for (const res of responses) {
      expect(res.status).toBe(200);
    }
    const sorted = [...latenciesMs].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    expect(p95).toBeLessThan(1000);

    const auditRows = await db.select().from(incoming_webhooks);
    expect(auditRows).toHaveLength(50);
    expect(sendSpy).toHaveBeenCalledTimes(50);

    // 5x replay of sales_order.updated + GHL push -> identical hub state, 1 GHL PUT total.
    const oppReplay = "opp_replay_5x";
    await db.insert(order_intake).values({
      ghl_opportunity_id: oppReplay,
      status: "pushed",
      raw_payload: { id: oppReplay },
      katana_sales_order_id: 99001,
      katana_mo_ids: [601],
    });

    let remoteStage = "stg_produce_factory_1";
    const putReplay = vi.fn(async (_p: string, b: unknown): Promise<GhlResult> => {
      remoteStage = (b as { pipelineStageId: string }).pipelineStageId;
      return { ok: true, body: {}, locationId: "loc_ccpatio_1" };
    });
    const getReplay = vi.fn(async (p: string): Promise<GhlResult> =>
      p.startsWith("/opportunities/pipelines")
        ? { ok: true, body: VALID_PIPELINES_PAYLOAD, locationId: "loc_ccpatio_1" }
        : {
            ok: true,
            locationId: "loc_ccpatio_1",
            body: {
              opportunity: {
                id: oppReplay,
                locationId: "loc_ccpatio_1",
                status: "open",
                pipelineId: "pipe_factory_1",
                pipelineStageId: remoteStage,
              },
            },
          },
    );

    for (let i = 0; i < 5; i += 1) {
      const s = makeOrderStatusStep();
      await runSyncKatanaOrderStatus(
        { event: { data: { salesOrderId: 99001 } }, step: s.step },
        {
          getDb: () => db,
          fetchSalesOrder: async () => ({
            id: 99001,
            orderNo: `GHL-${oppReplay}`,
            status: "NOT_SHIPPED",
            productionStatus: "IN_PROGRESS",
          }),
          listMosForSalesOrder: async () => [{ id: 601, salesOrderId: 99001, status: "DONE" }],
          nowIso: () => `2026-04-12T18:00:0${i}.000Z`,
        },
      );
      if (s.sentEvents.length > 0) {
        await runPushGhlFactoryStage(
          { event: { data: { opportunityId: oppReplay } }, step: makePushGhlStep().step },
          { getDb: () => db, ghl: { getGhl: getReplay, putGhl: putReplay }, env: VALID_GHL_ENV },
        );
      }
    }
    expect(putReplay).toHaveBeenCalledTimes(1);

    // Reconcile cron with 30 open orders -> emits 25 events with deterministic hourly IDs and 0 fetches.
    for (let i = 1; i <= 30; i += 1) {
      await db.insert(order_intake).values({
        ghl_opportunity_id: `opp_rec_${i}`,
        status: "pushed",
        raw_payload: { id: `opp_rec_${i}` },
        katana_sales_order_id: 60000 + i,
        factory_stage: "in_production",
      });
    }

    const fixedNow = new Date("2026-04-12T20:15:00.000Z");
    const reconcileBatches: Array<Array<{ id: string; name: string; data: Record<string, unknown> }>> = [];
    const recStep: ReconcileStepLike = {
      run: async (_id, fn) => fn(),
      sendEvent: async (_id, payload) => {
        reconcileBatches.push(Array.isArray(payload) ? payload : [payload]);
        return { ids: [] };
      },
    };

    const recRes1 = await runKatanaOrderStatusReconcile(
      { step: recStep },
      { getDb: () => db, now: () => fixedNow },
    );
    const recRes2 = await runKatanaOrderStatusReconcile(
      { step: recStep },
      { getDb: () => db, now: () => fixedNow },
    );

    expect(recRes1).toEqual({
      ok: true,
      count: RECONCILE_BATCH_LIMIT,
      hourBucket: formatReconcileHourBucket(fixedNow),
    });
    expect(reconcileBatches[0]).toHaveLength(25);
    expect(reconcileBatches[0]?.map((e) => e.id)).toEqual(
      reconcileBatches[1]?.map((e) => e.id),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("QA-R14-01: POST /api/webhooks/ghl ignores our outbound factory stages (GHL_STAGE_ID_BUILD_COMPLETE) with zero order_intake inserts", async () => {
    const ghlSecret = "ghl_echo_guard_secret";
    process.env.GHL_WEBHOOK_SECRET = ghlSecret;
    process.env.GHL_FACTORY_STAGE_IDS = "stg_produce_factory_1";

    const payload = {
      id: "opp_echo_check_1",
      name: "Resort Cabana",
      status: "open",
      pipeline_stage_id: VALID_GHL_ENV.GHL_STAGE_ID_BUILD_COMPLETE,
      stage_name: "Build Complete",
      contact: {
        first_name: "Alex",
        last_name: "Builder",
        email: "alex@example.test",
      },
    };
    const raw = JSON.stringify(payload);
    const sig = createHmac("sha256", ghlSecret).update(raw, "utf8").digest("hex");

    const { POST: postGhlWebhook } = await import("@/app/api/webhooks/ghl/route");
    const res = await postGhlWebhook(
      new Request("http://localhost/api/webhooks/ghl", {
        method: "POST",
        body: raw,
        headers: { "x-ghl-signature": sig },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ignored: true,
      reason: "stage",
      opportunity_id: "opp_echo_check_1",
    });

    const intakeRows = await db.select().from(order_intake);
    expect(intakeRows).toHaveLength(0);
  });
});

describe("Parked PO bill redrive, vendor refresh, manual resolution & CLI (QA-S4-01..05, QA-S4-07, QA-S4-09)", () => {
  let pg: PGlite;
  let db: MiddlewareDb;

  beforeEach(async () => {
    const created = await createPhase15ResilienceDb();
    pg = created.pg;
    db = created.db;
    activeTestDbRef.current = db;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    activeTestDbRef.current = null;
    vi.restoreAllMocks();
    await pg.close();
  });

  it("QA-S4-01 & QA-S4-02: config_missing park -> redrive reopens with r1 requestid, resolves DLQ row, posts QBO bill; duplicate redrive skips as stale_redrive", async () => {
    const po = makeHydratedPoFromFixtures();
    const recStep = makePoStep();
    const rec = await runSyncKatanaPoReceived(
      {
        event: { data: { purchaseOrderId: po.katanaPoId, action: "purchase_order.partially_received" } },
        step: recStep.step,
      },
      { getDb: () => db, fetchPo: async () => po, env: VALID_QBO_ENV },
    );
    const billRowId = (rec as { billRowId: string }).billRowId;

    // Park on config_missing in postKatanaPoBill.
    const parkRunId = "run_park_cfg_1";
    await expect(
      runPostKatanaPoBill(
        {
          event: { data: { billRowId, katanaPoId: po.katanaPoId, redriveSeq: 0 } },
          step: makePoStep().step,
          runId: parkRunId,
        },
        {
          getDb: () => db,
          qbo: makeHappyQboDeps(),
          env: { QBO_LEDGER_MODE: "live", LEDGER_COMPANY_TIMEZONE: "America/Phoenix" },
        },
      ),
    ).rejects.toBeInstanceOf(NonRetriableError);

    // Seed matching open dlq_events row for parked_run_id.
    await db.insert(dlq_events).values({
      run_id: parkRunId,
      function_id: "post-katana-po-bill",
      event_name: "katana/po_bill.post_requested",
      error_message: "QBO A/P posting config incomplete",
      original_event: { data: { billRowId } },
      status: "open",
    });

    const redriveStep1 = makePoStep();
    const redrive1 = await runRedriveKatanaPoBill(
      {
        event: {
          data: {
            billRowId,
            katanaPoId: po.katanaPoId,
            expectedRedriveCount: 0,
            operator: "ops@ccpatio.com",
          },
        },
        step: redriveStep1.step,
      },
      { getDb: () => db },
    );
    expect(redrive1).toEqual({ ok: true, reopened: true, redriveSeq: 1 });
    expect(redriveStep1.sentEvents).toHaveLength(1);

    // Duplicate redrive while reopened skips as not_parked; if re-parked at r1, stale expectedRedriveCount = 0 skips as stale_redrive (QA-S4-02).
    const redriveStepWhilePending = makePoStep();
    const redriveWhilePending = await runRedriveKatanaPoBill(
      {
        event: {
          data: {
            billRowId,
            katanaPoId: po.katanaPoId,
            expectedRedriveCount: 0,
            operator: "ops@ccpatio.com",
          },
        },
        step: redriveStepWhilePending.step,
      },
      { getDb: () => db },
    );
    expect(redriveWhilePending).toMatchObject({ ok: true, outcome: "skipped", reason: "not_parked" });
    expect(redriveStepWhilePending.sentEvents).toHaveLength(0);

    // Park again at r1 (still missing config) to verify stale_redrive when expectedRedriveCount = 0, then redrive r1 -> r2!
    await expect(
      runPostKatanaPoBill(
        {
          event: { data: { billRowId, katanaPoId: po.katanaPoId, redriveSeq: 1 } },
          step: makePoStep().step,
          runId: "run_park_cfg_r1",
        },
        {
          getDb: () => db,
          qbo: makeHappyQboDeps(),
          env: { QBO_LEDGER_MODE: "live", LEDGER_COMPANY_TIMEZONE: "America/Phoenix" },
        },
      ),
    ).rejects.toBeInstanceOf(NonRetriableError);

    const redriveStepDup = makePoStep();
    const redriveDup = await runRedriveKatanaPoBill(
      {
        event: {
          data: {
            billRowId,
            katanaPoId: po.katanaPoId,
            expectedRedriveCount: 0,
            operator: "ops@ccpatio.com",
          },
        },
        step: redriveStepDup.step,
      },
      { getDb: () => db },
    );
    expect(redriveDup).toMatchObject({ ok: true, outcome: "skipped", reason: "stale_redrive" });
    expect(redriveStepDup.sentEvents).toHaveLength(0);

    const redriveStep2 = makePoStep();
    const redrive2 = await runRedriveKatanaPoBill(
      {
        event: {
          data: {
            billRowId,
            katanaPoId: po.katanaPoId,
            expectedRedriveCount: 1,
            operator: "ops@ccpatio.com",
          },
        },
        step: redriveStep2.step,
      },
      { getDb: () => db },
    );
    expect(redrive2).toEqual({ ok: true, reopened: true, redriveSeq: 2 });

    // Execute reopened postKatanaPoBill with fixed config -> posted!
    const postRes = await runPostKatanaPoBill(
      {
        event: { data: { billRowId, katanaPoId: po.katanaPoId, redriveSeq: 2 } },
        step: makePoStep().step,
        runId: "run_post_r2",
      },
      { getDb: () => db, qbo: makeHappyQboDeps(), env: VALID_QBO_ENV },
    );
    expect(postRes).toMatchObject({ ok: true, posted: true, qboBillId: "qbo_bill_9001" });

    const [billAfter] = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.id, billRowId));
    expect(billAfter?.status).toBe("posted");
    expect(billAfter?.redrive_count).toBe(2);
    expect(billAfter?.qbo_request_id).toBe(
      derivePoBillRequestId(po.katanaPoId, po.fingerprint, 2),
    );
    expect(billAfter?.redrive_log).toHaveLength(2);
    expect(billAfter?.redrive_log[0]?.outcome).toBe("reopened");

    const [sagaAfter] = await db
      .select()
      .from(saga_runs)
      .where(eq(saga_runs.saga_type, KATANA_PO_BILL_SAGA_TYPE));
    expect(sagaAfter?.status).toBe("COMPLETED");

    const [dlqAfter] = await db
      .select()
      .from(dlq_events)
      .where(eq(dlq_events.run_id, parkRunId));
    expect(dlqAfter?.status).toBe("resolved");
  });

  it("QA-S4-03 & QA-S4-04: vendor park redrive stays parked when QBO_ID is still missing, then preserves frozen lines/fingerprint/delta byte-identically when supplier QBO_ID is fixed", async () => {
    const supplierNoQbo = { ...structuredClone(supplierFixture), comment: "Preferred trade vendor" };
    const poMissingVendor = makeHydratedPoFromFixtures({ rawSupplier: supplierNoQbo });

    const rec = await runSyncKatanaPoReceived(
      {
        event: {
          data: { purchaseOrderId: poMissingVendor.katanaPoId, action: "purchase_order.partially_received" },
        },
        step: makePoStep().step,
      },
      { getDb: () => db, fetchPo: async () => poMissingVendor, env: VALID_QBO_ENV },
    );
    const billRowId = (rec as { billRowId: string }).billRowId;

    await expect(
      runPostKatanaPoBill(
        {
          event: { data: { billRowId, katanaPoId: poMissingVendor.katanaPoId, redriveSeq: 0 } },
          step: makePoStep().step,
          runId: "run_park_vendor_1",
        },
        { getDb: () => db, qbo: makeHappyQboDeps(), env: VALID_QBO_ENV },
      ),
    ).rejects.toBeInstanceOf(NonRetriableError);

    const [frozenBefore] = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.id, billRowId));
    expect(frozenBefore?.park_reason).toBe("vendor_qbo_id_missing");

    // 1. Redrive routes to vendor refresh; supplier still missing QBO_ID -> still_blocked:vendor_qbo_id_missing, 0 QBO calls.
    const redriveStepA = makePoStep();
    const redriveA = await runRedriveKatanaPoBill(
      {
        event: {
          data: {
            billRowId,
            katanaPoId: poMissingVendor.katanaPoId,
            expectedRedriveCount: 0,
            operator: "ops@ccpatio.com",
          },
        },
        step: redriveStepA.step,
      },
      { getDb: () => db },
    );
    expect(redriveA).toEqual({ ok: true, requestedVendorRefresh: true });

    const refreshStepA = makePoStep();
    const refreshStillMissing = await runRefreshKatanaPoBillVendor(
      {
        event: {
          data: {
            billRowId,
            katanaPoId: poMissingVendor.katanaPoId,
            expectedRedriveCount: 0,
            operator: "ops@ccpatio.com",
          },
        },
        step: refreshStepA.step,
      },
      {
        getDb: () => db,
        fetchSupplierOnly: async (): Promise<HydratedKatanaSupplier> => ({
          supplierId: 4021901,
          supplierName: "Sunbrella Fabrics Trade",
          qboVendorId: null,
          vendorRefError: "vendor_qbo_id_missing",
        }),
      },
    );
    expect(refreshStillMissing).toMatchObject({
      ok: true,
      outcome: "still_blocked",
      reason: "vendor_qbo_id_missing",
    });
    expect(refreshStepA.sentEvents).toHaveLength(0);

    // 2. Supplier now has QBO_ID: 145 (even if PO rows mutated on Katana!) -> frozen lines/fingerprint/delta stay byte-identical and bill posts.
    const refreshStepB = makePoStep();
    const refreshFixed = await runRefreshKatanaPoBillVendor(
      {
        event: {
          data: {
            billRowId,
            katanaPoId: poMissingVendor.katanaPoId,
            expectedRedriveCount: 0,
            operator: "ops@ccpatio.com",
          },
        },
        step: refreshStepB.step,
      },
      {
        getDb: () => db,
        fetchSupplierOnly: async (): Promise<HydratedKatanaSupplier> => ({
          supplierId: 4021901,
          supplierName: "Sunbrella Fabrics Trade",
          qboVendorId: "145",
          vendorRefError: null,
        }),
      },
    );
    expect(refreshFixed).toEqual({ ok: true, reopened: true, redriveSeq: 1 });
    expect(refreshStepB.sentEvents).toHaveLength(1);

    const qboDeps = makeHappyQboDeps();
    await runPostKatanaPoBill(
      {
        event: { data: { billRowId, katanaPoId: poMissingVendor.katanaPoId, redriveSeq: 1 } },
        step: makePoStep().step,
        runId: "run_post_after_vendor_refresh",
      },
      { getDb: () => db, qbo: qboDeps, env: VALID_QBO_ENV },
    );

    const [afterPost] = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.id, billRowId));
    expect(afterPost?.status).toBe("posted");
    expect(afterPost?.qbo_vendor_id).toBe("145");
    expect(JSON.stringify(afterPost?.lines)).toBe(JSON.stringify(frozenBefore?.lines));
    expect(afterPost?.receipt_fingerprint).toBe(frozenBefore?.receipt_fingerprint);
    expect(afterPost?.delta_total_cents).toBe(frozenBefore?.delta_total_cents);
  });

  it("QA-S4-05: manual resolution entered_by_hand refuses QBO Bill total mismatch unless allowAmountDifference is set", async () => {
    const eurRawPo = { ...structuredClone(poReceivedFixture), currency: "EUR" };
    const eurPo = makeHydratedPoFromFixtures({ rawPo: eurRawPo });

    await expect(
      runSyncKatanaPoReceived(
        {
          event: { data: { purchaseOrderId: eurPo.katanaPoId, action: "purchase_order.received" } },
          step: makePoStep().step,
          runId: "run_eur_park",
        },
        { getDb: () => db, fetchPo: async () => eurPo, env: VALID_QBO_ENV },
      ),
    ).rejects.toBeInstanceOf(NonRetriableError);

    const [parkedRow] = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.katana_po_id, eurPo.katanaPoId));
    expect(parkedRow?.park_reason).toBe("currency_unsupported");

    const mismatchedQbo = makeHappyQboDeps({
      fetchBillById: vi.fn(async (id: string) => ({
        id,
        docNumber: "PO-2026-0418",
        vendorId: "145",
        totalCents: 99999,
        currency: "USD",
      })),
    });

    // Without allowAmountDifference -> refused.
    const refused = await runResolveKatanaPoBill(
      {
        event: {
          data: {
            billRowId: parkedRow!.id,
            expectedRedriveCount: 0,
            resolutionKind: "entered_by_hand",
            qboRef: "qbo_manual_bill_77",
            note: "Entered FX converted bill manually in QBO",
            operator: "accounting@ccpatio.com",
            allowAmountDifference: false,
          },
        },
        step: makePoStep().step,
      },
      { getDb: () => db, qbo: mismatchedQbo },
    );
    expect(refused).toMatchObject({ ok: true, refused: true });

    // With allowAmountDifference: true -> resolved_manually!
    const resolved = await runResolveKatanaPoBill(
      {
        event: {
          data: {
            billRowId: parkedRow!.id,
            expectedRedriveCount: 0,
            resolutionKind: "entered_by_hand",
            qboRef: "qbo_manual_bill_77",
            note: "Entered FX converted bill manually in QBO",
            operator: "accounting@ccpatio.com",
            allowAmountDifference: true,
          },
        },
        step: makePoStep().step,
      },
      { getDb: () => db, qbo: mismatchedQbo },
    );
    expect(resolved).toMatchObject({
      ok: true,
      resolved: true,
      resolutionKind: "entered_by_hand",
    });

    const [afterResolve] = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.id, parkedRow!.id));
    expect(afterResolve?.status).toBe("resolved_manually");
    expect(afterResolve?.resolution_ref).toBe("qbo_manual_bill_77");
    expect(afterResolve?.resolved_by).toBe("accounting@ccpatio.com");
  });

  it("QA-S4-07 & QA-S4-09: ops CLI dry-run sends 0 events, enforces --operator on --execute, exits 2 on ineligible rows, and emits domain events on valid --execute", async () => {
    const [cfgRow] = await db
      .insert(katana_po_bills)
      .values({
        katana_po_id: 55101,
        order_no: "PO-55101",
        receipt_fingerprint: "fp_cfg_1",
        receipt_seq: 1,
        action: "purchase_order.received",
        lines: [],
        delta_total_cents: 12500,
        qbo_request_id: "katana-po-55101-r0-fpcfg1",
        status: "requires_manual_intervention",
        park_reason: "config_missing",
        katana_supplier_id: 4021901,
        vendor_ref_error: "vendor_qbo_id_missing",
      })
      .returning();

    const [negRow] = await db
      .insert(katana_po_bills)
      .values({
        katana_po_id: 55102,
        order_no: "PO-55102",
        receipt_fingerprint: "fp_neg_1",
        receipt_seq: 1,
        action: "purchase_order.received",
        lines: [],
        delta_total_cents: 0,
        qbo_request_id: "katana-po-55102-r0-fpneg1",
        status: "requires_manual_intervention",
        park_reason: "negative_receipt",
      })
      .returning();

    const [driftRow] = await db
      .insert(katana_po_bills)
      .values({
        katana_po_id: 55103,
        order_no: "PO-55103",
        receipt_fingerprint: "fp_drift_1",
        receipt_seq: 1,
        action: "purchase_order.received",
        lines: [],
        delta_total_cents: 5000,
        qbo_request_id: "katana-po-55103-r0-fpdrift1",
        status: "requires_manual_intervention",
        park_reason: "price_drift",
      })
      .returning();

    // 1. list & list --vendor-gaps & status --id
    const listRes = await runPoBillsCli(["list", "--json"], { getDb: () => db });
    expect(listRes.exitCode).toBe(0);
    expect(JSON.parse(listRes.output[0]!).parked).toHaveLength(3);

    const gapsRes = await runPoBillsCli(["list", "--vendor-gaps", "--json"], { getDb: () => db });
    expect(gapsRes.exitCode).toBe(0);
    expect(JSON.parse(gapsRes.output[0]!).vendorGaps.length).toBeGreaterThanOrEqual(1);

    const statusRes = await runPoBillsCli(["status", "--id", cfgRow!.id, "--json"], {
      getDb: () => db,
    });
    expect(statusRes.exitCode).toBe(0);

    // 2. Dry-run (without --execute): sends 0 events, exits 0.
    const dryRunEvents: OutboundPoBillDomainEvent[] = [];
    const dryRes = await runPoBillsCli(["retry", "--id", cfgRow!.id], {
      getDb: () => db,
      sendEvent: async (evt) => {
        dryRunEvents.push(evt);
      },
    });
    expect(dryRes.exitCode).toBe(0);
    expect(dryRunEvents).toHaveLength(0);

    // 3. --execute without --operator: exits 1, sends 0 events.
    const noOpRes = await runPoBillsCli(["retry", "--id", cfgRow!.id, "--execute"], {
      getDb: () => db,
      sendEvent: async (evt) => {
        dryRunEvents.push(evt);
      },
    });
    expect(noOpRes.exitCode).toBe(1);
    expect(dryRunEvents).toHaveLength(0);

    // 4. Ineligible row (negative_receipt on retry, or price_drift without --approve-price-drift): exits 2, sends 0 events.
    const negRetryRes = await runPoBillsCli(
      ["retry", "--id", negRow!.id, "--operator", "ops@ccpatio.com", "--execute"],
      {
        getDb: () => db,
        sendEvent: async (evt) => {
          dryRunEvents.push(evt);
        },
      },
    );
    expect(negRetryRes.exitCode).toBe(2);
    expect(dryRunEvents).toHaveLength(0);

    const driftNoFlagRes = await runPoBillsCli(
      ["retry", "--id", driftRow!.id, "--operator", "ops@ccpatio.com", "--execute"],
      {
        getDb: () => db,
        sendEvent: async (evt) => {
          dryRunEvents.push(evt);
        },
      },
    );
    expect(driftNoFlagRes.exitCode).toBe(2);
    expect(dryRunEvents).toHaveLength(0);

    // 5. Valid --execute emits KATANA_PO_BILL_REDRIVE_EVENT and KATANA_PO_BILL_RESOLVE_EVENT.
    const liveEvents: OutboundPoBillDomainEvent[] = [];
    const execRetry = await runPoBillsCli(
      ["retry", "--id", cfgRow!.id, "--operator", "ops@ccpatio.com", "--execute"],
      {
        getDb: () => db,
        sendEvent: async (evt) => {
          liveEvents.push(evt);
        },
      },
    );
    expect(execRetry.exitCode).toBe(0);
    expect(liveEvents).toHaveLength(1);
    expect(liveEvents[0]?.name).toBe(KATANA_PO_BILL_REDRIVE_EVENT);

    const execResolve = await runPoBillsCli(
      [
        "resolve",
        "--id",
        negRow!.id,
        "--kind",
        "katana_correction",
        "--operator",
        "ops@ccpatio.com",
        "--note",
        "Katana typo fixed prior to billing",
        "--execute",
      ],
      {
        getDb: () => db,
        sendEvent: async (evt) => {
          liveEvents.push(evt);
        },
      },
    );
    expect(execResolve.exitCode).toBe(0);
    expect(liveEvents).toHaveLength(2);
    expect(liveEvents[1]?.name).toBe(KATANA_PO_BILL_RESOLVE_EVENT);
  });
});
