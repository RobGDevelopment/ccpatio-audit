import { randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import {
  logistics_settings,
  order_intake,
  quote_line_items,
  quote_revisions,
  quotes,
} from "@/server/db/schema";
import { amountDue, freezeQuote, revertQuoteToDraft } from "@/server/quotes/send-quote";

const opportunityId = `qa-send-${randomUUID()}`;

const actor = {
  ghlUserId: "qa-user",
  ghlUserName: "QA User",
  ghlUserEmail: "qa@ccpatio.com",
};

function syncOk() {
  return Promise.resolve({ ok: true as const });
}

async function insertDraft(patch?: {
  freightTotal?: string | null;
  promiseDate?: string | null;
  destZip?: string | null;
  depositPct?: string | null;
  withLine?: boolean;
  unitPrice?: string | null;
}) {
  const db = getDb();
  const [quote] = await db
    .insert(quotes)
    .values({
      ghl_opportunity_id: opportunityId,
      ghl_contact_id: "qa-contact",
      ghl_opportunity_name: "QA Opportunity",
      ghl_user_id: actor.ghlUserId,
      ghl_user_name: actor.ghlUserName,
      ghl_user_email: actor.ghlUserEmail,
      status: "draft",
      version: 1,
      dest_zip: patch && "destZip" in patch ? patch.destZip : "85260",
      distance_miles: "45.00",
      merchandise_total: "1000.00",
      freight_method: "LOCAL_WHITE_GLOVE",
      freight_total:
        patch && "freightTotal" in patch ? patch.freightTotal : "150.00",
      freight_snapshot: { method: "LOCAL_WHITE_GLOVE" },
      executed_by: "2026-10-02",
      promise_date:
        patch && "promiseDate" in patch ? patch.promiseDate : "2026-10-09",
      deposit_pct: patch && "depositPct" in patch ? patch.depositPct : "50.00",
    })
    .returning({ id: quotes.id });
  if (!quote) throw new Error("quote insert failed");
  if (patch?.withLine === false) return quote.id;
  await db.insert(quote_line_items).values({
    quote_id: quote.id,
    line_no: 1,
    line_kind: "configured",
    sku: "QA-SEND",
    katana_variant_id: randomInt(1, 2_000_000_000),
    qty: "2.0000",
    unit_price: patch && "unitPrice" in patch ? patch.unitPrice : "500.00",
    description: "QA chair",
  });
  return quote.id;
}

describe("deposit amount", () => {
  it("charges half of merchandise plus freight at 50 percent", () => {
    expect(amountDue("1000.00", "150.00", "50")).toBe("575.00");
    expect(amountDue("1000.00", "150.00", "50.00")).toBe("575.00");
    expect(amountDue("0.01", "0.00", "50")).toBe("0.01");
  });
});

describe("freeze and revert", () => {
  afterEach(async () => {
    const db = getDb();
    await db
      .delete(order_intake)
      .where(eq(order_intake.ghl_opportunity_id, opportunityId));
    await db
      .update(quotes)
      .set({ current_revision_id: null })
      .where(eq(quotes.ghl_opportunity_id, opportunityId));
    await db.delete(quotes).where(eq(quotes.ghl_opportunity_id, opportunityId));
    await closeDb();
  });

  it("freezes one revision, mirrors the failure, and reopens as draft", async () => {
    const quoteId = await insertDraft();
    const calls: number[] = [];
    const sent = await freezeQuote({
      quoteId,
      expectedVersion: 1,
      actor,
      syncOpportunityValue: async (_id, value) => {
        calls.push(value);
        return { ok: false, error: "token cannot write opportunities" };
      },
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.amountDue).toBe("575.00");
    expect(sent.opportunityValue).toBe("1150.00");
    expect(sent.ghlSyncError).toBe("token cannot write opportunities");
    expect(calls).toEqual([1150]);

    const db = getDb();
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
    expect(quote?.status).toBe("sent");
    expect(quote?.version).toBe(2);
    expect(quote?.current_revision_id).toBe(sent.revisionId);
    expect(quote?.ghl_sync_error).toBe("token cannot write opportunities");

    const revisions = await db
      .select()
      .from(quote_revisions)
      .where(eq(quote_revisions.quote_id, quoteId));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.revision_no).toBe(1);
    expect(revisions[0]?.amount_due).toBe("575.00");
    expect(revisions[0]?.deposit_pct).toBe("50.00");
    const payload = revisions[0]?.payload as {
      destZip?: string;
      distanceMiles?: string;
      freightMethod?: string;
      promiseDate?: string;
      actor?: { ghlUserName?: string };
      lines?: Array<{ sku?: string }>;
    };
    expect(payload.destZip).toBe("85260");
    expect(payload.distanceMiles).toBe("45.00");
    expect(payload.freightMethod).toBe("LOCAL_WHITE_GLOVE");
    expect(payload.promiseDate).toBe("2026-10-09");
    expect(payload.actor?.ghlUserName).toBe("QA User");
    expect(payload.lines?.[0]?.sku).toBe("QA-SEND");

    const again = await freezeQuote({
      quoteId,
      expectedVersion: 1,
      actor,
      syncOpportunityValue: async () => {
        throw new Error("should not sync twice");
      },
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.alreadySent).toBe(true);
    expect(again.revisionId).toBe(sent.revisionId);
    const stillOne = await db
      .select({ id: quote_revisions.id })
      .from(quote_revisions)
      .where(eq(quote_revisions.quote_id, quoteId));
    expect(stillOne).toHaveLength(1);
  });

  it("blocks send without a promise, ZIP, line, or when intake exists", async () => {
    const db = getDb();
    const noFreight = await insertDraft({ freightTotal: null });
    expect(
      await freezeQuote({
        quoteId: noFreight,
        expectedVersion: 1,
        actor,
        syncOpportunityValue: syncOk,
      }),
    ).toEqual({ ok: false, error: "freight_missing" });
    expect(
      await revertQuoteToDraft({ quoteId: noFreight, expectedVersion: 1 }),
    ).toEqual({ ok: false, error: "not_sent" });

    await db.delete(quotes).where(eq(quotes.id, noFreight));
    const noPromise = await insertDraft({ promiseDate: null });
    expect(
      await freezeQuote({
        quoteId: noPromise,
        expectedVersion: 1,
        actor,
        syncOpportunityValue: syncOk,
      }),
    ).toEqual({ ok: false, error: "promise_missing" });

    await db.delete(quotes).where(eq(quotes.id, noPromise));
    const badZip = await insertDraft({ destZip: "8526" });
    expect(
      await freezeQuote({
        quoteId: badZip,
        expectedVersion: 1,
        actor,
        syncOpportunityValue: syncOk,
      }),
    ).toEqual({ ok: false, error: "dest_zip_invalid" });

    await db.delete(quotes).where(eq(quotes.id, badZip));
    const empty = await insertDraft({ withLine: false });
    expect(
      await freezeQuote({
        quoteId: empty,
        expectedVersion: 1,
        actor,
        syncOpportunityValue: syncOk,
      }),
    ).toEqual({ ok: false, error: "no_lines" });

    await db.delete(quotes).where(eq(quotes.id, empty));
    const unpriced = await insertDraft({ unitPrice: null });
    expect(
      await freezeQuote({
        quoteId: unpriced,
        expectedVersion: 1,
        actor,
        syncOpportunityValue: syncOk,
      }),
    ).toEqual({ ok: false, error: "unpriced_line" });

    await db.delete(quotes).where(eq(quotes.id, unpriced));
    const ordered = await insertDraft();
    await db.insert(order_intake).values({
      ghl_opportunity_id: opportunityId,
      raw_payload: { source: "qa" },
    });
    expect(
      await freezeQuote({
        quoteId: ordered,
        expectedVersion: 1,
        actor,
        syncOpportunityValue: syncOk,
      }),
    ).toEqual({ ok: false, error: "opportunity_already_ordered" });
  });

  it("voids the revision on edit and numbers the next send", async () => {
    const quoteId = await insertDraft({ depositPct: null });
    const db = getDb();
    const [settings] = await db
      .select({ depositPct: logistics_settings.deposit_pct })
      .from(logistics_settings)
      .where(eq(logistics_settings.id, 1))
      .limit(1);
    const pct = settings?.depositPct ?? "50.00";

    const sent = await freezeQuote({
      quoteId,
      expectedVersion: 1,
      actor,
      syncOpportunityValue: syncOk,
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.amountDue).toBe(amountDue("1000.00", "150.00", pct));

    const stale = await revertQuoteToDraft({ quoteId, expectedVersion: 1 });
    expect(stale).toEqual({ ok: false, error: "stale_version" });

    const opened = await revertQuoteToDraft({ quoteId, expectedVersion: sent.version });
    expect(opened).toEqual({ ok: true, version: sent.version + 1, status: "draft" });

    const [voided] = await db
      .select()
      .from(quote_revisions)
      .where(eq(quote_revisions.id, sent.revisionId));
    expect(voided?.voided_at).toBeInstanceOf(Date);

    const [draft] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
    expect(draft?.status).toBe("draft");
    expect(draft?.current_revision_id).toBeNull();

    const resent = await freezeQuote({
      quoteId,
      expectedVersion: opened.ok ? opened.version : 0,
      actor,
      syncOpportunityValue: syncOk,
    });
    expect(resent.ok).toBe(true);
    if (!resent.ok) return;
    const rows = await db
      .select({ revisionNo: quote_revisions.revision_no, voidedAt: quote_revisions.voided_at })
      .from(quote_revisions)
      .where(eq(quote_revisions.quote_id, quoteId));
    expect(rows.map((row) => row.revisionNo).sort()).toEqual([1, 2]);
    expect(rows.filter((row) => row.voidedAt == null)).toHaveLength(1);
  });
});
