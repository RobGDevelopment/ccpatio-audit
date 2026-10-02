import { describe, expect, it } from "vitest";
import { readSpecLabel } from "@/lib/stock-display";
import {
  groupThirdPartyProducts,
  loadThirdPartyLines,
} from "../scripts/ops/lib/third-party-inventory";

describe("third-party inventory sheets", () => {
  const lines = loadThirdPartyLines();

  it("names items, specs, and 3P SKUs the way the showroom allowlist expects", () => {
    const bySku = new Map(lines.map((line) => [line.sku, line]));
    expect(bySku.get("3P-UMB-ASTRO-10-SQ-ECRU-TITANIUM")).toMatchObject({
      productName: "Scolaro Astro",
      category: "Umbrellas",
      spec: "10' SQ - Canopy: ECRU - Frame: TITANIUM",
      onHand: 1,
    });
    expect(bySku.get("3P-UMB-ASTRO-10-SQ-CARBON")?.spec).toBe("10' SQ - Frame: CARBON");
    expect(bySku.get("3P-UMB-ASTRO-BASE-SQ")).toMatchObject({
      productName: "Scolaro Astro",
      category: "Umbrellas",
      spec: "BASE - SQ",
    });
    expect(bySku.get("3P-UMB-MARINA-7-SQ-WHITE-TITANIUM")?.category).toBe("Umbrellas");
    expect(bySku.get("3P-ESY-FLEXYZEN300-PUMPKIN")).toMatchObject({
      productName: "FIM Flexy Zen 300",
      category: "Flexy",
      spec: "Canopy: PUMPKIN",
    });
    expect(bySku.get("3P-ESY-FLEXYTWIN-CANVASCANOPY")?.spec).toBe("Canopy: Canvas Canopy");
    expect(bySku.get("3P-TJM-RISER8-SOLIDWHITE")).toMatchObject({
      productName: 'Tenjam Riser 8"',
      category: "Tenjam",
      spec: "Color: Solid White",
      onHand: 12,
    });
    const splash = lines.find((line) => line.productName === "Tenjam Splash Weight");
    expect(splash).toMatchObject({ sku: "3P-TJM-SPLASHWEIGHT-STD", spec: "", onHand: 12 });
    expect(lines.every((line) => line.sku.startsWith("3P-"))).toBe(true);
    expect(new Set(lines.map((line) => line.sku)).size).toBe(lines.length);
  });

  it("groups canopy and color rows under one item name", () => {
    const groups = groupThirdPartyProducts(lines);
    const astro = groups.find((group) => group.productName === "Scolaro Astro");
    const zen = groups.find((group) => group.productName === "FIM Flexy Zen 300");
    expect(astro?.category).toBe("Umbrellas");
    expect(astro && astro.lines.length).toBeGreaterThan(1);
    expect(zen?.lines).toHaveLength(3);
    expect(lines.every((line) => line.category !== "Umbrellas" || !line.productName.startsWith("Marina"))).toBe(
      true,
    );
    expect(lines.find((line) => line.sku === "3P-UMB-MARINA-7-SQ-WHITE-TITANIUM")?.productName).toBe(
      "Scolaro Marina",
    );
  });
});

describe("readSpecLabel", () => {
  it("reads the Spec config and ignores other attributes", () => {
    expect(
      readSpecLabel([
        { config_name: "Color", config_value: "Blue" },
        { config_name: "Spec", config_value: "10' SQ - Canopy: ECRU - Frame: TITANIUM" },
      ]),
    ).toBe("10' SQ - Canopy: ECRU - Frame: TITANIUM");
    expect(readSpecLabel([{ config_name: "color", config_value: "black" }])).toBeNull();
    expect(readSpecLabel(null)).toBeNull();
  });
});
