import { randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  inventory_holds,
  quotes,
  sku_mappings,
} from "@/server/db/schema";
import {
  createDraftFromResolved,
  loadQuoteDocument,
  saveDraftVersion,
  voidOpenQuotesForOpportunity,
} from "@/server/quotes/draft";
import { merchandiseTotal, snapshotMsrp } from "@/server/quotes/msrp";

const opportunityId = `qa-od-${randomUUID()}`;
const pricedSku = `QA-OD-PRICED-${randomUUID().slice(0, 8).toUpperCase()}`;
const missingSku = `QA-OD-MISSING-${randomUUID().slice(0, 8).toUpperCase()}`;
const releasedSku = `QA-OD-RELEASED-${randomUUID().slice(0, 8).toUpperCase()}`;
const laterSku = `QA-OD-LATER-${randomUUID().slice(0, 8).toUpperCase()}`;

function holdValues(input: {
  sku: string;
  status?: "active" | "released";
}) {
  const id = randomUUID();
  return {
    id,
    katana_variant_id: randomInt(1, 2_000_000_000),
    sku: input.sku,
    qty: "1.0000",
    ghl_user_id: "qa-user",
    ghl_user_name: "QA User",
    ghl_user_email: "qa@ccpatio.com",
    ghl_contact_id: "qa-contact",
    ghl_opportunity_id: opportunityId,
    ghl_opportunity_name: "QA Opportunity",
    note: "QA hold",
    status: input.status ?? "active",
    release_reason: input.status === "released" ? ("manual" as const) : null,
    katana_dummy_so_id: randomInt(1, 2_000_000_000),
    order_no: `HOLD-QA-${id.slice(0, 8)}`,
  };
}

describe("order desk MSRP snapshot", () => {
  it("parses currency text and rejects blanks", () => {
    expect(snapshotMsrp("$1,250.50")).toEqual({
      unitPrice: "1250.50",
      priceError: null,
    });
    expect(snapshotMsrp("0")).toEqual({ unitPrice: "0.00", priceError: null });
    expect(snapshotMsrp("n/a").unitPrice).toBeNull();
    expect(snapshotMsrp(null).priceError).toBe("MSRP is missing or not a number.");
    expect(
      merchandiseTotal([
        { unitPrice: "10.00", qty: "2" },
        { unitPrice: null, qty: "1" },
      ]),
    ).toBeNull();
    expect(
      merchandiseTotal([
        { unitPrice: "10.00", qty: "2" },
        { unitPrice: "1.50", qty: "1" },
      ]),
    ).toBe("21.50");
  });
});

describe("order desk draft ledger", () => {
  afterEach(async () => {
    const db = getDb();
    await db.delete(quotes).where(eq(quotes.ghl_opportunity_id, opportunityId));
    await db
      .delete(inventory_holds)
      .where(eq(inventory_holds.ghl_opportunity_id, opportunityId));
    await db
      .delete(finished_goods_catalog)
      .where(eq(finished_goods_catalog.global_sku, pricedSku));
    await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, pricedSku));
    await closeDb();
  });

  it("copies active holds, snapshots MSRP, and rejects a stale save", async () => {
    const db = getDb();
    await db.insert(sku_mappings).values({
      global_sku: pricedSku,
      category: "seating",
      item_type: "finished_good",
      original_name: "QA club chair",
      source_file: "order-desk-quote.test",
    });
    await db.insert(finished_goods_catalog).values({
      global_sku: pricedSku,
      msrp: "$1,250.00",
      description: "Club chair",
    });
    await db.insert(inventory_holds).values([
      holdValues({ sku: pricedSku }),
      holdValues({ sku: missingSku }),
      holdValues({ sku: releasedSku, status: "released" }),
    ]);

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

    expect(created.status).toBe("draft");
    expect(created.lines).toHaveLength(2);
    expect(created.lines.map((line) => line.sku).sort()).toEqual(
      [missingSku, pricedSku].sort(),
    );
    const priced = created.lines.find((line) => line.sku === pricedSku);
    const missing = created.lines.find((line) => line.sku === missingSku);
    expect(priced?.unitPrice).toBe("1250.00");
    expect(priced?.description).toBe("Club chair");
    expect(priced?.holdId).toBeTruthy();
    expect(missing?.unitPrice).toBeNull();
    expect(missing?.priceError).toBe("MSRP is missing or not a number.");
    expect(created.merchandiseTotal).toBeNull();
    expect(created.suggestions).toHaveLength(0);
    expect(created.lines.some((line) => line.sku === releasedSku)).toBe(false);

    await db.insert(inventory_holds).values(holdValues({ sku: laterSku }));
    const reloaded = await loadQuoteDocument(opportunityId);
    expect(reloaded?.lines).toHaveLength(2);
    expect(reloaded?.suggestions.map((row) => row.sku)).toEqual([laterSku]);

    const saved = await saveDraftVersion({
      quoteId: created.quoteId,
      version: created.version,
      patch: {
        ghlOpportunityName: "QA Opportunity renamed",
        ghlContactId: "qa-contact",
        destZip: "85260",
      },
    });
    expect(saved).toEqual({ ok: true, version: created.version + 1 });

    const stale = await saveDraftVersion({
      quoteId: created.quoteId,
      version: created.version,
      patch: {
        ghlOpportunityName: "Should not land",
        ghlContactId: "qa-contact",
        destZip: "85251",
      },
    });
    expect(stale).toEqual({ ok: false, error: "stale_version" });

    const [row] = await db
      .select({
        name: quotes.ghl_opportunity_name,
        zip: quotes.dest_zip,
        version: quotes.version,
      })
      .from(quotes)
      .where(eq(quotes.id, created.quoteId));
    expect(row?.name).toBe("QA Opportunity renamed");
    expect(row?.zip).toBe("85260");
    expect(row?.version).toBe(created.version + 1);

    const closed = await voidOpenQuotesForOpportunity(opportunityId, "lost");
    expect(closed.voided).toBe(1);
    const after = await loadQuoteDocument(opportunityId);
    expect(after).toBeNull();
    const voided = await loadQuoteDocument(opportunityId, true);
    expect(voided?.status).toBe("void");
    expect(voided?.voidReason).toBe("lost");
    expect(voided?.readOnly).toBe(true);
  });
});
