import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  QA_QUESTIONS,
  OTTOMAN_MONSOON_MARKETING,
  OTHER_OPTION_LABEL,
  VW_CAPABILITY_ONE_TO_ONE,
  fillTab01LogisticsDefaults,
  isTableOrStoneProduct,
  sanitizeTab02ForVendors,
  stripDictionaryCostFromId,
  tab02RetailUpchargeFormula,
  vwAssetIdFormula,
  withOtherOption,
  xlookupMultiplier,
  yesNoOptions,
} from "../scripts/harden-spark-handoff-mq";
import { hexPreviewForInternalId } from "../scripts/lib/material-hex-preview";
import { isVendorSafeMaterialId, SELLABLE_POWDER_IDS } from "../scripts/lib/sellable-powders";

describe("QA_QUESTIONS catalog", () => {
  it("exposes unique System_Variable_Key values in uppercase snake_case", () => {
    const keys = QA_QUESTIONS.map((q) => q.systemKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it("uses neutral MSRP Multiplier language on Q01 (no Wholesale COGS framing)", () => {
    const q01 = QA_QUESTIONS.find((q) => q.systemKey === "MSRP_MARKUP_MULT");
    expect(q01?.selected).toMatch(/MSRP Multiplier/i);
    expect(q01?.selected.toLowerCase()).not.toContain("wholesale");
    for (const opt of q01?.options ?? []) {
      expect(opt.label.toLowerCase()).not.toContain("wholesale");
    }
  });

  it("includes WooCommerce checkout programming keys", () => {
    const keys = new Set(QA_QUESTIONS.map((q) => q.systemKey));
    expect(keys.has("PAYMENT_AUTH_CAPTURE_MODE")).toBe(true);
    expect(keys.has("TAXATION_STRATEGY")).toBe(true);
    expect(keys.has("SHIPPING_RULE_ITEM_VS_CART")).toBe(true);
    expect(keys.has("ORDER_CANCELLATION_WINDOW")).toBe(true);
  });

  it("does not keep monsoon weatherproofing on the Q&A catalog", () => {
    expect(QA_QUESTIONS.some((q) => /monsoon/i.test(q.topic))).toBe(false);
    expect(OTTOMAN_MONSOON_MARKETING.toLowerCase()).toContain("gasketed");
  });

  it("uses fire component boolean cluster instead of bundle offset", () => {
    const keys = QA_QUESTIONS.map((q) => q.systemKey);
    expect(keys).toContain("FIRE_INCLUDE_BURNER");
    expect(keys).toContain("FIRE_INCLUDE_GLASS");
    expect(keys).toContain("FIRE_INCLUDE_MEDIA");
    expect(keys).not.toContain("FIRE_PIT_COMPONENT_OFFSET");
  });

  it("keeps selected option inside each options list (including after withOther)", () => {
    for (const q of QA_QUESTIONS) {
      expect(q.options.map((o) => o.label)).toContain(q.selected);
      const expanded = withOtherOption(q.options);
      expect(expanded.map((o) => o.label)).toContain(q.selected);
    }
  });
});

describe("withOtherOption", () => {
  it("appends Other specify label to every options list", () => {
    const opts = withOtherOption(yesNoOptions());
    expect(opts.map((o) => o.label)).toContain(OTHER_OPTION_LABEL);
  });
});

describe("tab02RetailUpchargeFormula", () => {
  it("uses live XLOOKUP with Fabric Grade and Dekton Grade prefixes", () => {
    const formula = tab02RetailUpchargeFormula(5);
    expect(formula).toContain("XLOOKUP");
    expect(formula).toContain("Fabric Grade ");
    expect(formula).toContain("Dekton Grade ");
  });
});

describe("sanitizeTab02ForVendors", () => {
  it("drops Dictionary Cost, shifts Notes/Swatch left, and fills Hex", () => {
    const wb = new ExcelJS.Workbook();
    const t2 = wb.addWorksheet("02 - WEB FABRICS & FINISHES");
    const headers = [
      "Material Category",
      "CC Patio Internal ID",
      "Public Display Name",
      "Brand / Series",
      "Finish / Texture",
      "Thickness (mm)",
      "Application",
      "Pricing Grade (A-F)",
      "Cosentino Price Group (0-5)",
      "Retail Upcharge ($)",
      "E-Comm Approved",
      "VW Texture / Asset Key",
      "Katana Attribute Key",
      "Hex / Preview",
      "Outdoor Rated",
      "Dictionary Cost",
      "Notes",
      "Swatch",
    ];
    headers.forEach((h, i) => {
      t2.getRow(1).getCell(i + 1).value = h;
    });
    const data = [
      "Upholstery",
      "FAB-CAN-BLA",
      "Canvas Black",
      "Sunbrella",
      "N/A",
      "",
      "Cushion",
      "A",
      "",
      0,
      "Yes",
      "",
      "fabric_color",
      "",
      "Y",
      12.34,
      "keep me",
      "",
    ];
    data.forEach((v, i) => {
      t2.getRow(2).getCell(i + 1).value = v;
    });

    const result = sanitizeTab02ForVendors(t2);
    expect(result.dictionaryCostRemoved).toBe(true);
    expect(result.hexFilled).toBe(1);

    const outHeaders: string[] = [];
    for (let c = 1; c <= 18; c++) {
      const v = t2.getRow(1).getCell(c).value;
      if (v != null && v !== "") outHeaders.push(String(v));
    }
    expect(outHeaders).not.toContain("Dictionary Cost");
    expect(outHeaders[outHeaders.length - 2]).toBe("Notes");
    expect(outHeaders[outHeaders.length - 1]).toBe("Swatch");
    expect(t2.getRow(2).getCell(14).value).toBe(hexPreviewForInternalId("FAB-CAN-BLA"));
    expect(t2.getRow(2).getCell(16).value).toBe("keep me");
    expect(String(t2.getRow(2).getCell(17).value ?? "")).toBe("");
    expect(result.thicknessNaFilled).toBeGreaterThanOrEqual(1);
  });
});

describe("sellable powder allow-list", () => {
  it("allows only the six web powders", () => {
    expect(SELLABLE_POWDER_IDS).toHaveLength(6);
    expect(isVendorSafeMaterialId("PWD-BLACK")).toBe(true);
    expect(isVendorSafeMaterialId("PWD-GRAY-ZINC-EPOXY-PRIMER")).toBe(false);
    expect(isVendorSafeMaterialId("FAB-CAN-BLA")).toBe(true);
  });
});

describe("fillTab01LogisticsDefaults", () => {
  it("fills blank freight/lead using seating vs table defaults", () => {
    const wb = new ExcelJS.Workbook();
    const t1 = wb.addWorksheet("01");
    t1.getRow(1).getCell(12).value = "Freight Class";
    t1.getRow(1).getCell(13).value = "Lead Time";
    t1.getRow(2).getCell(1).value = "Bravada Sofa";
    t1.getRow(2).getCell(2).value = "FIN-BRV-SOF-72X34";
    t1.getRow(3).getCell(1).value = "Waterfall Dining Table";
    t1.getRow(3).getCell(2).value = "FIN-WFT-DIN-TAB-84X42";
    const stats = fillTab01LogisticsDefaults(t1);
    expect(stats.freightFilled).toBe(2);
    expect(stats.leadFilled).toBe(2);
    expect(t1.getRow(2).getCell(12).value).toBe("175");
    expect(t1.getRow(3).getCell(12).value).toBe("85");
    expect(t1.getRow(2).getCell(13).value).toBe("6-8 weeks");
    expect(isTableOrStoneProduct("FIN-WFT-DIN-TAB-84X42", "x")).toBe(true);
  });
});

describe("stripDictionaryCostFromId", () => {
  it("removes CostFromId column from 99 - DICTIONARY", () => {
    const wb = new ExcelJS.Workbook();
    const d = wb.addWorksheet("99 - DICTIONARY");
    d.getRow(1).getCell(10).value = "CategoryFromId";
    d.getRow(1).getCell(11).value = "CostFromId";
    d.getRow(1).getCell(12).value = "FabricGradeLabel";
    d.getRow(2).getCell(11).value = 6.39;
    d.getRow(2).getCell(12).value = "Fabric Grade A";
    const result = stripDictionaryCostFromId(wb);
    expect(result.removed).toBe(true);
    const headers: string[] = [];
    for (let c = 1; c <= 15; c++) {
      const v = d.getRow(1).getCell(c).value;
      if (v) headers.push(String(v));
    }
    expect(headers).not.toContain("CostFromId");
    expect(headers).toContain("FabricGradeLabel");
  });
});

describe("hexPreviewForInternalId", () => {
  it("returns research hex for known fabrics and powders", () => {
    expect(hexPreviewForInternalId("FAB-CAN-BLA")).toBe("#1A1A1A");
    expect(hexPreviewForInternalId("PWD-BLACK")).toBe("#1A1A1A");
    expect(hexPreviewForInternalId("STN-DKT-ALB1.2")).toBe("");
  });
});

describe("vwAssetIdFormula", () => {
  it("mirrors Internal ID when capability toggle is 1:1 mapping", () => {
    const formula = vwAssetIdFormula(5);
    expect(formula).toContain(`$C$2="${VW_CAPABILITY_ONE_TO_ONE}"`);
    expect(formula).toContain("A5");
    expect(formula).toContain("PASTE UUID HERE");
  });
});

describe("xlookupMultiplier", () => {
  it("builds XLOOKUP against Q&A System_Variable_Key → multiplier", () => {
    expect(xlookupMultiplier("FABRIC_SCALE_FACTOR")).toBe(
      "XLOOKUP(\"FABRIC_SCALE_FACTOR\",'Q&A'!$B:$B,'Q&A'!$G:$G)",
    );
  });
});
