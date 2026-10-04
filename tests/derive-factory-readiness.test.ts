import { describe, expect, it } from "vitest";
import {
  buildFactoryEvidence,
  deriveFactoryReadiness,
  relatedParents,
  type FactoryEvidence,
  type FactoryEvidenceSources,
} from "@/server/factory-bom/derive-readiness";

const none: FactoryEvidence = {
  liveRecipe: false,
  draftStatuses: [],
  latestDae: null,
  katanaStatus: null,
  recipePublished: false,
};
const ev = (o: Partial<FactoryEvidence>): FactoryEvidence => ({ ...none, ...o });

describe("deriveFactoryReadiness — precedence", () => {
  it("1. Published: live recipe + katana success + audit row", () => {
    const r = deriveFactoryReadiness(
      ev({ liveRecipe: true, katanaStatus: "success", recipePublished: true }),
    );
    expect(r.state).toBe("published");
    expect(r.sublabel).toBeNull();
  });

  it("2. Factory approved: live recipe, nothing else", () => {
    const r = deriveFactoryReadiness(ev({ liveRecipe: true }));
    expect(r.state).toBe("factory_approved");
    expect(r.sublabel).toBeNull();
  });

  it("2. Factory approved beats drafts and CAD", () => {
    const r = deriveFactoryReadiness(
      ev({
        liveRecipe: true,
        draftStatuses: ["edited"],
        latestDae: { status: "processing", filename: "a.dae" },
      }),
    );
    expect(r.state).toBe("factory_approved");
  });

  it("3. Draft pending: draft lines, no live recipe", () => {
    const r = deriveFactoryReadiness(ev({ draftStatuses: ["draft_pending_review"] }));
    expect(r.state).toBe("draft_pending");
    expect(r.sublabel).toBe("Auto-generated");
  });

  it("4. Missing CAD: no evidence at all", () => {
    const r = deriveFactoryReadiness(none);
    expect(r.state).toBe("missing_cad");
    expect(r.sublabel).toBeNull();
  });
});

describe("deriveFactoryReadiness — sublabels", () => {
  it("Draft + edited rollup → Edited", () => {
    expect(
      deriveFactoryReadiness(ev({ draftStatuses: ["factory_approved", "edited"] })).sublabel,
    ).toBe("Edited");
  });

  it.each(["uploaded", "queued", "processing", "draft_ready"] as const)(
    "in-flight CAD (%s) with no draft lines → Draft pending / Extracting",
    (status) => {
      const r = deriveFactoryReadiness(
        ev({ latestDae: { status, filename: "x.dae" } }),
      );
      expect(r.state).toBe("draft_pending");
      expect(r.sublabel).toBe("Extracting");
    },
  );

  it("failed .dae with no drafts and no live recipe → Missing CAD / Extract failed", () => {
    const r = deriveFactoryReadiness(
      ev({ latestDae: { status: "failed", filename: "bad.dae" } }),
    );
    expect(r.state).toBe("missing_cad");
    expect(r.sublabel).toBe("Extract failed");
  });

  it("failed .dae but draft lines exist → still Draft pending", () => {
    const r = deriveFactoryReadiness(
      ev({
        draftStatuses: ["draft_pending_review"],
        latestDae: { status: "failed", filename: "bad.dae" },
      }),
    );
    expect(r.state).toBe("draft_pending");
  });

  it("Factory approved + katana pending / failed", () => {
    expect(
      deriveFactoryReadiness(ev({ liveRecipe: true, katanaStatus: "pending" })).sublabel,
    ).toBe("Katana pending");
    expect(
      deriveFactoryReadiness(ev({ liveRecipe: true, katanaStatus: "failed" })).sublabel,
    ).toBe("Katana failed");
  });
});

describe("deriveFactoryReadiness — shell-sync false greens", () => {
  it("live recipe + katana success but NO audit row → Factory approved / Recipe not published", () => {
    const r = deriveFactoryReadiness(
      ev({ liveRecipe: true, katanaStatus: "success", recipePublished: false }),
    );
    expect(r.state).toBe("factory_approved");
    expect(r.sublabel).toBe("Recipe not published");
  });

  it("katana success + audit row but NO live recipe is not Published", () => {
    const r = deriveFactoryReadiness(
      ev({ katanaStatus: "success", recipePublished: true }),
    );
    expect(r.state).toBe("missing_cad");
  });

  it("katana success alone (product-shell publish) is not Published", () => {
    const r = deriveFactoryReadiness(ev({ katanaStatus: "success" }));
    expect(r.state).toBe("missing_cad");
  });
});

describe("relatedParents", () => {
  it("includes the SKU plus ASM/SA FRAME and CUSH parents", () => {
    const p = relatedParents("FIN-BRV-SOF-72X34");
    expect(p).toContain("FIN-BRV-SOF-72X34");
    expect(p).toContain("ASM-BRV-SOF-72X34-FRAME");
    expect(p).toContain("ASM-BRV-SOF-72X34-CUSH");
    expect(p).toContain("SA-BRV-SOF-72X34-FRAME");
    expect(p).toContain("SA-BRV-SOF-72X34-CUSH");
  });
});

describe("buildFactoryEvidence", () => {
  const base: FactoryEvidenceSources = {
    cadRows: [],
    draftRows: [],
    liveParents: [],
    katanaRows: [],
    auditSkus: [],
  };
  const SKU = "FIN-BRV-SOF-72X34";

  it("shared parent rollup: an edited cushion draft wins over an approved frame draft", () => {
    const map = buildFactoryEvidence([SKU], {
      ...base,
      draftRows: [
        { parent_sku: "ASM-BRV-SOF-72X34-FRAME", status: "factory_approved" },
        { parent_sku: "SA-BRV-SOF-72X34-CUSH", status: "edited" },
      ],
    });
    const r = deriveFactoryReadiness(map.get(SKU)!);
    expect(r.state).toBe("draft_pending");
    expect(r.draftRollup).toBe("edited");
    expect(r.sublabel).toBe("Edited");
  });

  it("a recipe living only on the frame sub-assembly counts as a live recipe", () => {
    const map = buildFactoryEvidence([SKU], {
      ...base,
      liveParents: ["ASM-BRV-SOF-72X34-FRAME"],
    });
    expect(deriveFactoryReadiness(map.get(SKU)!).state).toBe("factory_approved");
  });

  it(".skp uploads are ignored — only .dae counts as CAD", () => {
    const map = buildFactoryEvidence([SKU], {
      ...base,
      cadRows: [
        {
          global_sku: SKU,
          ext: "skp",
          status: "processing",
          original_filename: "thumb.skp",
          created_at: new Date("2026-01-02"),
        },
      ],
    });
    const r = deriveFactoryReadiness(map.get(SKU)!);
    expect(map.get(SKU)!.latestDae).toBeNull();
    expect(r.state).toBe("missing_cad");
  });

  it("uses the NEWEST .dae (a newer failure supersedes an older success)", () => {
    const map = buildFactoryEvidence([SKU], {
      ...base,
      cadRows: [
        {
          global_sku: SKU,
          ext: "dae",
          status: "draft_ready",
          original_filename: "old.dae",
          created_at: new Date("2026-01-01"),
        },
        {
          global_sku: SKU,
          ext: ".DAE",
          status: "failed",
          original_filename: "new.dae",
          created_at: new Date("2026-02-01"),
        },
      ],
    });
    const ev1 = map.get(SKU)!;
    expect(ev1.latestDae).toEqual({ status: "failed", filename: "new.dae" });
    expect(deriveFactoryReadiness(ev1).sublabel).toBe("Extract failed");
  });

  it("scopes evidence per hub SKU (no cross-talk) and dedupes the SKU list", () => {
    const other = "FIN-OCN-COF-TAB-42X42";
    const map = buildFactoryEvidence([SKU, other, SKU], {
      ...base,
      liveParents: [SKU],
      katanaRows: [{ global_sku: SKU, status: "success" }],
      auditSkus: [SKU],
    });
    expect(map.size).toBe(2);
    expect(deriveFactoryReadiness(map.get(SKU)!).state).toBe("published");
    expect(deriveFactoryReadiness(map.get(other)!).state).toBe("missing_cad");
  });
});
