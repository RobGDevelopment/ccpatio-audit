/**
 * applyHygienePatch against REAL Postgres through Drizzle. No database mock anywhere in this file.
 *
 * Every row this suite writes carries a per-run random SKU (`FIN-QA-HYG-<hex>`) and is deleted in
 * `afterAll`, so nothing else in the hub is read, changed or removed. The suite refuses to run
 * without POSTGRES_URL and prints the host (never the password) it is about to write to.
 *
 * Run (listed first in the dotenv chain, per tests/setup-env.ts):
 *   npm run qa:phase0-hygiene-live
 */
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { finished_goods_catalog, pim_audit_log, sku_mappings } from "@/server/db/schema";
import {
  HYGIENE_AUDIT_ACTION,
  applyHygienePatch,
  evaluateHygiene,
  loadHygieneRows,
} from "@/server/mission-control/hygiene";

const RUN = randomBytes(4).toString("hex").toUpperCase();
const sku = (suffix: string) => `FIN-QA-HYG-${RUN}-${suffix}`;

const SKU = {
  main: sku("MAIN"),
  race: sku("RACE"),
  racePresent: sku("RACEP"),
  foreign: sku("FOREIGN"),
  rejects: sku("REJECT"),
  raw: `RM-QA-HYG-${RUN}`,
  absent: sku("ABSENT"),
};
const OWNED = [SKU.main, SKU.race, SKU.racePresent, SKU.foreign, SKU.rejects, SKU.raw];

const actor = { email: `qa-hygiene-${RUN.toLowerCase()}@ccpatio.test`, label: "QA hygiene live suite" };

function hostOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${decodeURIComponent(parsed.username)}@${parsed.host}`;
  } catch (error) {
    return `unparseable (${error instanceof Error ? error.name : typeof error})`;
  }
}

async function auditRows(forSku: string) {
  return getDb()
    .select()
    .from(pim_audit_log)
    .where(and(eq(pim_audit_log.global_sku, forSku), eq(pim_audit_log.action, HYGIENE_AUDIT_ACTION)))
    .orderBy(asc(pim_audit_log.field));
}

async function catalogRow(forSku: string) {
  const [row] = await getDb()
    .select()
    .from(finished_goods_catalog)
    .where(eq(finished_goods_catalog.global_sku, forSku))
    .limit(1);
  return row;
}

async function cleanup() {
  const db = getDb();
  await db.delete(pim_audit_log).where(inArray(pim_audit_log.global_sku, OWNED));
  await db.delete(finished_goods_catalog).where(inArray(finished_goods_catalog.global_sku, OWNED));
  await db.delete(sku_mappings).where(inArray(sku_mappings.global_sku, OWNED));
}

beforeAll(async () => {
  // Same pooler rule the Playwright seed helper uses: the transaction pooler avoids "max clients reached".
  const tx = process.env.POSTGRES_URL_TX?.trim();
  if (tx) process.env.POSTGRES_URL = tx;
  const url = process.env.POSTGRES_URL?.trim();
  if (!url) throw new Error("POSTGRES_URL is not set: the live hygiene suite cannot run.");
  console.info(`[hygiene-live] writing namespaced rows (${RUN}) to ${hostOf(url)}`);

  await cleanup();
  await getDb()
    .insert(sku_mappings)
    .values(
      [SKU.main, SKU.race, SKU.racePresent, SKU.foreign, SKU.rejects].map((global_sku) => ({
        global_sku,
        category: "QA",
        item_type: "finished_good" as const,
        original_name: `QA hygiene ${global_sku}`,
        source_file: "qa-hygiene-live",
        is_active: true,
      })),
    );
  await getDb()
    .insert(sku_mappings)
    .values({
      global_sku: SKU.raw,
      category: "QA",
      item_type: "raw_material" as const,
      original_name: "QA hygiene raw material",
      source_file: "qa-hygiene-live",
      is_active: true,
    });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await closeDb();
  }
});

describe("applyHygienePatch on live Postgres", () => {
  it("refuses an invalid payload without touching the database", async () => {
    const result = await applyHygienePatch({ sku: "" }, actor);
    expect(result.ok).toBe(false);
    expect(await auditRows("")).toHaveLength(0);
  });

  it("reports an unknown SKU and refuses a raw material, writing nothing", async () => {
    expect(await applyHygienePatch({ sku: SKU.absent, msrp: "10" }, actor)).toEqual({
      ok: false,
      error: "That product could not be found.",
    });
    expect(await applyHygienePatch({ sku: SKU.raw, msrp: "10" }, actor)).toEqual({
      ok: false,
      error: "That product could not be found.",
    });
    expect(await catalogRow(SKU.absent)).toBeUndefined();
    expect(await catalogRow(SKU.raw)).toBeUndefined();
    expect(await auditRows(SKU.absent)).toHaveLength(0);
    expect(await auditRows(SKU.raw)).toHaveLength(0);
  });

  it("the radar flags a bare product, and the patch inserts the catalog row with one audit row per field", async () => {
    const before = (await loadHygieneRows()).find((row) => row.sku === SKU.main);
    expect(before, "seeded product must appear in the radar scan").toBeDefined();
    expect(before!.hasCatalogRow).toBe(false);
    expect(evaluateHygiene(before!)?.issues).toEqual([
      "missing_msrp",
      "blank_dimensions",
      "missing_3d_asset",
    ]);

    // lowercase SKU on purpose: the transaction upper-cases it before the lookup.
    const result = await applyHygienePatch(
      { sku: SKU.main.toLowerCase(), msrp: "$1,299", length: "84", depth: '36"', height: "32", notApplicable: [] },
      actor,
    );
    expect(result).toEqual({ ok: true, changed: true, fields: ["msrp", "length", "depth", "height"] });

    const row = await catalogRow(SKU.main);
    expect(row).toMatchObject({
      global_sku: SKU.main,
      msrp: "1299.00",
      length: "84",
      depth: "36",
      height: "32",
      na_fields: [],
      updated_by: actor.email,
    });

    const audit = await auditRows(SKU.main);
    expect(audit).toHaveLength(4);
    expect(audit.map((entry) => [entry.field, entry.old_value, entry.new_value])).toEqual([
      ["depth", null, "36"],
      ["height", null, "32"],
      ["length", null, "84"],
      ["msrp", null, "1299.00"],
    ]);
    for (const entry of audit) {
      expect(entry).toMatchObject({
        operator_email: actor.email,
        operator_name: actor.label,
        action: HYGIENE_AUDIT_ACTION,
      });
    }

    const after = (await loadHygieneRows()).find((r) => r.sku === SKU.main);
    expect(evaluateHygiene(after!)?.issues).toEqual(["missing_3d_asset"]);
  });

  it("is idempotent: the same patch again changes nothing and writes no audit noise", async () => {
    const rowBefore = await catalogRow(SKU.main);
    const auditBefore = await auditRows(SKU.main);

    const again = await applyHygienePatch(
      { sku: SKU.main, msrp: "1299", length: "84.0", depth: "36", height: "32", notApplicable: [] },
      actor,
    );

    expect(again).toEqual({ ok: true, changed: false, fields: [] });
    const rowAfter = await catalogRow(SKU.main);
    expect(rowAfter!.updated_at.getTime()).toBe(rowBefore!.updated_at.getTime());
    expect(await auditRows(SKU.main)).toHaveLength(auditBefore.length);
  });

  it("a real change records the old and the new value", async () => {
    const result = await applyHygienePatch({ sku: SKU.main, msrp: "1500.5" }, actor);
    expect(result).toEqual({ ok: true, changed: true, fields: ["msrp"] });

    expect((await catalogRow(SKU.main))!.msrp).toBe("1500.50");
    const msrp = (await auditRows(SKU.main)).filter((entry) => entry.field === "msrp");
    expect(msrp).toHaveLength(2);
    expect(msrp.map((entry) => JSON.stringify([entry.old_value, entry.new_value])).sort()).toEqual(
      [JSON.stringify([null, "1299.00"]), JSON.stringify(["1299.00", "1500.50"])].sort(),
    );
  });

  it("marks a dimension Not Applicable and un-marks it, auditing the na_fields change each way", async () => {
    const mark = await applyHygienePatch({ sku: SKU.main, notApplicable: ["height"] }, actor);
    expect(mark).toEqual({ ok: true, changed: true, fields: ["na_fields"] });
    expect((await catalogRow(SKU.main))!.na_fields).toEqual(["height"]);

    const repeat = await applyHygienePatch({ sku: SKU.main, notApplicable: ["height"] }, actor);
    expect(repeat).toEqual({ ok: true, changed: false, fields: [] });

    const unmark = await applyHygienePatch({ sku: SKU.main, notApplicable: [] }, actor);
    expect(unmark).toEqual({ ok: true, changed: true, fields: ["na_fields"] });
    expect((await catalogRow(SKU.main))!.na_fields).toEqual([]);

    const na = (await auditRows(SKU.main)).filter((entry) => entry.field === "na_fields");
    expect(na.map((entry) => JSON.stringify([entry.old_value, entry.new_value])).sort()).toEqual(
      [JSON.stringify([null, "height"]), JSON.stringify(["height", null])].sort(),
    );
  });

  it("only owns the three dimension keys of na_fields and preserves the rest", async () => {
    await getDb()
      .insert(finished_goods_catalog)
      .values({ global_sku: SKU.foreign, msrp: "100.00", na_fields: ["image", "arm_height"] });

    const result = await applyHygienePatch({ sku: SKU.foreign, notApplicable: ["length"] }, actor);
    expect(result).toEqual({ ok: true, changed: true, fields: ["na_fields"] });
    expect([...(await catalogRow(SKU.foreign))!.na_fields].sort()).toEqual(["arm_height", "image", "length"]);

    await applyHygienePatch({ sku: SKU.foreign, notApplicable: [] }, actor);
    expect([...(await catalogRow(SKU.foreign))!.na_fields].sort()).toEqual(["arm_height", "image"]);
  });

  it("a rejected patch (value plus N/A, bad MSRP, bad dimension) leaves the row and the audit trail untouched", async () => {
    const rowBefore = await catalogRow(SKU.main);
    const auditBefore = (await auditRows(SKU.main)).length;

    for (const patch of [
      { sku: SKU.main, depth: "40", notApplicable: ["depth"] as const },
      { sku: SKU.main, msrp: "free" },
      { sku: SKU.main, height: "tall" },
      { sku: SKU.main, msrp: "0" },
      // A valid field next to an invalid one: the whole transaction must refuse, not half apply.
      { sku: SKU.main, msrp: "9999", length: "wide" },
    ]) {
      const result = await applyHygienePatch(patch, actor);
      expect(result.ok, JSON.stringify(patch)).toBe(false);
    }

    const rowAfter = await catalogRow(SKU.main);
    expect(rowAfter).toEqual(rowBefore);
    expect(await auditRows(SKU.main)).toHaveLength(auditBefore);
  });

  it("two simultaneous identical patches on an EXISTING row apply once", async () => {
    await getDb().insert(finished_goods_catalog).values({ global_sku: SKU.racePresent });
    const patch = { sku: SKU.racePresent, msrp: "800", length: "70", notApplicable: [] as never[] };

    const results = await Promise.all([
      applyHygienePatch(patch, actor),
      applyHygienePatch(patch, actor),
      applyHygienePatch(patch, actor),
    ]);

    expect(results.filter((r) => r.ok && r.changed)).toHaveLength(1);
    expect(results.filter((r) => r.ok && !r.changed)).toHaveLength(2);
    expect(await auditRows(SKU.racePresent)).toHaveLength(2);
  });

  it("two simultaneous identical patches on a product with NO catalog row yet apply once", async () => {
    const patch = { sku: SKU.race, msrp: "650", depth: "30" };

    const results = await Promise.all([
      applyHygienePatch(patch, actor),
      applyHygienePatch(patch, actor),
      applyHygienePatch(patch, actor),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && r.changed)).toHaveLength(1);
    expect(await auditRows(SKU.race)).toHaveLength(2);
    expect(await catalogRow(SKU.race)).toMatchObject({ msrp: "650.00", depth: "30" });
  });

  it("rejects unknown keys at the schema so a caller cannot smuggle a column in", async () => {
    const result = await applyHygienePatch({ sku: SKU.rejects, msrp: "10", updated_by: "mallory" }, actor);
    expect(result.ok).toBe(false);
    expect(await catalogRow(SKU.rejects)).toBeUndefined();
    expect(await auditRows(SKU.rejects)).toHaveLength(0);
  });
});
