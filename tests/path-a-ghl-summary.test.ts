import { describe, expect, it } from "vitest";
import {
  buildGhlOpportunitySummary,
  formatSagaStateLabel,
  MAX_GHL_SUMMARY_LENGTH,
} from "@/server/path-a/ghl-summary";

describe("Path A GHL Summary Builder (Task 8.1)", () => {
  it("formats saga state labels correctly", () => {
    expect(formatSagaStateLabel("AWAITING_DEPOSIT")).toBe("AWAITING DEPOSIT");
    expect(formatSagaStateLabel("COMPLETED")).toBe("RELEASED TO PRODUCTION");
    expect(formatSagaStateLabel("IN_PROGRESS")).toBe("RELEASING TO PRODUCTION");
    expect(formatSagaStateLabel("FAILED")).toBe("MANUAL REVIEW REQUIRED");
    expect(formatSagaStateLabel("PENDING")).toBe("DESIGNING");
  });

  it("produces deterministic, sorted output for multiple SKUs and BOM lines", () => {
    const summary = buildGhlOpportunitySummary({
      opportunityId: "opp-xyz-100",
      opportunityName: "Luxury Cabana",
      sagaStatus: "AWAITING_DEPOSIT",
      items: [
        {
          globalSku: "JOB-CABANA-POST",
          quantity: 4,
          displayName: "Corner Post 4x4",
          status: "finalized",
          finalizedDossierHash: "dossier-sha-post-12345",
          bomLines: [
            { childSku: "RM-TUBE-ALUM-4X4", quantity: "8.5", unitOfMeasure: "ft" },
            { childSku: "RM-CAP-PLASTIC-4X4", quantity: "1", unitOfMeasure: "ea" },
          ],
        },
        {
          globalSku: "JOB-CABANA-BEAM",
          quantity: 2,
          displayName: "Cross Beam 2x6",
          status: "finalized",
          finalizedDossierHash: "dossier-sha-beam-67890",
          bomLines: [
            { childSku: "RM-TUBE-ALUM-2X6", quantity: "12.0", unitOfMeasure: "ft" },
          ],
        },
      ],
      appUrl: "https://app.ccpatio.com",
    });

    expect(summary).toContain("=== CC CUSTOM BUILD SUMMARY ===");
    expect(summary).toContain("Opportunity: Luxury Cabana");
    expect(summary).toContain("Status: AWAITING DEPOSIT");
    expect(summary).toContain("Dashboard: https://app.ccpatio.com/admin/path-a?opp=opp-xyz-100");

    // Check alphabetical sort: BEAM before POST
    const beamIndex = summary.indexOf("JOB-CABANA-BEAM");
    const postIndex = summary.indexOf("JOB-CABANA-POST");
    expect(beamIndex).toBeLessThan(postIndex);

    // Check BOM lines sort: CAP before TUBE
    const capIndex = summary.indexOf("RM-CAP-PLASTIC-4X4");
    const tubeIndex = summary.indexOf("RM-TUBE-ALUM-4X4");
    expect(capIndex).toBeLessThan(tubeIndex);

    // Verify no secret, token, or cut-card URL exists in summary
    expect(summary).not.toContain("cut-cards");
    expect(summary).not.toContain("token");
    expect(summary).not.toContain("secret");
  });

  it("includes Katana Order No and MO IDs when present", () => {
    const summary = buildGhlOpportunitySummary({
      opportunityId: "opp-released-1",
      opportunityName: "Pergola",
      sagaStatus: "COMPLETED",
      katanaOrderNo: "PA-opp-released-1",
      katanaMoIds: [501, 502],
      items: [
        {
          globalSku: "JOB-PERGOLA",
          quantity: 1,
          status: "released",
        },
      ],
    });

    expect(summary).toContain("Katana Order: PA-opp-released-1");
    expect(summary).toContain("Katana MOs: 501, 502");
    expect(summary).toContain("Status: RELEASED TO PRODUCTION");
  });

  it("enforces length cap and appends truncation marker if summary exceeds MAX_GHL_SUMMARY_LENGTH", () => {
    const hugeBomLines = Array.from({ length: 200 }, (_, i) => ({
      childSku: `RM-MATERIAL-LONG-SKU-NAME-NUMBER-${i.toString().padStart(4, "0")}`,
      quantity: "10.5000",
      unitOfMeasure: "inches",
    }));

    const summary = buildGhlOpportunitySummary({
      opportunityId: "opp-huge",
      opportunityName: "Very Large Custom Pergola Project with Lots of Items",
      sagaStatus: "AWAITING_DEPOSIT",
      items: [
        {
          globalSku: "JOB-HUGE-PROJECT",
          quantity: 1,
          status: "finalized",
          bomLines: hugeBomLines,
        },
      ],
    });

    expect(summary.length).toBeLessThanOrEqual(MAX_GHL_SUMMARY_LENGTH);
    expect(summary).toContain("... [truncated, see MDM: https://app.ccpatio.com/admin/path-a?opp=opp-huge]");
  });
});
