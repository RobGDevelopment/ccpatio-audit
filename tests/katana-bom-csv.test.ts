import { describe, expect, it } from "vitest";
import {
  aggregateKatanaRecipeRows,
  escapeKatanaCsvField,
  toKatanaCsv,
} from "@/lib/katana-bom-csv";

describe("Katana BOM CSV formatter", () => {
  it("leaves simple SKUs unquoted", () => {
    expect(escapeKatanaCsvField("FIN-BRV-SOF-72X34")).toBe("FIN-BRV-SOF-72X34");
    expect(escapeKatanaCsvField(1.08)).toBe("1.08");
  });

  it("quotes notes with commas and doubles inner quotes", () => {
    expect(escapeKatanaCsvField("archetype clone from FIN-OCN-SOF-72X38")).toBe(
      "archetype clone from FIN-OCN-SOF-72X38",
    );
    expect(
      escapeKatanaCsvField('archetype clone from FIN-OCN-SOF-72X38, FRAME'),
    ).toBe('"archetype clone from FIN-OCN-SOF-72X38, FRAME"');
    expect(escapeKatanaCsvField('He said "weld"')).toBe('"He said ""weld"""');
  });

  it("emits CRLF rows with the official header order", () => {
    const csv = toKatanaCsv([
      [
        "Product variant code / SKU (required)",
        "Product variant name",
        "Ingredient variant code / SKU (required)",
        "Ingredient variant name",
        "Notes",
        "Quantity (required)",
      ],
      [
        "FIN-WFT-DIN-TAB-72X28",
        'WATERFALL TABLE 72" x 28"',
        "ASM-WFT-DIN-TAB-72X28-FRAME",
        "Frame",
        "archetype clone from FIN-OCN-SOF-72X38",
        1,
      ],
    ]);
    expect(csv).toContain(
      "Product variant code / SKU (required),Product variant name,Ingredient variant code / SKU (required),Ingredient variant name,Notes,Quantity (required)\r\n",
    );
    expect(csv).toContain('"WATERFALL TABLE 72"" x 28"""');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("aggregateKatanaRecipeRows", () => {
  it("sums qty and joins distinct notes for duplicate parent+ingredient", () => {
    const out = aggregateKatanaRecipeRows([
      {
        productSku: "ASM-BRV-ARM-SOF-96X34-FRAME",
        productName: "Frame",
        ingredientSku: "RM-MET-2X2-TUBING",
        ingredientName: "2x2 Tubing",
        notes: "4ea 34.0in 45/45C",
        quantity: 11.33,
      },
      {
        productSku: "asm-brv-arm-sof-96x34-frame",
        productName: "Frame",
        ingredientSku: "rm-met-2x2-tubing",
        ingredientName: "2x2 Tubing",
        notes: "2ea 8.0in 90/90",
        quantity: 1.33,
      },
      {
        productSku: "ASM-BRV-ARM-SOF-96X34-FRAME",
        productName: "Frame",
        ingredientSku: "RM-MET-2X2-TUBING",
        ingredientName: "2x2 Tubing",
        notes: "4ea 34.0in 45/45C",
        quantity: 0.5,
      },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      productSku: "ASM-BRV-ARM-SOF-96X34-FRAME",
      productName: "Frame",
      ingredientSku: "RM-MET-2X2-TUBING",
      ingredientName: "2x2 Tubing",
      notes: "4ea 34.0in 45/45C | 2ea 8.0in 90/90",
      quantity: 13.16,
    });
  });

  it("keeps distinct ingredients on the same parent separate", () => {
    const out = aggregateKatanaRecipeRows([
      {
        productSku: "ASM-X-FRAME",
        productName: "Frame",
        ingredientSku: "RM-MET-2X2-TUBING",
        ingredientName: "2x2",
        notes: "a",
        quantity: 10,
      },
      {
        productSku: "ASM-X-FRAME",
        productName: "Frame",
        ingredientSku: "RM-MET-FLATBAR",
        ingredientName: "Flatbar",
        notes: "b",
        quantity: 2,
      },
    ]);
    expect(out.map((r) => r.ingredientSku)).toEqual([
      "RM-MET-2X2-TUBING",
      "RM-MET-FLATBAR",
    ]);
    expect(out.map((r) => r.quantity)).toEqual([10, 2]);
  });

  it("ensures no parent has the same ingredient more than once", () => {
    const out = aggregateKatanaRecipeRows([
      {
        productSku: "SA-A",
        productName: "",
        ingredientSku: "RM-MET-2X2-TUBING",
        ingredientName: "",
        notes: "",
        quantity: 1,
      },
      {
        productSku: "SA-A",
        productName: "Name",
        ingredientSku: "RM-MET-2X2-TUBING",
        ingredientName: "Tubing",
        notes: "cut",
        quantity: 2,
      },
    ]);
    const keys = out.map((r) => `${r.productSku}|${r.ingredientSku}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(out[0]!.productName).toBe("Name");
    expect(out[0]!.ingredientName).toBe("Tubing");
    expect(out[0]!.quantity).toBe(3);
    expect(out[0]!.notes).toBe("cut");
  });
});
