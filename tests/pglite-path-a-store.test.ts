/**
 * PGlite DB suite for Path A stores (item-store & release-store).
 * Tests atomic transitions, single-winner CAS, first-writer-wins release requests,
 * and statelessness (90-day backdated deal behaves identically).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createPathAPglite } from "./helpers/pglite";
import { createItemStore } from "@/server/path-a/item-store";
import { createReleaseStore } from "@/server/path-a/release-store";
import { createSagaStore } from "@/server/sre/saga-store";
import { PATH_A_SAGA_TYPE } from "@/server/path-a/saga-state";

type Handle = Awaited<ReturnType<typeof createPathAPglite>>;
let h: Handle;
let itemStore: ReturnType<typeof createItemStore>;
let releaseStore: ReturnType<typeof createReleaseStore>;
let sagaStore: ReturnType<typeof createSagaStore>;

beforeAll(async () => {
  h = await createPathAPglite();
  itemStore = createItemStore(() => h.db);
  releaseStore = createReleaseStore(() => h.db);
  sagaStore = createSagaStore(() => h.db as never);
}, 60_000);

afterAll(async () => {
  await h?.pg.close();
});

describe("Path A Stores (PGlite)", () => {
  it("ensureItem concurrent calls yield exactly one row", async () => {
    const oppId = "opp-ensure-test";
    const [job] = (
      await h.db.execute(sql`
        INSERT INTO custom_build_jobs (client_slug, display_name, ghl_opportunity_id, created_by)
        VALUES ('client-1', 'Job Ensure', ${oppId}, 'designer@ccpatio.com')
        RETURNING id
      `)
    ).rows as { id: string }[];

    const sku = "JOB-SKU-CONCURRENT-1";
    await h.db.execute(sql`INSERT INTO sku_mappings (global_sku) VALUES (${sku})`);

    // Call ensureItem 5 times concurrently
    const results = await Promise.all([
      itemStore.ensureItem({ jobId: job.id, globalSku: sku }),
      itemStore.ensureItem({ jobId: job.id, globalSku: sku }),
      itemStore.ensureItem({ jobId: job.id, globalSku: sku }),
      itemStore.ensureItem({ jobId: job.id, globalSku: sku }),
      itemStore.ensureItem({ jobId: job.id, globalSku: sku }),
    ]);

    expect(results).toHaveLength(5);
    const firstId = results[0]!.id;
    for (const r of results) {
      expect(r.id).toBe(firstId);
      expect(r.global_sku).toBe(sku);
      expect(r.design_status).toBe("awaiting_cad");
    }

    const items = await itemStore.listItemsForJob(job.id);
    expect(items).toHaveLength(1);
  });

  it("advanceSaga yields exactly one PENDING -> AWAITING_DEPOSIT transition and refuses while items pending", async () => {
    const oppId = "opp-advance-test";
    const [job] = (
      await h.db.execute(sql`
        INSERT INTO custom_build_jobs (client_slug, display_name, ghl_opportunity_id, created_by)
        VALUES ('client-2', 'Job Advance', ${oppId}, 'designer@ccpatio.com')
        RETURNING id
      `)
    ).rows as { id: string }[];

    // Insert saga row in PENDING
    await sagaStore.insertOnce({
      sagaType: PATH_A_SAGA_TYPE,
      correlationKey: oppId,
      status: "PENDING",
      currentStep: "designing",
    });

    // Add 2 items
    const sku1 = "JOB-SKU-ADV-1";
    const sku2 = "JOB-SKU-ADV-2";
    await h.db.execute(sql`INSERT INTO sku_mappings (global_sku) VALUES (${sku1}), (${sku2})`);

    await itemStore.ensureItem({ jobId: job.id, globalSku: sku1 });
    await itemStore.ensureItem({ jobId: job.id, globalSku: sku2 });

    // Item 1 moves to needs_review, then finalized
    await itemStore.setItemStatus({ globalSku: sku1, from: "awaiting_cad", to: "needs_review" });
    await itemStore.setItemStatus({
      globalSku: sku1,
      from: "needs_review",
      to: "finalized",
      finalizedDossierHash: "hash-1",
      finalizedBy: "lead@ccpatio.com",
    });

    // Advance while sku2 is still awaiting_cad -> must remain PENDING
    const advPartial = await releaseStore.advanceSaga(oppId);
    expect(advPartial.moved).toBe(true);
    expect(advPartial.status).toBe("PENDING");
    expect(advPartial.step).toBe("cad_dispatched");

    // Item 2 moves to finalized
    await itemStore.setItemStatus({ globalSku: sku2, from: "awaiting_cad", to: "needs_review" });
    await itemStore.setItemStatus({
      globalSku: sku2,
      from: "needs_review",
      to: "finalized",
      finalizedDossierHash: "hash-2",
      finalizedBy: "lead@ccpatio.com",
    });

    // Concurrent advance calls serialize; exactly one moves it to AWAITING_DEPOSIT
    const [adv1, adv2] = await Promise.all([
      releaseStore.advanceSaga(oppId),
      releaseStore.advanceSaga(oppId),
    ]);

    const movedCount = (adv1.moved ? 1 : 0) + (adv2.moved ? 1 : 0);
    expect(movedCount).toBe(1);
    expect(adv1.status).toBe("AWAITING_DEPOSIT");
    expect(adv2.status).toBe("AWAITING_DEPOSIT");
  });

  it("revertToDesigning works only from AWAITING_DEPOSIT", async () => {
    const oppId = "opp-revert-test";
    await sagaStore.insertOnce({
      sagaType: PATH_A_SAGA_TYPE,
      correlationKey: oppId,
      status: "AWAITING_DEPOSIT",
      currentStep: "awaiting_deposit_or_override",
    });

    const rev1 = await releaseStore.revertToDesigning(oppId, "design_changed");
    expect(rev1.reverted).toBe(true);

    const saga = await releaseStore.getSaga(oppId);
    expect(saga?.status).toBe("PENDING");
    expect(saga?.current_step).toBe("design_changed");

    // Reverting again from PENDING returns false
    const rev2 = await releaseStore.revertToDesigning(oppId);
    expect(rev2.reverted).toBe(false);
  });

  it("requestRelease first writer wins among concurrent callers and records source", async () => {
    const oppId = "opp-request-race";
    await sagaStore.insertOnce({
      sagaType: PATH_A_SAGA_TYPE,
      correlationKey: oppId,
      status: "AWAITING_DEPOSIT",
      currentStep: "awaiting_deposit_or_override",
    });

    // 3 concurrent requests: 2 overrides and 1 deposit
    const [req1, req2, req3] = await Promise.all([
      releaseStore.requestRelease({
        oppId,
        source: "management_override",
        requestedBy: "manager1@ccpatio.com",
        reason: "VIP fast track 1",
      }),
      releaseStore.requestRelease({
        oppId,
        source: "management_override",
        requestedBy: "manager2@ccpatio.com",
        reason: "VIP fast track 2",
      }),
      releaseStore.requestRelease({
        oppId,
        source: "customer_deposit",
        requestedBy: "qbo_sync",
        depositCents: 500000,
        depositRef: "DEP-100",
      }),
    ]);

    const results = [req1, req2, req3];
    const recorded = results.filter((r) => r.outcome === "recorded");
    const already = results.filter((r) => r.outcome === "already_requested");

    expect(recorded).toHaveLength(1);
    expect(already).toHaveLength(2);

    const saga = await releaseStore.getSaga(oppId);
    expect(saga?.release_requested_at).not.toBeNull();
  });

  it("deposit after an override records money durably without changing the source", async () => {
    const oppId = "opp-deposit-after-override";
    await sagaStore.insertOnce({
      sagaType: PATH_A_SAGA_TYPE,
      correlationKey: oppId,
      status: "AWAITING_DEPOSIT",
    });

    // Manager overrides first
    const overRes = await releaseStore.requestRelease({
      oppId,
      source: "management_override",
      requestedBy: "admin@ccpatio.com",
      reason: "Urgent show floor build",
    });
    expect(overRes.outcome).toBe("recorded");

    // Later customer deposit arrives
    const depRes = await releaseStore.requestRelease({
      oppId,
      source: "customer_deposit",
      requestedBy: "qbo_sync",
      depositCents: 750000,
      depositRef: "CHECK-999",
    });
    expect(depRes.outcome).toBe("already_requested");

    const saga = await releaseStore.getSaga(oppId);
    expect(saga?.release_source).toBe("management_override");
    expect(saga?.deposit_cents).toBe(750000);
    expect(saga?.deposit_ref).toBe("CHECK-999");
    expect(saga?.paid_at).not.toBeNull();
  });

  it("claimRelease yields one winner among concurrent claims and supports resume", async () => {
    const oppId = "opp-claim-race";
    await sagaStore.insertOnce({
      sagaType: PATH_A_SAGA_TYPE,
      correlationKey: oppId,
      status: "AWAITING_DEPOSIT",
    });

    // Refuses without release_requested_at
    const claimNoReq = await releaseStore.claimRelease(oppId);
    expect(claimNoReq.outcome).toBe("no_request");

    // Request release
    await releaseStore.requestRelease({
      oppId,
      source: "customer_deposit",
      requestedBy: "qbo",
      depositCents: 100000,
      depositRef: "DEP-1",
    });

    // 3 concurrent claims
    const [c1, c2, c3] = await Promise.all([
      releaseStore.claimRelease(oppId),
      releaseStore.claimRelease(oppId),
      releaseStore.claimRelease(oppId),
    ]);

    const claims = [c1, c2, c3];
    const claimedCount = claims.filter((c) => c.outcome === "claimed").length;
    const resumedCount = claims.filter((c) => c.outcome === "resumed").length;

    expect(claimedCount).toBe(1);
    expect(resumedCount).toBe(2);

    const saga = await releaseStore.getSaga(oppId);
    expect(saga?.status).toBe("IN_PROGRESS");
    expect(saga?.current_step).toBe("releasing");

    // Resuming manual failure with request
    await releaseStore.markSagaManual(oppId, "katana_mo", "timeout");
    const manualSaga = await releaseStore.getSaga(oppId);
    expect(manualSaga?.status).toBe("SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION");

    const resumeRes = await releaseStore.claimRelease(oppId);
    expect(resumeRes.outcome).toBe("resumed");
    const resumedSaga = await releaseStore.getSaga(oppId);
    expect(resumedSaga?.status).toBe("IN_PROGRESS");
  });

  it("bumpReleaseAttempt is strictly monotonic", async () => {
    const oppId = "opp-bump-test";
    await sagaStore.insertOnce({
      sagaType: PATH_A_SAGA_TYPE,
      correlationKey: oppId,
      status: "AWAITING_DEPOSIT",
    });

    const a1 = await releaseStore.bumpReleaseAttempt(oppId);
    const a2 = await releaseStore.bumpReleaseAttempt(oppId);
    const a3 = await releaseStore.bumpReleaseAttempt(oppId);

    expect(a1).toBe(1);
    expect(a2).toBe(2);
    expect(a3).toBe(3);
  });

  it("markSagaCompleted CAS works only from IN_PROGRESS", async () => {
    const oppId = "opp-complete-test";
    await sagaStore.insertOnce({
      sagaType: PATH_A_SAGA_TYPE,
      correlationKey: oppId,
      status: "AWAITING_DEPOSIT",
    });

    // Cannot complete from AWAITING_DEPOSIT
    const comp1 = await releaseStore.markSagaCompleted(oppId);
    expect(comp1.completed).toBe(false);

    // Request & claim to IN_PROGRESS
    await releaseStore.requestRelease({
      oppId,
      source: "management_override",
      requestedBy: "admin",
      reason: "Complete test",
    });
    await releaseStore.claimRelease(oppId);

    // Complete from IN_PROGRESS
    const comp2 = await releaseStore.markSagaCompleted(oppId);
    expect(comp2.completed).toBe(true);

    const saga = await releaseStore.getSaga(oppId);
    expect(saga?.status).toBe("COMPLETED");
    expect(saga?.current_step).toBe("released_to_production");
    expect(saga?.released_at).not.toBeNull();
  });

  it("STATELESS PROOF: a deal backdated 90 days is claimed and completed identically", async () => {
    const oppId = "opp-backdated-90-days";
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Insert saga with backdated created_at and updated_at
    await h.db.execute(sql`
      INSERT INTO saga_runs (saga_type, correlation_key, status, current_step, created_at, updated_at)
      VALUES (${PATH_A_SAGA_TYPE}, ${oppId}, 'AWAITING_DEPOSIT', 'awaiting_deposit_or_override', ${ninetyDaysAgo}, ${ninetyDaysAgo})
    `);

    // Verify it is untouched and waiting
    const oldSaga = await releaseStore.getSaga(oppId);
    expect(oldSaga?.status).toBe("AWAITING_DEPOSIT");

    // On day 91, deposit arrives
    const req = await releaseStore.requestRelease({
      oppId,
      source: "customer_deposit",
      requestedBy: "qbo",
      depositCents: 1200000,
      depositRef: "DAY-91-CHECK",
    });
    expect(req.outcome).toBe("recorded");

    // Claim succeeds identically
    const claim = await releaseStore.claimRelease(oppId);
    expect(claim.outcome).toBe("claimed");

    // Complete succeeds identically
    const comp = await releaseStore.markSagaCompleted(oppId);
    expect(comp.completed).toBe(true);

    const doneSaga = await releaseStore.getSaga(oppId);
    expect(doneSaga?.status).toBe("COMPLETED");
  });

  it("aggregation query returns all items of one opportunity in deterministic SKU order", async () => {
    const oppId = "opp-aggregation-test";
    const [job] = (
      await h.db.execute(sql`
        INSERT INTO custom_build_jobs (client_slug, display_name, ghl_opportunity_id, created_by)
        VALUES ('client-agg', 'Job Agg', ${oppId}, 'designer@ccpatio.com')
        RETURNING id
      `)
    ).rows as { id: string }[];

    const skus = ["JOB-CUSHION-Z", "JOB-FRAME-A", "JOB-TABLE-M"];
    for (const s of skus) {
      await h.db.execute(sql`INSERT INTO sku_mappings (global_sku) VALUES (${s})`);
      await itemStore.ensureItem({ jobId: job.id, globalSku: s });
    }

    const items = await itemStore.listItemsForOpportunity(oppId);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.global_sku)).toEqual([
      "JOB-CUSHION-Z",
      "JOB-FRAME-A",
      "JOB-TABLE-M",
    ].sort());
  });
});
