import { describe, expect, it } from "vitest";
import {
  composeBomNotes,
  formatFloorCutCard,
  formatKatanaIngredientNote,
  parseFreeTextCutCards,
  resolveDraftCutsAndNote,
  resolveKatanaIngredientNotes,
  splitBomNotes,
  type CutLine,
} from "@/lib/sketchup-cutlist";

const SAMPLE_CUT: CutLine = {
  role: "apron",
  profile: "SQ2-16",
  lengthIn: 34,
  endA: 45,
  endB: 45,
  qtyEa: 4,
  lengthConvention: "long_point",
  sourceName: "apron",
  confidence: "stated",
  drawingPartNumber: "CUT-SQ2-16-34.0-4545C",
};

describe("notes-codec (BOM cut-list trailer)", () => {
  it("splitBomNotes extracts manager note and CutLine[] from trailer", () => {
    const raw = `Check long-point\n${JSON.stringify({ cut_list: [SAMPLE_CUT] })}`;
    const parts = splitBomNotes(raw);
    expect(parts.managerNote).toBe("Check long-point");
    expect(parts.cutList).toHaveLength(1);
    expect(parts.cutList[0]?.qtyEa).toBe(4);
    expect(parts.cutList[0]?.lengthIn).toBe(34);
    expect(parts.cutList[0]?.drawingPartNumber).toBe("CUT-SQ2-16-34.0-4545C");
  });

  it("composeBomNotes round-trips without exposing editable JSON to callers", () => {
    const composed = composeBomNotes({
      managerNote: "Floor check rails",
      cutList: [SAMPLE_CUT],
    });
    expect(composed).toContain("Floor check rails");
    expect(composed).toContain('"cut_list"');
    const again = splitBomNotes(composed);
    expect(again.managerNote).toBe("Floor check rails");
    expect(again.cutList[0]?.qtyEa).toBe(4);
    expect(again.cutList[0]?.endA).toBe(45);
  });

  it("composeBomNotes with empty manager seeds chop-saw plain prefix", () => {
    const composed = composeBomNotes({ managerNote: "", cutList: [SAMPLE_CUT] });
    expect(composed).toBeTruthy();
    const parts = splitBomNotes(composed);
    expect(parts.managerNote.length).toBeGreaterThan(0);
    expect(parts.cutList).toHaveLength(1);
  });

  it("corrupt trailer falls back to full string as managerNote", () => {
    const broken = 'hello\n{"cut_list": NOT_JSON}';
    const parts = splitBomNotes(broken);
    expect(parts.cutList).toHaveLength(0);
    expect(parts.managerNote).toContain("cut_list");
  });

  it("plain-only notes stay managerNote with empty cuts", () => {
    const parts = splitBomNotes("Cut 2x 34 inches 45/45");
    expect(parts.managerNote).toBe("Cut 2x 34 inches 45/45");
    expect(parts.cutList).toHaveLength(0);
    expect(composeBomNotes(parts)).toBe("Cut 2x 34 inches 45/45");
  });

  it("formatFloorCutCard is human-readable (no braces)", () => {
    const card = formatFloorCutCard(SAMPLE_CUT);
    expect(card).toBe("4 pcs | 34.0 in | 45°/45° Mitre");
    expect(card).not.toContain("{");
    expect(card).not.toContain("cut_list");
  });

  it("formatKatanaIngredientNote matches tablet dialect", () => {
    expect(formatKatanaIngredientNote([SAMPLE_CUT])).toBe(
      "4 pcs @ 34.0 in · 45°/45° mitre",
    );
  });

  it("accepts qty alias from slim payloads", () => {
    const raw = `\n${JSON.stringify({
      cut_list: [{ lengthIn: 12, qty: 2, profile: "SQ2-16", endA: 90, endB: 90 }],
    })}`;
    // Leading newline still matches trailer regex when preceded by empty plain
    const withPlain = `seed${raw}`;
    const parts = splitBomNotes(withPlain);
    expect(parts.cutList[0]?.qtyEa).toBe(2);
    expect(parts.cutList[0]?.lengthIn).toBe(12);
  });

  it("resolveDraftCutsAndNote prefers cut_list column over trailer", () => {
    const trailer = `legacy\n${JSON.stringify({ cut_list: [SAMPLE_CUT] })}`;
    const columnCut: CutLine = { ...SAMPLE_CUT, qtyEa: 9, lengthIn: 12 };
    const resolved = resolveDraftCutsAndNote({
      notes: trailer,
      cutList: [columnCut],
    });
    expect(resolved.managerNote).toBe("legacy");
    expect(resolved.cutList[0]?.qtyEa).toBe(9);
    expect(resolved.cutList[0]?.lengthIn).toBe(12);
  });

  it("resolveKatanaIngredientNotes formats from cuts when manager note empty", () => {
    expect(
      resolveKatanaIngredientNotes({
        notes: "",
        cutList: [SAMPLE_CUT],
      }),
    ).toBe("4 pcs @ 34.0 in · 45°/45° mitre");
  });
});

describe("parseFreeTextCutCards (PR-T2.4)", () => {
  it("converts Katana tablet dialect into structured cards", () => {
    const parsed = parseFreeTextCutCards("4 pcs @ 34.0 in · 45°/45° mitre");
    expect(parsed.cutList).toHaveLength(1);
    expect(parsed.cutList[0]?.qtyEa).toBe(4);
    expect(parsed.cutList[0]?.lengthIn).toBe(34);
    expect(parsed.cutList[0]?.endA).toBe(45);
    expect(parsed.cutList[0]?.endB).toBe(45);
    expect(parsed.remainder).toBe("");
  });

  it("converts floor cards and formatCutNote strings", () => {
    const parsed = parseFreeTextCutCards(
      "2 pcs | 12.0 in | 90°/90°; 3ea 18.0in 45/90 LP",
    );
    expect(parsed.cutList.length).toBeGreaterThanOrEqual(2);
    expect(parsed.cutList.some((c) => c.qtyEa === 2 && c.lengthIn === 12)).toBe(
      true,
    );
    expect(parsed.cutList.some((c) => c.qtyEa === 3 && c.lengthIn === 18)).toBe(
      true,
    );
  });

  it("converts the legacy placeholder Cut Nx inches 45/45", () => {
    const parsed = parseFreeTextCutCards("Cut 2x 34 inches 45/45");
    expect(parsed.cutList).toHaveLength(1);
    expect(parsed.cutList[0]?.qtyEa).toBe(2);
    expect(parsed.cutList[0]?.lengthIn).toBe(34);
    expect(parsed.cutList[0]?.endA).toBe(45);
    expect(parsed.cutList[0]?.drawingPartNumber).toBeTruthy();
  });

  it("leaves unrelated manager text as remainder", () => {
    const parsed = parseFreeTextCutCards(
      "Check long-point before weld. Cut 2x 34 inches 45/45",
    );
    expect(parsed.cutList).toHaveLength(1);
    expect(parsed.remainder).toMatch(/Check long-point/i);
    expect(parsed.remainder).not.toMatch(/Cut 2x/i);
  });
});
