import { describe, expect, it } from "vitest";
import {
  isArchetypeCloneNote,
  isKatanaSaOrphanCandidate,
  isSaPrefixSku,
  isWithinLast24Hours,
} from "@/lib/katana-reconciliation";
import {
  isCushSubAssemblySku,
  isFrameSubAssemblySku,
} from "@/mappers/katana-catalog-guard";
import { subAssemblySku } from "@/lib/heuristic-bom";

describe("katana SA- orphan classifiers", () => {
  const now = new Date("2026-09-14T18:00:00.000Z");

  it("accepts only SA- SKUs", () => {
    expect(isSaPrefixSku("SA-BRV-SOF-72X34-FRAME")).toBe(true);
    expect(isSaPrefixSku("ASM-BRV-SOF-72X34-FRAME")).toBe(false);
    expect(isSaPrefixSku("FIN-BRV-SOF-72X34")).toBe(false);
    expect(isSaPrefixSku("RM-MET-2X2-TUBING")).toBe(false);
  });

  it("requires created_at inside the last 24 hours", () => {
    expect(isWithinLast24Hours("2026-09-14T12:00:00.000Z", now)).toBe(true);
    expect(isWithinLast24Hours("2026-09-13T18:00:00.000Z", now)).toBe(true);
    expect(isWithinLast24Hours("2026-09-13T17:59:59.000Z", now)).toBe(false);
    expect(isWithinLast24Hours(null, now)).toBe(false);
    expect(isWithinLast24Hours("not-a-date", now)).toBe(false);
  });

  it("deletes only empty SA- orphans created in the last 24h", () => {
    const base = {
      sku: "SA-OCN-SOF-72X38-FRAME",
      createdAt: "2026-09-14T10:00:00.000Z",
      recipeChildCount: 0,
      bomChildCount: 0,
      now,
    };
    expect(isKatanaSaOrphanCandidate(base)).toBe(true);
    expect(
      isKatanaSaOrphanCandidate({ ...base, recipeChildCount: 3 }),
    ).toBe(false);
    expect(isKatanaSaOrphanCandidate({ ...base, bomChildCount: 1 })).toBe(false);
    expect(
      isKatanaSaOrphanCandidate({
        ...base,
        createdAt: "2026-09-01T10:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      isKatanaSaOrphanCandidate({ ...base, sku: "ASM-OCN-SOF-72X38-FRAME" }),
    ).toBe(false);
    expect(isKatanaSaOrphanCandidate({ ...base, isMaterial: true })).toBe(
      false,
    );
  });

  it("recognizes archetype clone provenance notes", () => {
    expect(isArchetypeCloneNote("archetype clone from FIN-OCN-SOF-72X38")).toBe(
      true,
    );
    expect(isArchetypeCloneNote("manager edit")).toBe(false);
    expect(isArchetypeCloneNote(null)).toBe(false);
  });
});

describe("ASM- minting + catalog guard", () => {
  it("mints ASM-{FIN-stem}-FRAME", () => {
    expect(subAssemblySku("FIN-BRV-SOF-72X34", "FRAME")).toBe(
      "ASM-BRV-SOF-72X34-FRAME",
    );
  });

  it("treats ASM- and legacy SA- as FRAME/CUSH weldments", () => {
    expect(isFrameSubAssemblySku("ASM-BRV-SOF-72X34-FRAME")).toBe(true);
    expect(isFrameSubAssemblySku("SA-OCN-SOF-FRAME")).toBe(true);
    expect(isCushSubAssemblySku("ASM-BRV-SOF-72X34-CUSH")).toBe(true);
    expect(isFrameSubAssemblySku("FIN-BRV-SOF-72X34")).toBe(false);
  });
});
