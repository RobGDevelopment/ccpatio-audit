import { describe, expect, it } from "vitest";
import { RM_FAB_GENERIC } from "@/lib/heuristic-bom";
import {
  fabricYardsFromEdges,
  nextHoldQuantity,
  type YardageEdge,
} from "@/server/ghl/fabric-yardage";
import { isProduceFactoryOrderStage } from "@/server/ghl/factory-stage";
import {
  parseGhlFactoryOpportunity,
  readGhlOpportunityRelease,
} from "@/server/ghl/factory-order.schema";

const cushion: YardageEdge[] = [
  { parentSku: "FIN-CHAIR", childSku: "SA-CUSH", quantity: 2, scrapFactor: 1 },
  { parentSku: "SA-CUSH", childSku: "FAB-CAS-WHI", quantity: 5, scrapFactor: 1.1 },
];

describe("fabricYardsFromEdges", () => {
  it("multiplies quantity, scrap, and the finished-good count", () => {
    const result = fabricYardsFromEdges(
      [{ finSku: "FIN-CHAIR", fabricSku: "FAB-CAS-WHI", quantity: 2 }],
      cushion,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.byFabric.get("FAB-CAS-WHI")).toBe(22);
  });

  it("counts the generic fabric placeholder toward the selected FAB", () => {
    const result = fabricYardsFromEdges(
      [{ finSku: "FIN-CHAIR", fabricSku: "FAB-CAS-WHI", quantity: 1 }],
      [
        {
          parentSku: "FIN-CHAIR",
          childSku: RM_FAB_GENERIC,
          quantity: 10,
          scrapFactor: 1,
        },
      ],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.byFabric.get("FAB-CAS-WHI")).toBe(10);
  });

  it("refuses a fabric the staff did not select", () => {
    const result = fabricYardsFromEdges(
      [{ finSku: "FIN-CHAIR", fabricSku: "FAB-CAS-WHI", quantity: 1 }],
      [
        { parentSku: "FIN-CHAIR", childSku: "FAB-OTHER", quantity: 4, scrapFactor: 1 },
      ],
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a finished good with no fabric yardage", () => {
    const result = fabricYardsFromEdges(
      [{ finSku: "FIN-CHAIR", fabricSku: "FAB-CAS-WHI", quantity: 1 }],
      [{ parentSku: "FIN-CHAIR", childSku: "RM-RAW-FOAM", quantity: 1, scrapFactor: 1 }],
    );
    expect(result.ok).toBe(false);
  });
});

describe("nextHoldQuantity", () => {
  it("patches a positive remainder", () => {
    expect(nextHoldQuantity(10, 4)).toEqual({ action: "patch", quantity: 6 });
  });

  it("deletes the hold line when the remainder is zero", () => {
    expect(nextHoldQuantity(10, 10)).toEqual({ action: "delete" });
  });

  it("refuses a relief that would go negative", () => {
    const decision = nextHoldQuantity(10, 22);
    expect(decision.action).toBe("refuse");
  });
});

describe("Produce Factory Order stage", () => {
  it("matches the stage name and an allow-listed id only", () => {
    expect(
      isProduceFactoryOrderStage({ stageName: "Produce Factory Order" }, []),
    ).toBe(true);
    expect(
      isProduceFactoryOrderStage({ pipelineStageId: "stage-1" }, ["stage-1"]),
    ).toBe(true);
    expect(
      isProduceFactoryOrderStage({ stageName: "Won", pipelineStageId: "other" }, ["stage-1"]),
    ).toBe(false);
  });

  it("requires an opportunity id and a stage", () => {
    const missing = parseGhlFactoryOpportunity({ id: "opp-1" });
    expect(missing.ok).toBe(false);
    const parsed = parseGhlFactoryOpportunity({
      opportunity: { id: "opp-9", pipelineStageName: "Produce Factory Order" },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.id).toBe("opp-9");
    expect(parsed.data.stage_name).toBe("Produce Factory Order");
  });
});

describe("Lost and Abandoned release signal", () => {
  it("reads lost without a stage", () => {
    expect(
      readGhlOpportunityRelease({
        opportunity: { id: "opp-lost", status: "Lost" },
      }),
    ).toEqual({ opportunityId: "opp-lost", status: "lost" });
    const parsed = parseGhlFactoryOpportunity({
      opportunity: { id: "opp-lost", status: "Lost" },
    });
    expect(parsed.ok).toBe(false);
  });

  it("reads abandoned from the root envelope", () => {
    expect(
      readGhlOpportunityRelease({
        opportunity_id: "opp-ab",
        status: "abandoned",
        pipelineStageName: "Produce Factory Order",
      }),
    ).toEqual({ opportunityId: "opp-ab", status: "abandoned" });
  });

  it("leaves won and open for the factory stage check", () => {
    expect(
      readGhlOpportunityRelease({
        id: "opp-won",
        status: "won",
        stage_name: "Produce Factory Order",
      }),
    ).toBeNull();
    expect(readGhlOpportunityRelease({ id: "opp-open", status: "open" })).toBeNull();
  });

  it("ignores a release status with no opportunity id", () => {
    expect(readGhlOpportunityRelease({ status: "lost" })).toBeNull();
  });
});
