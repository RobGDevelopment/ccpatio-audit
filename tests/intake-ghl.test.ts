import { describe, expect, it, vi } from "vitest";
import mockFixture from "./fixtures/ghl-opportunity-search.mock.json";
import { searchOpportunities, UpstreamBusyError } from "@/server/ghl/search-opportunities";
import { fetchIntakeOpportunity } from "@/server/ghl/fetch-intake-opportunity";
import { IntakeDomainError } from "@/server/factory-bom/intake/errors";

describe("GHL Search & Fetch Opportunities (searchOpportunities, fetchIntakeOpportunity)", () => {
  describe("searchOpportunities", () => {
    it("returns empty results for queries under 2 characters without calling upstream", async () => {
      const mockGet = vi.fn();
      const results = await searchOpportunities("a", { getGhl: mockGet });
      expect(results).toEqual([]);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("makes at most 2 upstream calls (open + won) and maps fields correctly with cents conversion", async () => {
      const mockGet = vi.fn().mockImplementation(async (path: string) => {
        if (path.includes("status=open")) {
          return {
            ok: true,
            status: 200,
            body: {
              opportunities: [
                {
                  id: "opp_1",
                  name: "Smith Residence",
                  contactName: "John Smith",
                  monetaryValue: 48200,
                },
              ],
            },
          };
        }
        return {
          ok: true,
          status: 200,
          body: {
            opportunities: [
              {
                id: "opp_2",
                name: "Villa Pool Deck",
                contact: { name: "Sarah Connor" },
                monetaryValue: 1250.5,
              },
            ],
          },
        };
      });

      const results = await searchOpportunities("Smith", {
        getGhl: mockGet,
        locationId: "loc_test_123",
      });

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(2);

      // Verify cents conversion
      const smith = results.find((r) => r.id === "opp_1");
      expect(smith?.valueCents).toBe(4820000);
      expect(smith?.contactName).toBe("John Smith");

      const sarah = results.find((r) => r.id === "opp_2");
      expect(sarah?.valueCents).toBe(125050);
      expect(sarah?.contactName).toBe("Sarah Connor");
    });

    it("handles null or non-finite monetaryValue by setting valueCents to null", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          opportunities: [
            {
              id: "opp_null_val",
              name: "No Value Deal",
              contactName: "Bob",
              monetaryValue: null,
            },
            {
              id: "opp_nan_val",
              name: "Bad Value Deal",
              contactName: "Alice",
              monetaryValue: "invalid",
            },
          ],
        },
      });

      const results = await searchOpportunities("Deal", {
        getGhl: mockGet,
        locationId: "loc_test",
      });

      expect(results[0]?.valueCents).toBeNull();
      expect(results[1]?.valueCents).toBeNull();
    });

    it("throws UpstreamBusyError on GHL 500, timeout, or bad response without leaking upstream error", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        error: "Internal Error: upstream backend database failure in cluster us-east-1",
      });

      await expect(
        searchOpportunities("Smith", { getGhl: mockGet, locationId: "loc_test" })
      ).rejects.toThrow(UpstreamBusyError);

      try {
        await searchOpportunities("Smith", { getGhl: mockGet, locationId: "loc_test" });
      } catch (err: any) {
        expect(err.message).not.toContain("cluster us-east-1");
        expect(err.message).toBe("GoHighLevel is busy. Try again in a moment.");
      }
    });
  });

  describe("fetchIntakeOpportunity", () => {
    it("fetches single opportunity and verifies location and status", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          opportunity: {
            id: "opp_123",
            name: "Smith Residence",
            contactName: "John Smith",
            monetaryValue: 5000,
            status: "open",
            locationId: "loc_test",
          },
        },
      });

      const opp = await fetchIntakeOpportunity("opp_123", {
        getGhl: mockGet,
        locationId: "loc_test",
      });

      expect(opp.id).toBe("opp_123");
      expect(opp.status).toBe("open");
      expect(opp.valueCents).toBe(500000);
    });

    it("rejects closed/lost opportunities with PROJECT_CLOSED", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          opportunity: {
            id: "opp_lost",
            name: "Lost Deal",
            status: "lost",
            locationId: "loc_test",
          },
        },
      });

      await expect(
        fetchIntakeOpportunity("opp_lost", { getGhl: mockGet, locationId: "loc_test" })
      ).rejects.toThrow(IntakeDomainError);
    });

    it("rejects foreign location opportunities", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          opportunity: {
            id: "opp_foreign",
            name: "Foreign Deal",
            status: "open",
            locationId: "other_location",
          },
        },
      });

      await expect(
        fetchIntakeOpportunity("opp_foreign", { getGhl: mockGet, locationId: "loc_test" })
      ).rejects.toThrow(IntakeDomainError);
    });
  });
});
