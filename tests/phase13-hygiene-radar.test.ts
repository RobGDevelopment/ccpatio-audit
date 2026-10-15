import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Pure logic only. `applyHygienePatch` (the transaction, the audit rows, idempotency) is proven against
// real Postgres in tests/phase13-hygiene-patch-live.test.ts. There is no database mock in this file.
import {
  evaluateHygiene,
  hygienePatchSchema,
  normalizeDimension,
  normalizeMsrp,
  planHygienePatch,
  rankRadar,
  summarizeRadar,
  type CatalogSnapshot,
  type HygieneRow,
} from "@/server/mission-control/hygiene";

const clean: HygieneRow = {
  sku: "SKU-1",
  name: "Aria Sofa",
  hasCatalogRow: true,
  msrp: "1299.00",
  length: "84",
  depth: "36",
  height: "32",
  naFields: [],
  has3d: true,
};

describe("evaluateHygiene", () => {
  it("returns null for a quote-ready product", () => {
    expect(evaluateHygiene(clean)).toBeNull();
  });

  it("flags a missing, blank, zero or unparseable MSRP", () => {
    for (const msrp of [null, "", "  ", "0", "0.00", "TBD", "-5"]) {
      expect(evaluateHygiene({ ...clean, msrp })?.issues).toEqual(["missing_msrp"]);
    }
  });

  it("accepts a formatted price", () => {
    expect(evaluateHygiene({ ...clean, msrp: "$1,299.00" })).toBeNull();
  });

  it("flags blank dimensions but respects Not Applicable", () => {
    const item = evaluateHygiene({ ...clean, depth: "", height: null });
    expect(item?.issues).toEqual(["blank_dimensions"]);
    expect(item?.blankDimensions).toEqual(["depth", "height"]);
    expect(evaluateHygiene({ ...clean, depth: "", height: null, naFields: ["depth", "height"] })).toBeNull();
  });

  it("ignores N/A keys that are not dimensions", () => {
    const item = evaluateHygiene({ ...clean, length: "", naFields: ["msrp", "image"] });
    expect(item?.blankDimensions).toEqual(["length"]);
  });

  it("flags a missing 3D asset", () => {
    expect(evaluateHygiene({ ...clean, has3d: false })?.issues).toEqual(["missing_3d_asset"]);
  });

  it("flags price and dimensions when there is no catalog row at all", () => {
    const item = evaluateHygiene({
      ...clean,
      hasCatalogRow: false,
      msrp: null,
      length: null,
      depth: null,
      height: null,
    });
    expect(item?.issues).toEqual(["missing_msrp", "blank_dimensions"]);
    expect(item?.blankDimensions).toEqual(["length", "depth", "height"]);
  });

  it("ranks the worst product first and totals each issue", () => {
    const a = evaluateHygiene({ ...clean, sku: "A", has3d: false })!;
    const b = evaluateHygiene({ ...clean, sku: "B", msrp: null, has3d: false, length: "" })!;
    const c = evaluateHygiene({ ...clean, sku: "C", msrp: null })!;
    expect(rankRadar([a, c, b]).map((i) => i.sku)).toEqual(["B", "A", "C"]);
    expect(summarizeRadar([a, b, c])).toEqual({
      flagged: 3,
      missingMsrp: 2,
      blankDimensions: 1,
      missing3d: 2,
    });
  });
});

describe("normalisation", () => {
  it("normalises MSRP", () => {
    expect(normalizeMsrp("$1,299")).toEqual({ ok: true, value: "1299.00" });
    expect(normalizeMsrp("49.5")).toEqual({ ok: true, value: "49.50" });
    for (const bad of ["", "abc", "0", "-3", "1.234", "99999999"]) {
      expect(normalizeMsrp(bad).ok).toBe(false);
    }
  });

  it("normalises dimensions", () => {
    expect(normalizeDimension('84"')).toEqual({ ok: true, value: "84" });
    expect(normalizeDimension("36.50 in")).toEqual({ ok: true, value: "36.5" });
    for (const bad of ["", "wide", "0", "-1", "5000"]) {
      expect(normalizeDimension(bad).ok).toBe(false);
    }
  });
});

describe("planHygienePatch", () => {
  const stored: CatalogSnapshot = {
    msrp: "1299.00",
    length: "84",
    depth: null,
    height: "32",
    na_fields: ["image"],
  };
  const parse = (input: unknown) => hygienePatchSchema.parse(input);

  it("returns no changes when the request matches the stored row", () => {
    const plan = planHygienePatch(stored, parse({ sku: "S", msrp: "1299", length: "84.0", notApplicable: [] }));
    expect(plan).toEqual({ ok: true, changes: [], set: {} });
  });

  it("is idempotent: planning again after applying the set yields nothing", () => {
    const input = parse({ sku: "S", msrp: "1500", depth: "36", notApplicable: ["height"] });
    const first = planHygienePatch(stored, input);
    if (!first.ok) throw new Error("expected ok");
    expect(first.changes.map((c) => c.field).sort()).toEqual(["depth", "msrp", "na_fields"]);
    const applied: CatalogSnapshot = {
      ...stored,
      msrp: first.set.msrp ?? stored.msrp,
      depth: first.set.depth ?? stored.depth,
      na_fields: first.set.na_fields ?? stored.na_fields,
    };
    const second = planHygienePatch(applied, input);
    expect(second).toEqual({ ok: true, changes: [], set: {} });
  });

  it("owns only the dimension keys of na_fields", () => {
    const plan = planHygienePatch(stored, parse({ sku: "S", notApplicable: ["depth"] }));
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.set.na_fields).toEqual(["image", "depth"]);
  });

  it("un-marks a dimension that is no longer N/A", () => {
    const plan = planHygienePatch(
      { ...stored, na_fields: ["image", "depth"] },
      parse({ sku: "S", depth: "36", notApplicable: [] }),
    );
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.set.na_fields).toEqual(["image"]);
    expect(plan.set.depth).toBe("36");
  });

  it("creates a row's values from nothing", () => {
    const plan = planHygienePatch(null, parse({ sku: "S", msrp: "10" }));
    expect(plan).toMatchObject({ ok: true, set: { msrp: "10.00" } });
  });

  it("rejects a value together with N/A and invalid numbers", () => {
    expect(planHygienePatch(stored, parse({ sku: "S", depth: "36", notApplicable: ["depth"] })).ok).toBe(false);
    expect(planHygienePatch(stored, parse({ sku: "S", msrp: "free" })).ok).toBe(false);
    expect(planHygienePatch(stored, parse({ sku: "S", height: "tall" })).ok).toBe(false);
  });

  it("rejects unknown keys at the schema", () => {
    expect(hygienePatchSchema.safeParse({ sku: "S", updated_by: "x" }).success).toBe(false);
  });
});

describe("hygiene source guards", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
  const files = [
    "src/server/mission-control/hygiene.ts",
    "src/server/mission-control/health-probes.ts",
    "src/app/mission-control/hygiene-action.ts",
    "src/app/mission-control/health-action.ts",
    "src/app/mission-control/actions.ts",
  ];

  it("has no bare catch and never logs or returns error.message", () => {
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/catch\s*\{/);
      expect(source, file).not.toMatch(/\.catch\(\s*\(\s*\)\s*=>/);
      expect(source, file).not.toMatch(/error\.message/);
    }
  });

  it("never touches QuickBooks from the radar or the patch", () => {
    for (const file of ["src/server/mission-control/hygiene.ts", "src/app/mission-control/hygiene-action.ts"]) {
      expect(read(file), file).not.toMatch(/qbo|quickbooks/i);
    }
  });

  it("has purged the dark theme from the Mission Control UI", () => {
    const ui = [
      "src/app/mission-control/page.tsx",
      "src/components/mission-control/TrafficLights.tsx",
      "src/components/mission-control/IssuesInbox.tsx",
      "src/components/mission-control/KeyManager.tsx",
      "src/components/mission-control/EscalationModal.tsx",
      "src/components/mission-control/HygieneRadar.tsx",
    ];
    for (const file of ui) {
      expect(read(file), file).not.toMatch(/zinc-(?:9|8|7)\d{2}|bg-black/);
    }
    expect(read("src/app/mission-control/page.tsx")).toContain("GoldBeam");
  });
});
