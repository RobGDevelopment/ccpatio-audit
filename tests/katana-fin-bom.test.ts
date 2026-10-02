import { describe, expect, it } from "vitest";
import {
  getBaseSku,
  getFinStem,
  resolveFinMultiLevelIngredients,
  searchedAsmFrameSku,
} from "@/lib/katana-fin-bom";

describe("getBaseSku", () => {
  it("strips tokens after the WxD dimension", () => {
    expect(getBaseSku("FIN-BRV-CLB-CHA-34X34-LS-BE")).toBe(
      "FIN-BRV-CLB-CHA-34X34",
    );
    expect(getBaseSku("FIN-BRK-CHS-72X34-RS-WH")).toBe("FIN-BRK-CHS-72X34");
    expect(getBaseSku("FIN-BRK-BAR-TAB-36X72-STARLEG")).toBe(
      "FIN-BRK-BAR-TAB-36X72",
    );
    expect(getBaseSku("fin-brk-bar-tab-120x28-ls-be")).toBe(
      "FIN-BRK-BAR-TAB-120X28",
    );
  });

  it("leaves already-base and dimension-less SKUs unchanged", () => {
    expect(getBaseSku("FIN-BRV-CLB-CHA-34X34")).toBe("FIN-BRV-CLB-CHA-34X34");
    expect(getBaseSku("FIN-MAR-3M-UMB-NO-BAS")).toBe("FIN-MAR-3M-UMB-NO-BAS");
  });
});

describe("searchedAsmFrameSku", () => {
  it("names the exact FRAME the generator hunts (legacy SA when aliased)", () => {
    expect(searchedAsmFrameSku("FIN-BRK-CHS-72X34-LS-BE")).toBe(
      "SA-BRO-C-72X34-LS-FRAME",
    );
    expect(getFinStem("FIN-BRK-CHS-72X34-LS-BE")).toBe("BRO-C-72X34-LS");
    expect(searchedAsmFrameSku("FIN-BRV-CLB-CHA-34X34-LS-BE")).toBe(
      "SA-BRA-CC-FRAME",
    );
  });
});

describe("resolveFinMultiLevelIngredients", () => {
  it("emits FRAME + CUSH at qty 1 when both ASM children exist live", () => {
    const live = new Set([
      "FIN-BRV-SOF-72X34",
      "ASM-BRV-SOF-72X34-FRAME",
      "ASM-BRV-SOF-72X34-CUSH",
    ]);
    const edges = resolveFinMultiLevelIngredients("FIN-BRV-SOF-72X34", live);
    expect(edges).toEqual([
      {
        productSku: "FIN-BRV-SOF-72X34",
        ingredientSku: "ASM-BRV-SOF-72X34-FRAME",
        quantity: 1,
        role: "FRAME",
      },
      {
        productSku: "FIN-BRV-SOF-72X34",
        ingredientSku: "ASM-BRV-SOF-72X34-CUSH",
        quantity: 1,
        role: "CUSH",
      },
    ]);
  });

  it("falls back to SA-* when ASM-* is absent", () => {
    const live = new Set([
      "FIN-OCN-CLB-34X34",
      "SA-OCN-CLB-34X34-FRAME",
      "SA-OCN-CLB-34X34-CUSH",
    ]);
    const edges = resolveFinMultiLevelIngredients("fin-ocn-clb-34x34", live);
    expect(edges.map((e) => e.ingredientSku)).toEqual([
      "SA-OCN-CLB-34X34-FRAME",
      "SA-OCN-CLB-34X34-CUSH",
    ]);
    expect(edges.every((e) => e.quantity === 1)).toBe(true);
  });

  it("includes DKT only when a live Dekton SA exists", () => {
    const live = new Set([
      "FIN-OCN-TBL-72X36",
      "ASM-OCN-TBL-72X36-FRAME",
      "ASM-OCN-TBL-72X36-DKT-TOP",
    ]);
    const edges = resolveFinMultiLevelIngredients("FIN-OCN-TBL-72X36", live);
    expect(edges.map((e) => `${e.role}:${e.ingredientSku}`)).toEqual([
      "FRAME:ASM-OCN-TBL-72X36-FRAME",
      "DKT:ASM-OCN-TBL-72X36-DKT-TOP",
    ]);
  });

  it("returns empty when FIN or children are not live", () => {
    expect(
      resolveFinMultiLevelIngredients(
        "FIN-MISSING",
        new Set(["ASM-MISSING-FRAME"]),
      ),
    ).toEqual([]);
    expect(
      resolveFinMultiLevelIngredients(
        "FIN-ONLY",
        new Set(["FIN-ONLY"]),
      ),
    ).toEqual([]);
    expect(
      resolveFinMultiLevelIngredients("RM-MET-2X2", new Set(["RM-MET-2X2"])),
    ).toEqual([]);
  });

  it("maps colorway FINs to unsuffixed ASM twins while keeping the FIN parent", () => {
    const live = new Set([
      "FIN-BRV-CLB-CHA-34X34-LS-BE",
      "ASM-BRV-CLB-CHA-34X34-FRAME",
      "ASM-BRV-CLB-CHA-34X34-CUSH",
    ]);
    const edges = resolveFinMultiLevelIngredients(
      "FIN-BRV-CLB-CHA-34X34-LS-BE",
      live,
    );
    expect(edges).toEqual([
      {
        productSku: "FIN-BRV-CLB-CHA-34X34-LS-BE",
        ingredientSku: "ASM-BRV-CLB-CHA-34X34-FRAME",
        quantity: 1,
        role: "FRAME",
      },
      {
        productSku: "FIN-BRV-CLB-CHA-34X34-LS-BE",
        ingredientSku: "ASM-BRV-CLB-CHA-34X34-CUSH",
        quantity: 1,
        role: "CUSH",
      },
    ]);
  });

  it("maps Brooklyn chaise colorways onto legacy SA-BRO-C-*-LS-FRAME", () => {
    const live = new Set([
      "FIN-BRK-CHS-72X34-LS-BE",
      "SA-BRO-C-72X34-LS-FRAME",
      "SA-BRO-C-72X34-LS-CUSH",
    ]);
    const edges = resolveFinMultiLevelIngredients(
      "FIN-BRK-CHS-72X34-LS-BE",
      live,
    );
    expect(edges.map((e) => `${e.role}:${e.ingredientSku}`)).toEqual([
      "FRAME:SA-BRO-C-72X34-LS-FRAME",
      "CUSH:SA-BRO-C-72X34-LS-CUSH",
    ]);
    expect(searchedAsmFrameSku("FIN-BRK-CHS-72X34-LS-BE")).toBe(
      "SA-BRO-C-72X34-LS-FRAME",
    );
    expect(getFinStem("FIN-BRK-CHS-72X34-LS-BE")).toBe("BRO-C-72X34-LS");
  });

  it("maps Bravada/Ocean aliases (corner sofa, armless, coffee table)", () => {
    expect(
      resolveFinMultiLevelIngredients("FIN-BRK-COR-SOF-72X34-LS-BE", new Set([
        "FIN-BRK-COR-SOF-72X34-LS-BE",
        "SA-BRO-CS-72-LS-FRAME",
      ]))[0]?.ingredientSku,
    ).toBe("SA-BRO-CS-72-LS-FRAME");
    expect(
      resolveFinMultiLevelIngredients("FIN-BRV-ARM-SOF-72-BE", new Set([
        "FIN-BRV-ARM-SOF-72-BE",
        "SA-BRA-AS-72-FRAME",
      ]))[0]?.ingredientSku,
    ).toBe("SA-BRA-AS-72-FRAME");
    expect(
      resolveFinMultiLevelIngredients("FIN-BRV-COF-TAB-42X28", new Set([
        "FIN-BRV-COF-TAB-42X28",
        "SA-BRA-CT-42X28-FRAME",
      ]))[0]?.ingredientSku,
    ).toBe("SA-BRA-CT-42X28-FRAME");
    expect(
      resolveFinMultiLevelIngredients("FIN-OCN-COF-TAB-36X36", new Set([
        "FIN-OCN-COF-TAB-36X36",
        "SA-OCE-CT-36X36-FRAME",
      ]))[0]?.ingredientSku,
    ).toBe("SA-OCE-CT-36X36-FRAME");
    expect(
      resolveFinMultiLevelIngredients("FIN-BRV-CHS-34X72-LAF-WH", new Set([
        "FIN-BRV-CHS-34X72-LAF-WH",
        "SA-BRA-C-34X72-LS-FRAME",
      ]))[0]?.ingredientSku,
    ).toBe("SA-BRA-C-34X72-LS-FRAME");
  });

  it("prefers ASM over SA when both exist", () => {
    const live = new Set([
      "FIN-X",
      "ASM-X-FRAME",
      "SA-X-FRAME",
      "ASM-X-CUSH",
      "SA-X-CUSH",
    ]);
    const edges = resolveFinMultiLevelIngredients("FIN-X", live);
    expect(edges.map((e) => e.ingredientSku)).toEqual([
      "ASM-X-FRAME",
      "ASM-X-CUSH",
    ]);
  });
});
