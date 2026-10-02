import { describe, expect, it } from "vitest";
import {
  chunkKatanaBomRows,
  isKatanaBomRowsEnabled,
  katanaManufacturingBomPath,
  shouldFallbackKatanaBomRows,
  toKatanaBomRowBody,
  truncateKatanaBomRowNotes,
} from "@/lib/katana-bom-rows";

describe("PR-T2.3 Katana /bom_rows soft-migrate helpers", () => {
  it("defaults ON so the writer prefers /bom_rows/batch/create", () => {
    expect(isKatanaBomRowsEnabled({})).toBe(true);
    expect(katanaManufacturingBomPath({})).toBe("/bom_rows/batch/create");
  });

  it("KATANA_USE_BOM_ROWS=false forces deprecated /recipes", () => {
    expect(isKatanaBomRowsEnabled({ KATANA_USE_BOM_ROWS: "false" })).toBe(false);
    expect(katanaManufacturingBomPath({ KATANA_USE_BOM_ROWS: "off" })).toBe(
      "/recipes",
    );
  });

  it("falls back on unsupported contracts but never on 401/403", () => {
    expect(shouldFallbackKatanaBomRows(404)).toBe(true);
    expect(shouldFallbackKatanaBomRows(405)).toBe(true);
    expect(shouldFallbackKatanaBomRows(422)).toBe(true);
    expect(shouldFallbackKatanaBomRows(401)).toBe(false);
    expect(shouldFallbackKatanaBomRows(403)).toBe(false);
  });

  it("truncates notes to Katana's 255-char BOM-row limit", () => {
    const long = "x".repeat(300);
    expect(truncateKatanaBomRowNotes(long)?.length).toBe(255);
    expect(truncateKatanaBomRowNotes("  ")).toBeNull();
  });

  it("emits the /bom_rows body with product_item_id", () => {
    const body = toKatanaBomRowBody({
      productItemId: 11,
      productVariantId: 22,
      ingredientVariantId: 33,
      quantity: 1.5,
      notes: "4 pcs @ 34.0 in · 45°/45° mitre",
    });
    expect(body).toEqual({
      product_item_id: 11,
      product_variant_id: 22,
      ingredient_variant_id: 33,
      quantity: 1.5,
      notes: "4 pcs @ 34.0 in · 45°/45° mitre",
    });
  });

  it("chunks batches at 250", () => {
    const rows = Array.from({ length: 251 }, (_, i) => i);
    const chunks = chunkKatanaBomRows(rows);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(250);
    expect(chunks[1]).toHaveLength(1);
  });
});
