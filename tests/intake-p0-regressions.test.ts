// @vitest-environment jsdom
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { UploadProgress } from "@/app/embed/factory-bom/intake/UploadProgress";

vi.mock("@/lib/pim-audit", () => ({
  getPimSession: vi.fn().mockResolvedValue({
    email: "operator@ccpatio.com",
    role: "operator",
    verified: true,
  }),
  isEmbedPrincipal: vi.fn().mockImplementation((sess: any) => sess?.email === "ghl-embed@ccpatio.com"),
  logPimAudit: vi.fn().mockResolvedValue(undefined),
  GHL_EMBED_PRINCIPAL_EMAIL: "ghl-embed@ccpatio.com",
}));

// Mock DB client for unit-level action testing
const mockSkuMappings: any[] = [];
const mockCustomJobs: any[] = [];

vi.mock("@/server/db/client", () => ({
  getDb: vi.fn(() => ({
    query: {
      sku_mappings: {
        findMany: vi.fn().mockImplementation(async () => mockSkuMappings),
        findFirst: vi.fn().mockImplementation(async () => mockSkuMappings[0]),
      },
      custom_build_jobs: {
        findFirst: vi.fn().mockImplementation(async () => mockCustomJobs[0]),
      },
      finished_goods_catalog: {
        findFirst: vi.fn().mockImplementation(async () => null),
      },
      custom_build_job_items: {
        findFirst: vi.fn().mockImplementation(async () => null),
      },
    },
    insert: vi.fn((table: any) => ({
      values: vi.fn((vals: any) => ({
        returning: vi.fn(async () => {
          const row = { id: "job-uuid-1", ...vals };
          mockCustomJobs.push(row);
          return [row];
        }),
        then: vi.fn(async (cb?: any) => {
          const row = { id: "sku-uuid-1", ...vals };
          mockSkuMappings.push(row);
          return cb ? cb([row]) : [row];
        }),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => {
        const queryObj: any = {
          where: vi.fn(() => queryObj),
          orderBy: vi.fn(() => queryObj),
          limit: vi.fn(async () => mockSkuMappings),
          then: vi.fn((resolve: any) => resolve(mockSkuMappings)),
        };
        return queryObj;
      }),
    })),
  })),
}));

let mockProgressHandler: ((...args: any[]) => any) | null = null;
vi.mock("@/app/embed/factory-bom/actions", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getIntakeProgressAction: vi.fn(async (...args: any[]) => {
      if (mockProgressHandler) {
        return mockProgressHandler(...args);
      }
      return actual.getIntakeProgressAction(...args);
    }),
  };
});

import { beginAirlockIntake } from "@/app/admin/factory-bom/actions";
import { mintCustomJob } from "@/server/factory-bom/mint-custom-job";

describe("P0 Regressions Suite (D1, D2, D3)", () => {
  beforeEach(() => {
    mockSkuMappings.length = 0;
    mockCustomJobs.length = 0;
    mockProgressHandler = null;
    vi.clearAllMocks();
  });

  describe("Task 1: P0-A (D1) - intake call passes correct arguments", () => {
    it("D1: beginAirlockIntake succeeds and does not pass forceRecreate as dbTx", async () => {
      const res = await beginAirlockIntake({
        mode: "custom_build",
        clientSlug: "SMITH",
        itemSlug: "SOFA",
        ghlOpportunityId: "opp-123",
      });

      expect(res.ok).toBe(true);
      expect((res as any).sku).toBe("JOB-SMITH-SOFA");
    });

    it("D1: thrown internal error returns friendly message without leaking raw error text", async () => {
      const res = await beginAirlockIntake({
        mode: "custom_build",
        clientSlug: "FIN-INVALID",
        itemSlug: "SOFA",
        ghlOpportunityId: "opp-123",
      });

      expect(res.ok).toBe(false);
      expect((res as any).ref).toBeDefined();
      expect((res as any).error).toBeDefined();
    });
  });

  describe("Task 2: P0-B (D2) - loadIntakeSubject loads non-vividworks products", () => {
    it("D2: loadIntakeSubject returns a row for a newly minted piece", async () => {
      const { loadIntakeSubject } = await import("@/server/factory-bom/intake/load-subject");
      
      mockSkuMappings.push({
        global_sku: "JOB-SMITH-SOFA",
        original_name: "Smith Custom Sofa",
        source_file: "factory-bom-intake",
        category: "Custom",
        item_type: "finished_good",
        attributes: {
          custom_build: true,
          job_id: "job-123",
        },
      });

      const subject = await loadIntakeSubject("JOB-SMITH-SOFA");
      expect(subject).toBeDefined();
      expect(subject?.sku).toBe("JOB-SMITH-SOFA");
      expect(subject?.name).toBe("Smith Custom Sofa");
      expect(subject?.sourceFile).toBe("factory-bom-intake");
    });
  });

  describe("Task 3: P0-C (D3) - custom job without a project is rejected", () => {
    it("D3: beginAirlockIntake without ghlOpportunityId fails with PROJECT_REQUIRED", async () => {
      const res = await beginAirlockIntake({
        mode: "custom_build",
        clientSlug: "SMITH",
        itemSlug: "SOFA",
      });

      expect(res.ok).toBe(false);
      expect((res as any).code).toBe("PROJECT_REQUIRED");
      expect((res as any).error).toBe("Choose the client project first.");
      expect(mockCustomJobs.length).toBe(0);
      expect(mockSkuMappings.length).toBe(0);
    });

    it("D3: mintCustomJob without ghlOpportunityId throws typed error", async () => {
      await expect(
        mintCustomJob({
          clientSlug: "SMITH",
          itemSlug: "SOFA",
          displayName: "Smith Sofa",
          createdBy: "operator@ccpatio.com",
        })
      ).rejects.toThrow(/ghlOpportunityId|client project/i);
    });
  });

  describe("Task 4: P0-D (D1, D5) - Upload progress polling failure resilience", () => {
    it("getIntakeProgressAction returns NOT_SIGNED_IN if no session", async () => {
      const { getIntakeProgressAction } = await import("@/app/embed/factory-bom/actions");
      const { getPimSession } = await import("@/lib/pim-audit");
      vi.mocked(getPimSession).mockResolvedValueOnce(null);

      const res = await getIntakeProgressAction({ sku: "JOB-SMITH-CHAIR" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("NOT_SIGNED_IN");
      }
    });

    it("getIntakeProgressAction returns piece not found when sku does not exist", async () => {
      const { getIntakeProgressAction } = await import("@/app/embed/factory-bom/actions");

      const res = await getIntakeProgressAction({ sku: "JOB-MISSING-PIECE" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("VALIDATION");
        expect(res.message).toContain("Piece not found");
      }
    });

    it("UploadProgress: 3 consecutive poll failures trigger 'Upload paused' banner in DOM", async () => {
      vi.useFakeTimers();
      try {
        mockProgressHandler = vi.fn().mockResolvedValue({
          ok: false,
          code: "INTERNAL",
          message: "Upstream service down",
        });

        render(React.createElement(UploadProgress, { sku: "JOB-FAILS-3X", stage: "waiting" }));

        // Advance 2000ms for 1st failure
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2000);
        });
        expect(screen.queryByText("Upload paused")).toBeNull();
        expect(mockProgressHandler).toHaveBeenCalledTimes(1);

        // Advance 2000ms for 2nd failure
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2000);
        });
        expect(screen.queryByText("Upload paused")).toBeNull();
        expect(mockProgressHandler).toHaveBeenCalledTimes(2);

        // Advance 2000ms for 3rd failure
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2000);
        });
        expect(mockProgressHandler).toHaveBeenCalledTimes(3);

        // Assert that the 'Upload paused' banner renders in the actual DOM
        expect(screen.getByText("Upload paused")).toBeDefined();
        expect(screen.getByText("Upstream service down")).toBeDefined();
      } finally {
        vi.useRealTimers();
        mockProgressHandler = null;
      }
    });

    it("UploadProgress: re-rendering with new onComplete prop does not reset polling timer schedule", async () => {
      vi.useFakeTimers();
      try {
        const initialOnComplete = vi.fn();
        const updatedOnComplete = vi.fn();

        mockProgressHandler = vi.fn().mockResolvedValue({
          ok: true,
          data: {
            cadUpload: { status: "draft_ready" },
            hasPacket: false,
          },
        });

        const { rerender } = render(
          React.createElement(UploadProgress, {
            sku: "JOB-TIMER-TEST",
            stage: "waiting",
            onComplete: initialOnComplete,
          })
        );

        // Advance 1000ms (halfway through the 2000ms polling interval)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
        // Has not fired yet
        expect(mockProgressHandler).toHaveBeenCalledTimes(0);

        // Re-render with new onComplete callback reference
        rerender(
          React.createElement(UploadProgress, {
            sku: "JOB-TIMER-TEST",
            stage: "waiting",
            onComplete: updatedOnComplete,
          })
        );

        // If the timer reset on prop change, advancing 1000ms would NOT trigger poll.
        // Because the timer schedule is decoupled from onComplete, advancing the remaining 1000ms fires the original timer.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });

        expect(mockProgressHandler).toHaveBeenCalledTimes(1);
        expect(initialOnComplete).not.toHaveBeenCalled();
        expect(updatedOnComplete).toHaveBeenCalledTimes(1);
        expect(screen.getByText("Your piece is ready!")).toBeDefined();
      } finally {
        vi.useRealTimers();
        mockProgressHandler = null;
      }
    });
  });
});
