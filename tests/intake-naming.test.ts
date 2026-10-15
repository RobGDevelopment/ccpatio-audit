import { describe, expect, it } from "vitest";
import {
  deriveClientCode,
  deriveItemCode,
  buildClientSku,
  nextVariantIndex,
  suggestFromFilename,
  roundInchesForCode,
} from "@/lib/intake/naming";

describe("Intake Naming Library (deriveClientCode, deriveItemCode, etc.)", () => {
  describe("deriveClientCode", () => {
    it("handles simple contact name", () => {
      expect(deriveClientCode("John Smith", "Opp")).toBe("SMITH");
    });

    it("drops suffix tokens (JR, SR, LLC, TRUST, etc.)", () => {
      expect(deriveClientCode("John Smith Jr.", "Opp")).toBe("SMITH");
      expect(deriveClientCode("Robert Lapaglia III", "Opp")).toBe("LAPAGLIA");
      expect(deriveClientCode("Acme Hospitality LLC", "Opp")).toBe("HOSPITALITY");
      expect(deriveClientCode("David Miller Family Trust", "Opp")).toBe("MILLER");
    });

    it("normalizes diacritics and special characters", () => {
      expect(deriveClientCode("François Müller", "Opp")).toBe("MULLER");
      expect(deriveClientCode("Renée O'Connor", "Opp")).toBe("OCONNOR");
    });

    it("falls back to opportunity name if contact name is empty", () => {
      expect(deriveClientCode("", "Ocean Villa")).toBe("VILLA");
      expect(deriveClientCode("   ", "Bakersfield Ranch")).toBe("RANCH");
    });

    it("caps at 16 characters", () => {
      expect(deriveClientCode("Alexander LongLastNameExceedingSixteenCharacters", "Opp")).toBe(
        "LONGLASTNAMEEXCE"
      );
    });

    it("handles single token contact name", () => {
      expect(deriveClientCode("Madonna", "Opp")).toBe("MADONNA");
    });
  });

  describe("deriveItemCode", () => {
    it("drops stopwords (THE, A, AN, WITH, FOR, OF) and tokenizes", () => {
      expect(deriveItemCode("Malibu 3-Seat Sectional")).toBe("MALIBU-3-SEAT-SECTIONAL");
      expect(deriveItemCode("The Lounge Chair with Arms")).toBe("LOUNGE-CHAIR-ARMS");
    });

    it("cuts at token boundaries at 24 characters", () => {
      const longName = "Oversized Reclining Sectional Sofa";
      const code = deriveItemCode(longName);
      expect(code.length).toBeLessThanOrEqual(24);
      expect(code).toBe("OVERSIZED-RECLINING");
    });

    it("hard-cuts only if the first token alone exceeds 24 characters", () => {
      const giantToken = "SupercalifragilisticexpialidociousChair";
      const code = deriveItemCode(giantToken);
      expect(code.length).toBe(24);
      expect(code).toBe("SUPERCALIFRAGILISTICEXPI");
    });

    it("validates regex ^[A-Z0-9][A-Z0-9-]{2,23}$", () => {
      const code = deriveItemCode("Club Chair");
      expect(/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(code)).toBe(true);
    });
  });

  describe("buildClientSku", () => {
    it("builds base JOB- SKU and variant suffixes", () => {
      expect(buildClientSku("SMITH", "CHAIR")).toBe("JOB-SMITH-CHAIR");
      expect(buildClientSku("SMITH", "CHAIR", 2)).toBe("JOB-SMITH-CHAIR-V2");
      expect(buildClientSku("SMITH", "CHAIR", 3)).toBe("JOB-SMITH-CHAIR-V3");
    });
  });

  describe("nextVariantIndex", () => {
    it("computes next variant index without colliding with substrings or other names", () => {
      const base = "JOB-SMITH-CHAIR";
      // Exact match check: CHAIRMAN must not collide with CHAIR
      const existing = [
        "JOB-SMITH-CHAIR",
        "JOB-SMITH-CHAIRMAN",
        "JOB-SMITH-CHAIR-V2",
      ];
      expect(nextVariantIndex(existing, base)).toBe(3);
    });

    it("tolerates legacy -02 suffixes", () => {
      const base = "JOB-SMITH-SOFA";
      const existing = ["JOB-SMITH-SOFA", "JOB-SMITH-SOFA-02"];
      expect(nextVariantIndex(existing, base)).toBe(3);
    });

    it("returns 2 when only baseSku exists", () => {
      const base = "JOB-SMITH-TABLE";
      const existing = ["JOB-SMITH-TABLE"];
      expect(nextVariantIndex(existing, base)).toBe(2);
    });

    it("returns 1 when baseSku does not exist", () => {
      const base = "JOB-SMITH-BENCH";
      expect(nextVariantIndex([], base)).toBe(1);
    });
  });

  describe("suggestFromFilename", () => {
    it("extracts dimensions and name from filenames", () => {
      const sug = suggestFromFilename("Malibu_Sofa_96x38.glb");
      expect(sug.pieceName).toBe("Malibu Sofa");
      expect(sug.length).toBe(96);
      expect(sug.depth).toBe(38);
    });
  });

  describe("roundInchesForCode", () => {
    it("rounds decimals to nearest whole inch for code generation only", () => {
      expect(roundInchesForCode(96.4)).toBe(96);
      expect(roundInchesForCode(96.5)).toBe(97);
      expect(roundInchesForCode(38)).toBe(38);
    });
  });
});
