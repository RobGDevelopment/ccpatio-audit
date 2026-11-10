import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { NonRetriableError } from "inngest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { STANDARD_TRACKS } from "@/lib/factory-routing/resources";
import type { PimSession } from "@/lib/pim-audit";
import * as schema from "@/server/db/schema";
import {
  custom_build_job_items,
  custom_build_jobs,
  factory_airlock_builds,
  factory_airlock_decisions,
  pim_audit_log,
  saga_runs,
  user_roles,
} from "@/server/db/schema";
import type { ReleaseDb } from "@/server/path-a/release-store";

const testState = vi.hoisted(() => ({
  db: null as unknown as ReleaseDb,
  pimSession: null as PimSession | null,
  authUser: null as { id: string; email: string } | null,
  sentInngestEvents: [] as Array<{ id?: string; name: string; data: Record<string, unknown> }>,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getDb: () => testState.db,
  closeDb: async () => undefined,
}));

vi.mock("@/lib/pim-audit", () => ({
  getPimSession: vi.fn(async () => testState.pimSession),
  isEmbedPrincipal: (session: PimSession | null | undefined) =>
    session?.email === "ghl-embed@ccpatio.com",
}));

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({
        data: { user: testState.authUser },
      }),
    },
  })),
}));

vi.mock("@/server/factory-bom/load-airlock-snapshot", () => ({
  loadAirlockSnapshot: vi.fn(async (rootSku: string) => ({
    rootSku,
    lines: [
      {
        parent_sku: rootSku,
        child_sku: "RAW-FAB-SUNBRELLA-01",
        quantity: "4.5000",
        scrap_factor: "1.1000",
        unit_of_measure: "yd",
        status: "edited",
        source: "sketchup_geometry",
        notes: "Seat cushion fabric",
        cut_list: [],
      },
    ],
    operations: STANDARD_TRACKS.final_assembly.map((step) => ({
      item_sku: rootSku,
      work_center: step.resource,
      sequence: step.sequence,
      setup_time_mins: "5",
      run_time_mins: "20",
    })),
    cadUpload: {
      id: "00000000-0000-4000-8000-000000000001",
      ext: "glb",
      status: "draft_ready",
      sha256: "a".repeat(64),
      geometry_snapshot: { hygiene: "pass" },
    },
    releaseGate: null,
  })),
}));

import { inngest } from "@/inngest/client";
import {
  FACTORY_AIRLOCK_APPROVED_EVENT,
  factoryAirlockMarkPushed,
  factoryAirlockRelease,
  runFactoryAirlockMarkPushed,
  runFactoryAirlockRelease,
  type FactoryAirlockStepLike,
  type MarkPushedStepLike,
} from "@/inngest/factory-airlock";
import {
  approveAirlockAction,
  submitAirlockAction,
} from "@/server/factory-bom/airlock-actions";
import {
  decideAirlockRelease,
  loadJobAirlockState,
} from "@/server/path-a/airlock-release";
import {
  PATH_A_RELEASE_COMPLETED_EVENT,
  PATH_A_RELEASE_TO_PRODUCTION_EVENT,
  PATH_A_SAGA_TYPE,
  pathAReleaseEventId,
} from "@/server/path-a/events";
import { createItemStore } from "@/server/path-a/item-store";
import { recordDepositAndRequestRelease } from "@/server/path-a/release-request";
import { createReleaseStore } from "@/server/path-a/release-store";
import { IDEMPOTENCY_BY_EVENT_ID } from "@/server/sre/idempotency";
import { createSagaStore } from "@/server/sre/saga-store";

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "src", "server", "db", "migrations");

function splitMigrationStatements(sqlText: string): string[] {
  return sqlText
    .split(/-->\s*statement-breakpoint/g)
    .map((s) => s.trim())
    .filter((s) => s.replace(/^\s*--.*$/gm, "").trim().length > 0);
}

const PGLITE_PREREQ_DDL = `
  CREATE TYPE "user_role" AS ENUM ('SuperAdmin', 'IT_Admin', 'Ops_Manager', 'Designer');
  CREATE TYPE "item_type" AS ENUM ('raw_material', 'sub_assembly', 'finished_good', 'service');
  CREATE TABLE "sku_mappings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "global_sku" text NOT NULL UNIQUE,
    "category" text DEFAULT 'QA' NOT NULL,
    "item_type" "item_type" DEFAULT 'finished_good' NOT NULL,
    "original_name" text DEFAULT 'QA Custom Piece' NOT NULL,
    "katana_variant_id" integer
  );
  CREATE TABLE "cad_uploads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
  );
  CREATE TABLE "order_intake" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
  );
  CREATE TABLE "user_roles" (
    "id" uuid PRIMARY KEY NOT NULL,
    "role" "user_role" NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "pim_audit_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "operator_email" text NOT NULL,
    "operator_name" text,
    "global_sku" text,
    "action" text NOT NULL,
    "field" text,
    "old_value" text,
    "new_value" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
`;

const DESIGNER_USER_ID = "11111111-1111-4111-8111-111111111111";
const MANAGER_USER_ID = "22222222-2222-4222-8222-222222222222";

function createFakeStep(): {
  step: FactoryAirlockStepLike & MarkPushedStepLike;
  stepEvents: Array<{ id?: string; name: string; data: Record<string, unknown> }>;
} {
  const stepEvents: Array<{ id?: string; name: string; data: Record<string, unknown> }> = [];
  const step: FactoryAirlockStepLike & MarkPushedStepLike = {
    run: async (_id, fn) => fn(),
    sendEvent: async (_id, payload) => {
      stepEvents.push(payload);
      return { ids: [payload.id ?? "evt"] };
    },
  };
  return { step, stepEvents };
}

describe("decideAirlockRelease (OD-1 pure decision)", () => {
  it("fails closed when a job has 0 items or any item without a build", () => {
    expect(decideAirlockRelease({ items: [] })).toEqual({
      kind: "waiting",
      unapprovedItemIds: [],
    });

    expect(
      decideAirlockRelease({
        items: [
          { itemId: "i1", buildId: "b1", status: "approved" },
          { itemId: "i2", buildId: null, status: null },
        ],
      }),
    ).toEqual({
      kind: "waiting",
      unapprovedItemIds: ["i2"],
    });
  });

  it("blocks when any build is draft, pending_manager, or rejected", () => {
    expect(
      decideAirlockRelease({
        items: [
          { itemId: "i1", buildId: "b1", status: "approved" },
          { itemId: "i2", buildId: "b2", status: "pending_manager" },
          { itemId: "i3", buildId: "b3", status: "rejected" },
        ],
      }),
    ).toEqual({
      kind: "waiting",
      unapprovedItemIds: ["i2", "i3"],
    });
  });

  it("returns release only when every item is approved/pushed AND at least one is approved; returns already_pushed when all are pushed", () => {
    expect(
      decideAirlockRelease({
        items: [
          { itemId: "i1", buildId: "b1", status: "approved" },
          { itemId: "i2", buildId: "b2", status: "approved" },
        ],
      }),
    ).toEqual({ kind: "release" });

    expect(
      decideAirlockRelease({
        items: [
          { itemId: "i1", buildId: "b1", status: "pushed" },
          { itemId: "i2", buildId: "b2", status: "approved" },
        ],
      }),
    ).toEqual({ kind: "release" });

    expect(
      decideAirlockRelease({
        items: [
          { itemId: "i1", buildId: "b1", status: "pushed" },
          { itemId: "i2", buildId: "b2", status: "pushed" },
        ],
      }),
    ).toEqual({ kind: "already_pushed" });
  });
});

describe("Factory Airlock dual-approval & Path A hand-off (PGlite)", () => {
  let pg: PGlite;
  let db: ReleaseDb;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(PGLITE_PREREQ_DDL);
    for (const file of [
      "0005_incoming_webhooks.sql",
      "0052_custom_build_jobs.sql",
      "0054_sre_dlq_saga_buckets.sql",
      "0055_path_a_stateless_release.sql",
      "0057_katana_reverse_flow.sql",
      "0058_factory_airlock.sql",
    ]) {
      const text = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      for (const stmt of splitMigrationStatements(text)) {
        await pg.exec(stmt);
      }
    }
    db = drizzle(pg, { schema }) as unknown as ReleaseDb;
    testState.db = db;

    await pg.query(
      `INSERT INTO "sku_mappings" ("global_sku", "category", "item_type", "original_name") VALUES ($1, $2, $3, $4)`,
      ["RAW-FAB-SUNBRELLA-01", "Fabric", "raw_material", "Sunbrella Canvas"],
    );

    await db.insert(user_roles).values([
      { id: DESIGNER_USER_ID, role: "Designer" },
      { id: MANAGER_USER_ID, role: "Ops_Manager" },
    ]);
  }, 60_000);

  afterAll(async () => {
    await pg?.close();
  });

  beforeEach(() => {
    testState.pimSession = null;
    testState.authUser = null;
    testState.sentInngestEvents = [];
    vi.restoreAllMocks();
    vi.spyOn(inngest, "send").mockImplementation((async (payload: unknown) => {
      const list = (Array.isArray(payload) ? payload : [payload]) as Array<{
        id?: string;
        name: string;
        data: Record<string, unknown>;
      }>;
      testState.sentInngestEvents.push(...list);
      return { ids: list.map((e) => e.id ?? "evt") };
    }) as typeof inngest.send);
  });

  it("wires Inngest metadata with exact ids, triggers, and IDEMPOTENCY_BY_EVENT_ID", () => {
    const releaseOpts = (factoryAirlockRelease as unknown as { opts?: Record<string, unknown> }).opts ?? {};
    expect(releaseOpts.id).toBe("factory-airlock-release");
    expect(releaseOpts.idempotency).toBe(IDEMPOTENCY_BY_EVENT_ID);
    expect(releaseOpts.onFailure).toBeUndefined();

    const pushedOpts = (factoryAirlockMarkPushed as unknown as { opts?: Record<string, unknown> }).opts ?? {};
    expect(pushedOpts.id).toBe("factory-airlock-mark-pushed");
    expect(pushedOpts.onFailure).toBeUndefined();
  });

  it("end-to-end dual-approval lifecycle: submit -> non-manager blocked -> manager approve -> log dryRun -> 1/2 waiting -> 2/2 release -> dedupe -> mark pushed & replay", async () => {
    const oppId = "opp-airlock-e2e-1";
    const sku1 = "JOB-AIRLOCK-PIECE-01";
    const sku2 = "JOB-AIRLOCK-PIECE-02";

    await pg.query(
      `INSERT INTO "sku_mappings" ("global_sku", "category", "item_type", "original_name") VALUES ($1, 'Seating', 'finished_good', 'Custom Sofa 1'), ($2, 'Seating', 'finished_good', 'Custom Chair 2')`,
      [sku1, sku2],
    );

    const [job] = await db
      .insert(custom_build_jobs)
      .values({
        client_slug: "acme-resort",
        display_name: "Acme Resort Lounge",
        ghl_opportunity_id: oppId,
        created_by: "designer@ccpatio.com",
      })
      .returning({ id: custom_build_jobs.id });
    const jobId = job!.id;

    const itemStore = createItemStore(() => db);
    const sagaStore = createSagaStore(() => db as never);
    const releaseStore = createReleaseStore(() => db);

    const item1 = await itemStore.ensureItem({ jobId, globalSku: sku1, quantity: 1 });
    const item2 = await itemStore.ensureItem({ jobId, globalSku: sku2, quantity: 2 });

    await sagaStore.insertOnce({
      sagaType: PATH_A_SAGA_TYPE,
      correlationKey: oppId,
      status: "AWAITING_DEPOSIT",
      currentStep: "awaiting_deposit_or_override",
    });

    // 1. Designer submit on piece 1 leaves pending_manager with zero Katana ids and zero Inngest events.
    testState.pimSession = {
      email: "ghl-embed@ccpatio.com",
      name: "GHL Embed Designer",
    };
    const submit1 = await submitAirlockAction({
      rootSku: sku1,
      identityConfirmed: true,
      cutListConfirmed: true,
      operationsConfirmed: true,
      reviewConfirmed: true,
    });
    expect(submit1).toEqual({ ok: true, status: "pending_manager" });
    expect(testState.sentInngestEvents).toHaveLength(0);

    const [build1AfterSubmit] = await db
      .select()
      .from(factory_airlock_builds)
      .where(eq(factory_airlock_builds.job_item_id, item1.id));
    expect(build1AfterSubmit?.status).toBe("pending_manager");
    expect(build1AfterSubmit?.submitted_by).toBe("ghl-embed@ccpatio.com");
    expect(build1AfterSubmit?.approved_by).toBeNull();

    const [jobAfterSubmit] = await db
      .select()
      .from(custom_build_jobs)
      .where(eq(custom_build_jobs.id, jobId));
    expect(jobAfterSubmit?.katana_sales_order_id).toBeNull();
    expect(jobAfterSubmit?.katana_mo_ids).toBeNull();

    const [item1AfterSubmit] = await db
      .select()
      .from(custom_build_job_items)
      .where(eq(custom_build_job_items.id, item1.id));
    expect(item1AfterSubmit?.katana_sales_order_row_id).toBeNull();
    expect(item1AfterSubmit?.katana_mo_id).toBeNull();

    // 2. Approve called with a non-manager session (embed principal & Designer user_roles) returns not_authorized.
    testState.authUser = { id: DESIGNER_USER_ID, email: "ghl-embed@ccpatio.com" };
    expect(
      await approveAirlockAction({
        buildId: build1AfterSubmit!.id,
        version: build1AfterSubmit!.version,
      }),
    ).toEqual({ ok: false, error: "not_authorized" });

    testState.authUser = { id: DESIGNER_USER_ID, email: "designer@ccpatio.com" };
    expect(
      await approveAirlockAction({
        buildId: build1AfterSubmit!.id,
        version: build1AfterSubmit!.version,
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(testState.sentInngestEvents).toHaveLength(0);

    // 3. Manager approve emits exactly one factory/airlock.approved event.
    testState.authUser = { id: MANAGER_USER_ID, email: "christian@ccpatio.com" };
    const approve1 = await approveAirlockAction({
      buildId: build1AfterSubmit!.id,
      version: build1AfterSubmit!.version,
    });
    expect(approve1).toEqual({ ok: true, status: "approved" });
    expect(testState.sentInngestEvents).toHaveLength(1);
    const approvedEvent1 = testState.sentInngestEvents[0]!;
    expect(approvedEvent1.name).toBe(FACTORY_AIRLOCK_APPROVED_EVENT);
    expect(approvedEvent1.data).toMatchObject({
      buildId: build1AfterSubmit!.id,
      jobItemId: item1.id,
      rootSku: sku1,
      ghlOpportunityId: oppId,
      approvedBy: "christian@ccpatio.com",
    });

    const decisions1 = await db
      .select()
      .from(factory_airlock_decisions)
      .where(eq(factory_airlock_decisions.build_id, build1AfterSubmit!.id));
    expect(decisions1.map((d) => d.action)).toEqual(["submit", "approve"]);

    // 4. GHL_FACTORY_ORDERS=log gives dryRun, no release event, and row stays approved.
    const logStep = createFakeStep();
    const dryRunRes = await runFactoryAirlockRelease(
      { event: { data: approvedEvent1.data }, step: logStep.step },
      { db, canPush: () => false },
    );
    expect(dryRunRes).toEqual({
      ok: true,
      dryRun: true,
      reason: "ghl_factory_orders_log",
    });
    expect(logStep.stepEvents).toHaveLength(0);
    const [build1AfterLog] = await db
      .select()
      .from(factory_airlock_builds)
      .where(eq(factory_airlock_builds.id, build1AfterSubmit!.id));
    expect(build1AfterLog?.status).toBe("approved");

    // 5a. Live with 1 of 2 items approved (item 2 has no build yet) gives waiting, no event.
    const liveWaitingStep = createFakeStep();
    const waitingNoBuildRes = await runFactoryAirlockRelease(
      { event: { data: approvedEvent1.data }, step: liveWaitingStep.step },
      { db, canPush: () => true },
    );
    expect(waitingNoBuildRes).toEqual({
      ok: true,
      waiting: true,
      unapprovedItemIds: [item2.id],
    });
    expect(liveWaitingStep.stepEvents).toHaveLength(0);

    // Submit item 2 (now pending_manager): still 1 of 2 approved -> waiting, no event.
    const submit2 = await submitAirlockAction({
      rootSku: sku2,
      identityConfirmed: true,
      cutListConfirmed: true,
      operationsConfirmed: true,
      reviewConfirmed: true,
    });
    expect(submit2).toEqual({ ok: true, status: "pending_manager" });

    const waitingPendingRes = await runFactoryAirlockRelease(
      { event: { data: approvedEvent1.data }, step: liveWaitingStep.step },
      { db, canPush: () => true },
    );
    expect(waitingPendingRes).toEqual({
      ok: true,
      waiting: true,
      unapprovedItemIds: [item2.id],
    });
    expect(liveWaitingStep.stepEvents).toHaveLength(0);

    // 5b. Manager approves item 2 -> Live with 2 of 2 approved emits exactly ONE path-a/release-to-production with source: "factory_airlock".
    testState.sentInngestEvents = [];
    const [build2Pending] = await db
      .select()
      .from(factory_airlock_builds)
      .where(eq(factory_airlock_builds.job_item_id, item2.id));
    const approve2 = await approveAirlockAction({
      buildId: build2Pending!.id,
      version: build2Pending!.version,
    });
    expect(approve2).toEqual({ ok: true, status: "approved" });
    expect(testState.sentInngestEvents).toHaveLength(1);
    const approvedEvent2 = testState.sentInngestEvents[0]!;

    const seenEventIds = new Set<string>();
    const dispatchAirlockApproved = async (evt: { id?: string; data: Record<string, unknown> }) => {
      // Simulates Inngest's IDEMPOTENCY_BY_EVENT_ID ("event.id") contract alongside the handler.
      if (evt.id && seenEventIds.has(evt.id)) {
        return { deduplicated: true as const, events: [] };
      }
      if (evt.id) seenEventIds.add(evt.id);
      const runStep = createFakeStep();
      const result = await runFactoryAirlockRelease(
        { event: { data: evt.data }, step: runStep.step },
        { db, canPush: () => true },
      );
      return { deduplicated: false as const, result, events: runStep.stepEvents };
    };

    const firstDelivery = await dispatchAirlockApproved(approvedEvent2);
    expect(firstDelivery.deduplicated).toBe(false);
    expect(firstDelivery.events).toHaveLength(1);
    expect(firstDelivery.events[0]).toEqual({
      id: pathAReleaseEventId(oppId, { airlock: jobId }),
      name: PATH_A_RELEASE_TO_PRODUCTION_EVENT,
      data: {
        ghlOpportunityId: oppId,
        source: "factory_airlock",
        requestedBy: "christian@ccpatio.com",
        reason: `factory airlock approved ${build2Pending!.id}`,
        attempt: 1,
      },
    });

    const sagaAfterReleaseReq = await releaseStore.getSaga(oppId);
    expect(sagaAfterReleaseReq?.release_source).toBe("factory_airlock");
    expect(sagaAfterReleaseReq?.release_requested_by).toBe("christian@ccpatio.com");

    const auditRows = await db
      .select()
      .from(pim_audit_log)
      .where(eq(pim_audit_log.action, "factory_airlock_release"));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.operator_email).toBe("christian@ccpatio.com");

    // 6. Second delivery of the same event id produces NO second release event.
    const duplicateDelivery = await dispatchAirlockApproved(approvedEvent2);
    expect(duplicateDelivery.deduplicated).toBe(true);
    expect(duplicateDelivery.events).toHaveLength(0);

    // 7. path-a/release.completed moves both builds to pushed. A replay changes nothing.
    const markStep1 = createFakeStep();
    const markRes1 = await runFactoryAirlockMarkPushed(
      {
        event: {
          data: {
            ghlOpportunityId: oppId,
            salesOrderId: 9001,
            orderNo: `PA-${oppId}`,
          },
        },
        step: markStep1.step,
      },
      { db },
    );
    expect(markRes1.ok).toBe(true);
    expect(markRes1.pushedCount).toBe(2);

    const stateAfterPush = await loadJobAirlockState(jobId, db);
    expect(stateAfterPush.items.map((i) => i.status)).toEqual(["pushed", "pushed"]);

    const buildsBeforeReplay = await db
      .select({ id: factory_airlock_builds.id, version: factory_airlock_builds.version })
      .from(factory_airlock_builds)
      .where(eq(factory_airlock_builds.job_item_id, item1.id));
    const vBefore = buildsBeforeReplay[0]!.version;

    const markStep2 = createFakeStep();
    const markRes2 = await runFactoryAirlockMarkPushed(
      {
        event: {
          data: {
            ghlOpportunityId: oppId,
            salesOrderId: 9001,
            orderNo: `PA-${oppId}`,
          },
        },
        step: markStep2.step,
      },
      { db },
    );
    expect(markRes2).toEqual({
      ok: true,
      ghlOpportunityId: oppId,
      pushedCount: 0,
      pushedBuildIds: [],
    });

    const buildsAfterReplay = await db
      .select({ version: factory_airlock_builds.version })
      .from(factory_airlock_builds)
      .where(eq(factory_airlock_builds.job_item_id, item1.id));
    expect(buildsAfterReplay[0]!.version).toBe(vBefore);

    // Also verify an approval event arriving after builds are pushed returns alreadyPushed with 0 events.
    const lateStep = createFakeStep();
    const lateRes = await runFactoryAirlockRelease(
      { event: { data: approvedEvent2.data }, step: lateStep.step },
      { db, canPush: () => true },
    );
    // reread-approved-build sees status === 'pushed', so it stops cleanly with 0 events.
    expect(lateRes).toEqual({ ok: false, reason: "not_approved" });
    expect(lateStep.stepEvents).toHaveLength(0);
  });

  it("OD-2: deposit on an unapproved airlock job returns recorded_awaiting_airlock, emits no event, and preserves deposit for subsequent airlock release", async () => {
    const oppId = "opp-airlock-deposit-od2";
    const sku = "JOB-AIRLOCK-DEP-01";

    await pg.query(
      `INSERT INTO "sku_mappings" ("global_sku", "category", "item_type", "original_name") VALUES ($1, 'Tables', 'finished_good', 'Custom Dining Table')`,
      [sku],
    );

    const [job] = await db
      .insert(custom_build_jobs)
      .values({
        client_slug: "palm-springs",
        display_name: "Palm Springs Patio",
        ghl_opportunity_id: oppId,
        created_by: "designer@ccpatio.com",
      })
      .returning({ id: custom_build_jobs.id });
    const jobId = job!.id;

    const itemStore = createItemStore(() => db);
    const sagaStore = createSagaStore(() => db as never);
    const releaseStore = createReleaseStore(() => db);

    await itemStore.ensureItem({ jobId, globalSku: sku, quantity: 1 });
    await sagaStore.insertOnce({
      sagaType: PATH_A_SAGA_TYPE,
      correlationKey: oppId,
      status: "AWAITING_DEPOSIT",
      currentStep: "awaiting_deposit_or_override",
    });

    testState.pimSession = { email: "designer@ccpatio.com", name: "Designer" };
    const sub = await submitAirlockAction({
      rootSku: sku,
      identityConfirmed: true,
      cutListConfirmed: true,
      operationsConfirmed: true,
      reviewConfirmed: true,
    });
    expect(sub).toEqual({ ok: true, status: "pending_manager" });

    const depositSends: unknown[] = [];
    const depResult = await recordDepositAndRequestRelease(
      {
        ghlOpportunityId: oppId,
        depositCents: 320000,
        depositRef: "CLOVER-PAY-777",
      },
      {
        db,
        releaseStore,
        sagaStore,
        inngestSend: async (evt) => {
          depositSends.push(evt);
          return { ids: ["unexpected"] };
        },
      },
    );

    expect(depResult).toEqual({ outcome: "recorded_awaiting_airlock" });
    expect(depositSends).toHaveLength(0);

    const sagaAfterDep = await releaseStore.getSaga(oppId);
    expect(sagaAfterDep?.deposit_cents).toBe(320000);
    expect(sagaAfterDep?.deposit_ref).toBe("CLOVER-PAY-777");
    expect(sagaAfterDep?.release_requested_at).toBeNull();
    expect(sagaAfterDep?.release_source).toBeNull();

    // Now manager approves the airlock build -> factory-airlock-release wins release_requested_at while keeping deposit intact!
    const [pendingBuild] = await db
      .select()
      .from(factory_airlock_builds)
      .where(eq(factory_airlock_builds.root_sku, sku));
    testState.authUser = { id: MANAGER_USER_ID, email: "christian@ccpatio.com" };
    testState.sentInngestEvents = [];
    const appRes = await approveAirlockAction({
      buildId: pendingBuild!.id,
      version: pendingBuild!.version,
    });
    expect(appRes).toEqual({ ok: true, status: "approved" });

    const releaseStep = createFakeStep();
    const relOut = await runFactoryAirlockRelease(
      { event: { data: testState.sentInngestEvents[0]!.data }, step: releaseStep.step },
      { db, canPush: () => true },
    );
    expect(relOut).toMatchObject({ ok: true, released: true, attempt: 1 });
    expect(releaseStep.stepEvents).toHaveLength(1);
    expect(releaseStep.stepEvents[0]!.data.source).toBe("factory_airlock");

    const finalSaga = await releaseStore.getSaga(oppId);
    expect(finalSaga?.release_source).toBe("factory_airlock");
    expect(finalSaga?.deposit_cents).toBe(320000);
    expect(finalSaga?.deposit_ref).toBe("CLOVER-PAY-777");
  });

  it("handles missing saga (NonRetriableError), saga COMPLETED/IN_PROGRESS skips, and management_override conflict without overriding", async () => {
    const oppMissing = "opp-airlock-no-saga";
    const skuMissing = "JOB-AIRLOCK-NOSAGA-01";

    await pg.query(
      `INSERT INTO "sku_mappings" ("global_sku", "category", "item_type", "original_name") VALUES ($1, 'Seating', 'finished_good', 'No Saga Piece')`,
      [skuMissing],
    );

    const [jobMissing] = await db
      .insert(custom_build_jobs)
      .values({
        client_slug: "missing-saga",
        display_name: "Missing Saga",
        ghl_opportunity_id: oppMissing,
        created_by: "designer@ccpatio.com",
      })
      .returning({ id: custom_build_jobs.id });

    const itemStore = createItemStore(() => db);
    const sagaStore = createSagaStore(() => db as never);
    const releaseStore = createReleaseStore(() => db);

    await itemStore.ensureItem({ jobId: jobMissing!.id, globalSku: skuMissing, quantity: 1 });

    testState.pimSession = { email: "designer@ccpatio.com", name: "Designer" };
    await submitAirlockAction({
      rootSku: skuMissing,
      identityConfirmed: true,
      cutListConfirmed: true,
      operationsConfirmed: true,
      reviewConfirmed: true,
    });

    const [bMissing] = await db
      .select()
      .from(factory_airlock_builds)
      .where(eq(factory_airlock_builds.root_sku, skuMissing));

    testState.authUser = { id: MANAGER_USER_ID, email: "christian@ccpatio.com" };
    testState.sentInngestEvents = [];
    await approveAirlockAction({ buildId: bMissing!.id, version: bMissing!.version });
    const evtPayload = testState.sentInngestEvents[0]!.data;

    // 1. Missing saga -> NonRetriableError
    const step1 = createFakeStep();
    await expect(
      runFactoryAirlockRelease({ event: { data: evtPayload }, step: step1.step }, { db, canPush: () => true }),
    ).rejects.toThrow(NonRetriableError);
    expect(step1.stepEvents).toHaveLength(0);

    // 2. Saga IN_PROGRESS -> skipped: "saga_IN_PROGRESS"
    await sagaStore.insertOnce({
      sagaType: PATH_A_SAGA_TYPE,
      correlationKey: oppMissing,
      status: "IN_PROGRESS",
      currentStep: "releasing",
    });
    const step2 = createFakeStep();
    expect(
      await runFactoryAirlockRelease({ event: { data: evtPayload }, step: step2.step }, { db, canPush: () => true }),
    ).toEqual({ ok: true, skipped: "saga_IN_PROGRESS" });
    expect(step2.stepEvents).toHaveLength(0);

    // 3. Saga COMPLETED -> skipped: "saga_COMPLETED"
    await db
      .update(saga_runs)
      .set({ status: "COMPLETED" })
      .where(eq(saga_runs.correlation_key, oppMissing));
    const step3 = createFakeStep();
    expect(
      await runFactoryAirlockRelease({ event: { data: evtPayload }, step: step3.step }, { db, canPush: () => true }),
    ).toEqual({ ok: true, skipped: "saga_COMPLETED" });
    expect(step3.stepEvents).toHaveLength(0);

    // 4. already_requested by management_override -> skipped: "release_already_requested", does not override
    await db
      .update(saga_runs)
      .set({
        status: "AWAITING_DEPOSIT",
        release_requested_at: new Date(),
        release_source: "management_override",
        release_requested_by: "owner@ccpatio.com",
      })
      .where(eq(saga_runs.correlation_key, oppMissing));
    const step4 = createFakeStep();
    expect(
      await runFactoryAirlockRelease({ event: { data: evtPayload }, step: step4.step }, { db, canPush: () => true }),
    ).toEqual({ ok: true, skipped: "release_already_requested" });
    expect(step4.stepEvents).toHaveLength(0);

    const preserved = await releaseStore.getSaga(oppMissing);
    expect(preserved?.release_source).toBe("management_override");
    expect(preserved?.release_requested_by).toBe("owner@ccpatio.com");
  });
});
