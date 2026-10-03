import { randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { advisoryLockOrder, withAdvisoryLock, withAdvisoryLocks } from "@/server/db/advisory-lock";
import { closeDb, getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  inventory_holds,
  quote_line_items,
  quotes,
  sku_mappings,
} from "@/server/db/schema";
import { FABRIC_HOLD_ORDER_ID, FABRIC_HOLD_ORDER_NO } from "@/server/ghl/hold-order";
import { searchFinishedGoods } from "@/server/quotes/catalog-search";
import { createDraftFromResolved, loadQuoteDocument } from "@/server/quotes/draft";
import {
  isLegacyFabricHold,
  removeHeldQuoteLine,
  swapHeldQuoteLine,
  type QuoteHoldPorts,
} from "@/server/quotes/hold-lines";

const opportunityId = `qa-swap-${randomUUID()}`;
const pricedSku = `QA-SWAP-OLD-${randomUUID().slice(0, 8).toUpperCase()}`;
const nextSku = `QA-SWAP-NEW-${randomUUID().slice(0, 8).toUpperCase()}`;

function uniqueViolation(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return text.includes("23505") || text.toLowerCase().includes("duplicate");
}

function holdValues(input: { sku: string; variantId?: number; id?: string }) {
  const id = input.id ?? randomUUID();
  return {
    id,
    katana_variant_id: input.variantId ?? randomInt(1, 2_000_000_000),
    sku: input.sku,
    qty: "1.0000",
    ghl_user_id: "qa-user",
    ghl_user_name: "QA User",
    ghl_user_email: "qa@ccpatio.com",
    ghl_contact_id: "qa-contact",
    ghl_opportunity_id: opportunityId,
    ghl_opportunity_name: "QA Opportunity",
    note: "QA hold",
    status: "active" as const,
    katana_dummy_so_id: randomInt(1, 2_000_000_000),
    order_no: `HOLD-QA-${id.slice(0, 8)}`,
  };
}

async function seedDraft() {
  const db = getDb();
  const oldVariantId = randomInt(1, 2_000_000_000);
  const newVariantId = randomInt(1, 2_000_000_000);
  await db.insert(sku_mappings).values([
    {
      global_sku: pricedSku,
      category: "seating",
      item_type: "finished_good",
      original_name: "QA club chair",
      source_file: "order-desk-hold-swap.test",
      katana_variant_id: oldVariantId,
    },
    {
      global_sku: nextSku,
      category: "seating",
      item_type: "finished_good",
      original_name: "QA sofa",
      source_file: "order-desk-hold-swap.test",
      katana_variant_id: newVariantId,
    },
  ]);
  await db.insert(finished_goods_catalog).values([
    {
      global_sku: pricedSku,
      msrp: "$1,250.00",
      description: "Club chair",
    },
    {
      global_sku: nextSku,
      msrp: "$80.00",
      description: "Sofa",
    },
  ]);
  const hold = holdValues({ sku: pricedSku, variantId: oldVariantId });
  await db.insert(inventory_holds).values(hold);
  const created = await createDraftFromResolved({
    actor: {
      ghlUserId: "qa-user",
      ghlUserName: "QA User",
      ghlUserEmail: "qa@ccpatio.com",
    },
    opportunity: {
      id: opportunityId,
      name: "QA Opportunity",
      contactId: "qa-contact",
    },
    destZip: "85260",
  });
  const line = created.lines[0];
  if (!line?.holdId) throw new Error("Draft did not copy the hold.");
  return {
    quoteId: created.quoteId,
    version: created.version,
    lineId: line.id,
    holdId: line.holdId,
    variantId: oldVariantId,
    newVariantId,
  };
}

describe("advisory lock order", () => {
  it("sorts variant ids ascending and drops duplicates", () => {
    expect(advisoryLockOrder([30, 2, 30, 9])).toEqual([2, 9, 30]);
  });

  it("reenters a held variant on the same connection", async () => {
    const low = randomInt(1, 1_000_000_000);
    const high = low + 1;
    const value = await withAdvisoryLocks([high, low], () =>
      withAdvisoryLock(high, async () => "held"),
    );
    expect(value).toBe("held");
  });
});

describe("order desk hold swap", () => {
  afterEach(async () => {
    const db = getDb();
    await db.delete(quotes).where(eq(quotes.ghl_opportunity_id, opportunityId));
    await db.delete(inventory_holds).where(eq(inventory_holds.ghl_opportunity_id, opportunityId));
    await db.delete(finished_goods_catalog).where(eq(finished_goods_catalog.global_sku, pricedSku));
    await db.delete(finished_goods_catalog).where(eq(finished_goods_catalog.global_sku, nextSku));
    await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, pricedSku));
    await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, nextSku));
    await closeDb();
  });

  it("finds the replacement in the catalog without calling Katana", async () => {
    await seedDraft();
    const products = await searchFinishedGoods(nextSku);
    expect(products.map((product) => product.sku)).toContain(nextSku);
    expect(products.find((product) => product.sku === nextSku)?.unitPrice).toBe("80.00");
  });

  it("releases the old hold, snapshots MSRP, and leaves the new hold", async () => {
    const seeded = await seedDraft();
    const db = getDb();
    const released: string[] = [];
    const created: string[] = [];
    const newVariantId = randomInt(1, 2_000_000_000);
    const ports: QuoteHoldPorts = {
      createHold: async (input) => {
        created.push(input.sku);
        expect(input.opportunityId).toBe(opportunityId);
        expect(input.qty).toBe(2);
        expect(input.variantId).toBe(newVariantId);
        const row = holdValues({ sku: input.sku, variantId: input.variantId });
        await db.insert(inventory_holds).values({ ...row, qty: input.qty.toFixed(4) });
        return { ok: true, holdId: row.id };
      },
      releaseHold: async (holdId) => {
        released.push(holdId);
        await db
          .update(inventory_holds)
          .set({ status: "released", release_reason: "manual", updated_at: new Date() })
          .where(eq(inventory_holds.id, holdId));
        return { ok: true };
      },
    };

    const result = await swapHeldQuoteLine(
      {
        quoteId: seeded.quoteId,
        lineId: seeded.lineId,
        newSku: nextSku,
        newVariantId,
        newQty: 2,
        expectedVersion: seeded.version,
      },
      ports,
    );

    expect(result.ok).toBe(true);
    expect(created).toEqual([nextSku]);
    expect(released).toEqual([seeded.holdId]);
    const doc = await loadQuoteDocument(opportunityId);
    expect(doc?.version).toBe(seeded.version + 1);
    expect(doc?.lines).toHaveLength(1);
    expect(doc?.lines[0]?.sku).toBe(nextSku);
    expect(doc?.lines[0]?.unitPrice).toBe("80.00");
    expect(doc?.lines[0]?.description).toBe("Sofa");
    expect(doc?.lines[0]?.qty).toBe("2.0000");
    expect(doc?.merchandiseTotal).toBe("160.00");
    expect(doc?.suggestions).toHaveLength(0);
    const [oldHold] = await db
      .select({ status: inventory_holds.status })
      .from(inventory_holds)
      .where(eq(inventory_holds.id, seeded.holdId));
    expect(oldHold?.status).toBe("released");
    const newHoldId = doc?.lines[0]?.holdId;
    expect(newHoldId).toBeTruthy();
    expect(newHoldId).not.toBe(seeded.holdId);
    const [newHold] = await db
      .select({ status: inventory_holds.status })
      .from(inventory_holds)
      .where(eq(inventory_holds.id, newHoldId!));
    expect(newHold?.status).toBe("active");
  });

  it("leaves the old line when the new hold cannot be created", async () => {
    const seeded = await seedDraft();
    const released: string[] = [];
    const ports: QuoteHoldPorts = {
      createHold: async () => ({
        ok: false,
        error: "Only 0 available at CC Manufacturing. 1 was requested.",
      }),
      releaseHold: async (holdId) => {
        released.push(holdId);
        return { ok: true };
      },
    };

    const result = await swapHeldQuoteLine(
      {
        quoteId: seeded.quoteId,
        lineId: seeded.lineId,
        newSku: nextSku,
        newVariantId: randomInt(1, 2_000_000_000),
        newQty: 1,
        expectedVersion: seeded.version,
      },
      ports,
    );

    expect(result).toEqual({
      ok: false,
      error: "Only 0 available at CC Manufacturing. 1 was requested.",
    });
    expect(released).toEqual([]);
    const doc = await loadQuoteDocument(opportunityId);
    expect(doc?.version).toBe(seeded.version);
    expect(doc?.lines[0]?.sku).toBe(pricedSku);
    expect(doc?.lines[0]?.holdId).toBe(seeded.holdId);
    const db = getDb();
    const [oldHold] = await db
      .select({ status: inventory_holds.status })
      .from(inventory_holds)
      .where(eq(inventory_holds.id, seeded.holdId));
    expect(oldHold?.status).toBe("active");
  });

  it("keeps the new hold and returns previous_hold_still_active when release fails", async () => {
    const seeded = await seedDraft();
    const db = getDb();
    const released: string[] = [];
    let newHoldId = "";
    const ports: QuoteHoldPorts = {
      createHold: async (input) => {
        const row = holdValues({ sku: input.sku, variantId: input.variantId });
        newHoldId = row.id;
        await db.insert(inventory_holds).values(row);
        return { ok: true, holdId: row.id };
      },
      releaseHold: async (holdId) => {
        released.push(holdId);
        return { ok: false, error: "Katana did not release that hold." };
      },
    };

    const result = await swapHeldQuoteLine(
      {
        quoteId: seeded.quoteId,
        lineId: seeded.lineId,
        newSku: nextSku,
        newVariantId: randomInt(1, 2_000_000_000),
        newQty: 1,
        expectedVersion: seeded.version,
      },
      ports,
    );

    expect(result).toMatchObject({
      ok: false,
      error: "previous_hold_still_active",
      previousHoldId: seeded.holdId,
    });
    expect(released).toEqual([seeded.holdId]);
    expect(released).not.toContain(newHoldId);
    const doc = await loadQuoteDocument(opportunityId);
    expect(doc?.lines[0]?.holdId).toBe(newHoldId);
    expect(doc?.lines[0]?.sku).toBe(nextSku);
    expect(doc?.suggestions.map((row) => row.holdId)).toEqual([seeded.holdId]);
    const [oldHold] = await db
      .select({ status: inventory_holds.status })
      .from(inventory_holds)
      .where(eq(inventory_holds.id, seeded.holdId));
    expect(oldHold?.status).toBe("active");
  });

  it("does not create a hold when the version is stale or the old hold is not active", async () => {
    const seeded = await seedDraft();
    const db = getDb();
    let created = 0;
    const ports: QuoteHoldPorts = {
      createHold: async () => {
        created += 1;
        return { ok: false, error: "should not run" };
      },
      releaseHold: async () => ({ ok: true }),
    };

    const stale = await swapHeldQuoteLine(
      {
        quoteId: seeded.quoteId,
        lineId: seeded.lineId,
        newSku: nextSku,
        newVariantId: 10,
        newQty: 1,
        expectedVersion: seeded.version + 4,
      },
      ports,
    );
    expect(stale).toEqual({ ok: false, error: "stale_version" });

    await db
      .update(inventory_holds)
      .set({ status: "converted", updated_at: new Date() })
      .where(eq(inventory_holds.id, seeded.holdId));
    const converted = await swapHeldQuoteLine(
      {
        quoteId: seeded.quoteId,
        lineId: seeded.lineId,
        newSku: nextSku,
        newVariantId: 10,
        newQty: 1,
        expectedVersion: seeded.version,
      },
      ports,
    );
    expect(converted).toEqual({ ok: false, error: "converted" });
    expect(created).toBe(0);
    const doc = await loadQuoteDocument(opportunityId);
    expect(doc?.lines[0]?.sku).toBe(pricedSku);
  });

  it("releases only an unattached new hold when the line cannot be updated", async () => {
    const seeded = await seedDraft();
    const db = getDb();
    const released: string[] = [];
    let newHoldId = "";
    const ports: QuoteHoldPorts = {
      createHold: async (input) => {
        const row = holdValues({ sku: input.sku, variantId: input.variantId });
        newHoldId = row.id;
        await db.insert(inventory_holds).values(row);
        await db
          .update(quote_line_items)
          .set({ inventory_hold_id: null, updated_at: new Date() })
          .where(eq(quote_line_items.id, seeded.lineId));
        return { ok: true, holdId: row.id };
      },
      releaseHold: async (holdId) => {
        released.push(holdId);
        await db
          .update(inventory_holds)
          .set({ status: "released", release_reason: "manual", updated_at: new Date() })
          .where(eq(inventory_holds.id, holdId));
        return { ok: true };
      },
    };

    const result = await swapHeldQuoteLine(
      {
        quoteId: seeded.quoteId,
        lineId: seeded.lineId,
        newSku: nextSku,
        newVariantId: randomInt(1, 2_000_000_000),
        newQty: 1,
        expectedVersion: seeded.version,
      },
      ports,
    );

    expect(result).toEqual({ ok: false, error: "line_changed" });
    expect(released).toEqual([newHoldId]);
    const [oldHold] = await db
      .select({ status: inventory_holds.status })
      .from(inventory_holds)
      .where(eq(inventory_holds.id, seeded.holdId));
    expect(oldHold?.status).toBe("active");
  });

  it("deletes the line only after the hold release succeeds", async () => {
    const seeded = await seedDraft();
    const db = getDb();
    const released: string[] = [];
    const ports: QuoteHoldPorts = {
      createHold: async () => ({ ok: false, error: "unused" }),
      releaseHold: async (holdId) => {
        released.push(holdId);
        await db
          .update(inventory_holds)
          .set({ status: "released", release_reason: "manual", updated_at: new Date() })
          .where(eq(inventory_holds.id, holdId));
        return { ok: true };
      },
    };

    const result = await removeHeldQuoteLine(
      { quoteId: seeded.quoteId, lineId: seeded.lineId, expectedVersion: seeded.version },
      ports,
    );
    expect(result).toEqual({ ok: true, version: seeded.version + 1 });
    expect(released).toEqual([seeded.holdId]);
    const doc = await loadQuoteDocument(opportunityId);
    expect(doc?.lines).toHaveLength(0);
    expect(doc?.merchandiseTotal).toBeNull();
  });

  it("leaves the line in place when release fails", async () => {
    const seeded = await seedDraft();
    const ports: QuoteHoldPorts = {
      createHold: async () => ({ ok: false, error: "unused" }),
      releaseHold: async () => ({ ok: false, error: "Katana did not release that hold." }),
    };
    const result = await removeHeldQuoteLine(
      { quoteId: seeded.quoteId, lineId: seeded.lineId, expectedVersion: seeded.version },
      ports,
    );
    expect(result).toEqual({ ok: false, error: "Katana did not release that hold." });
    const doc = await loadQuoteDocument(opportunityId);
    expect(doc?.version).toBe(seeded.version);
    expect(doc?.lines.map((line) => line.holdId)).toEqual([seeded.holdId]);
  });

  it("does not release a hold when the quote version is stale", async () => {
    const seeded = await seedDraft();
    let released = 0;
    const ports: QuoteHoldPorts = {
      createHold: async () => ({ ok: false, error: "unused" }),
      releaseHold: async () => {
        released += 1;
        return { ok: true };
      },
    };
    const result = await removeHeldQuoteLine(
      {
        quoteId: seeded.quoteId,
        lineId: seeded.lineId,
        expectedVersion: seeded.version + 3,
      },
      ports,
    );
    expect(result).toEqual({ ok: false, error: "stale_version" });
    expect(released).toBe(0);
  });

  it("removes a line that has no hold without calling release", async () => {
    const db = getDb();
    const created = await createDraftFromResolved({
      actor: {
        ghlUserId: "qa-user",
        ghlUserName: "QA User",
        ghlUserEmail: "qa@ccpatio.com",
      },
      opportunity: {
        id: opportunityId,
        name: "QA Opportunity",
        contactId: "qa-contact",
      },
      destZip: null,
    });
    const [line] = await db
      .insert(quote_line_items)
      .values({
        quote_id: created.quoteId,
        line_no: 1,
        line_kind: "configured",
        sku: "QA-CONFIG",
        katana_variant_id: randomInt(1, 2_000_000_000),
        qty: "1.0000",
        unit_price: "10.00",
        description: "Build",
      })
      .returning({ id: quote_line_items.id });
    let released = 0;
    const result = await removeHeldQuoteLine(
      {
        quoteId: created.quoteId,
        lineId: line!.id,
        expectedVersion: created.version,
      },
      {
        createHold: async () => ({ ok: false, error: "unused" }),
        releaseHold: async () => {
          released += 1;
          return { ok: true };
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(released).toBe(0);
    const doc = await loadQuoteDocument(opportunityId);
    expect(doc?.lines).toHaveLength(0);
  });

  it("refuses the legacy fabric freeze without calling release or create", async () => {
    expect(
      isLegacyFabricHold({
        orderNo: FABRIC_HOLD_ORDER_NO,
        katanaDummySoId: FABRIC_HOLD_ORDER_ID,
      }),
    ).toBe(true);

    const seeded = await seedDraft();
    const db = getDb();
    try {
      await db
        .update(inventory_holds)
        .set({ order_no: FABRIC_HOLD_ORDER_NO, updated_at: new Date() })
        .where(eq(inventory_holds.id, seeded.holdId));
    } catch (error: unknown) {
      expect(uniqueViolation(error)).toBe(true);
      return;
    }

    let called = 0;
    const ports: QuoteHoldPorts = {
      createHold: async () => {
        called += 1;
        return { ok: false, error: "should not run" };
      },
      releaseHold: async () => {
        called += 1;
        return { ok: true };
      },
    };
    const removed = await removeHeldQuoteLine(
      { quoteId: seeded.quoteId, lineId: seeded.lineId, expectedVersion: seeded.version },
      ports,
    );
    const swapped = await swapHeldQuoteLine(
      {
        quoteId: seeded.quoteId,
        lineId: seeded.lineId,
        newSku: nextSku,
        newVariantId: 11,
        newQty: 1,
        expectedVersion: seeded.version,
      },
      ports,
    );
    expect(removed.ok).toBe(false);
    expect(swapped.ok).toBe(false);
    if (!removed.ok) expect(removed.error).toMatch(/legacy fabric freeze/);
    if (!swapped.ok) expect(swapped.error).toMatch(/legacy fabric freeze/);
    expect(called).toBe(0);
    const [hold] = await db
      .select({ status: inventory_holds.status })
      .from(inventory_holds)
      .where(eq(inventory_holds.id, seeded.holdId));
    expect(hold?.status).toBe("active");
  });
});
