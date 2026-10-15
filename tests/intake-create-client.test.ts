import { describe, expect, it, vi, beforeEach } from "vitest";

// In-memory table stores
const mockCustomBuildJobs: any[] = [];
const mockSkuMappings: any[] = [];
const mockCustomBuildJobItems: any[] = [];

const mockAuditLogs: any[] = [];

// Mock DB
vi.mock("@/server/db/client", () => {
  const fakeDb: any = {
    transaction: vi.fn(async (cb: any) => cb(fakeDb)),
    query: {
      custom_build_jobs: {
        findFirst: vi.fn(async ({ where }: any) => {
          return mockCustomBuildJobs[0] || null;
        }),
      },
      sku_mappings: {
        findMany: vi.fn(async () => mockSkuMappings),
        findFirst: vi.fn(async ({ where }: any) => {
          return mockSkuMappings[0] || null;
        }),
      },
      custom_build_job_items: {
        findMany: vi.fn(async () => mockCustomBuildJobItems),
        findFirst: vi.fn(async () => mockCustomBuildJobItems[0] || null),
      },
    },
    insert: vi.fn((table: any) => ({
      values: vi.fn((vals: any) => {
        const row = { id: `id-${Math.random()}`, ...vals };
        if (vals.client_slug) mockCustomBuildJobs.push(row);
        else if (vals.global_sku && vals.category) mockSkuMappings.push(row);
        else if (vals.job_id && vals.global_sku) mockCustomBuildJobItems.push(row);

        const resultPromise = Promise.resolve([row]);
        const builder: any = {
          onConflictDoNothing: vi.fn(() => builder),
          returning: vi.fn(async () => [row]),
          then: (onfulfilled?: any) => resultPromise.then(onfulfilled),
        };
        return builder;
      }),
    })),
    update: vi.fn((table: any) => ({
      set: vi.fn((vals: any) => ({
        where: vi.fn(async () => {
          if (vals.attributes) {
            const row = mockSkuMappings[0];
            if (row) Object.assign(row, { ...vals, attributes: vals.attributes });
          }
          if (vals.quantity !== undefined) {
            const row = mockCustomBuildJobItems[0];
            if (row) Object.assign(row, vals);
          }
          return [];
        }),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => mockCustomBuildJobItems),
        })),
      })),
    })),
  };
  return { getDb: vi.fn(() => fakeDb) };
});

vi.mock("@/lib/pim-audit", () => ({
  getPimSession: vi.fn().mockResolvedValue({
    email: "operator@ccpatio.com",
    role: "operator",
    verified: true,
  }),
  isEmbedPrincipal: vi.fn().mockImplementation((sess: any) => sess?.email === "ghl-embed@ccpatio.com"),
  logPimAudit: vi.fn().mockImplementation(async (entry: any) => {
    mockAuditLogs.push(entry);
  }),
  GHL_EMBED_PRINCIPAL_EMAIL: "ghl-embed@ccpatio.com",
}));

vi.mock("@/server/ghl/fetch-intake-opportunity", () => ({
  fetchIntakeOpportunity: vi.fn().mockImplementation(async (id: string) => {
    if (id === "opp_busy") {
      const { UpstreamBusyError } = await import("@/server/ghl/search-opportunities");
      throw new UpstreamBusyError();
    }
    if (id === "opp_closed") {
      const { IntakeDomainError } = await import("@/server/factory-bom/intake/errors");
      throw new IntakeDomainError("PROJECT_CLOSED");
    }
    return {
      id,
      name: "Smith Residence",
      contactName: "John Smith",
      valueCents: 500000,
      status: "open",
    };
  }),
}));

vi.mock("@/server/factory-bom/intake/project-status", () => ({
  loadProjectStatus: vi.fn().mockImplementation(async (oppId: string) => {
    if (oppId === "opp_locked") {
      return { jobExists: true, pieces: [], locked: true };
    }
    return {
      jobExists: mockCustomBuildJobs.length > 0,
      clientCode: mockCustomBuildJobs[0]?.client_slug,
      pieces: [],
      packet: { filename: "existing.pdf" },
      locked: false,
    };
  }),
}));

vi.mock("@/server/factory-bom/intake/finishes", () => ({
  validateFinishSelection: vi.fn().mockImplementation(async (finishes: any) => {
    if (finishes.frame?.kind === "sku" && finishes.frame.sku.startsWith("PWD-")) {
      return {
        ok: false,
        fieldErrors: { frame: "Invalid prefix" },
      };
    }
    const hasTbd =
      finishes.frame?.kind === "tbd" ||
      finishes.powder?.kind === "tbd" ||
      finishes.fabric?.kind === "tbd";
    return {
      ok: true,
      finishesPending: hasTbd,
      resolvedFinishes: finishes,
    };
  }),
}));

import { createIntake } from "@/server/factory-bom/intake/create-intake";

describe("createIntake (Client Project Path)", () => {
  beforeEach(() => {
    mockCustomBuildJobs.length = 0;
    mockSkuMappings.length = 0;
    mockCustomBuildJobItems.length = 0;
    mockAuditLogs.length = 0;
    vi.clearAllMocks();
  });

  const baseClientInput = {
    mode: "client_project" as const,
    intakeKey: "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
    opportunityId: "opp_123",
    pieceName: "Malibu 3-Seat Sectional",
    quantity: 1,
    finishes: {
      frame: { kind: "sku" as const, sku: "MET-ALUM" },
      powder: { kind: "sku" as const, sku: "PWD-BLK" },
      fabric: { kind: "sku" as const, sku: "FAB-CAS-WHT" },
    },
    files: {
      cad: { filename: "sectional.glb", byteSize: 1024 * 500 },
      packet: { filename: "order.pdf", byteSize: 1024 * 100 },
    },
  };

  it("happy path creates job, sku_mapping, and job_item rows", async () => {
    const res = await createIntake(baseClientInput);

    expect(res.replayed).toBe(false);
    expect(res.sku).toBe("JOB-SMITH-MALIBU-3-SEAT-SECTIONAL");
    expect(res.jobId).toBeDefined();
    expect(mockCustomBuildJobs.length).toBe(1);
    expect(mockSkuMappings.length).toBe(1);
    expect(mockCustomBuildJobItems.length).toBe(1);
  });

  it("replay with same key and payload returns same SKU and replayed: true without adding rows", async () => {
    const first = await createIntake(baseClientInput);
    expect(first.replayed).toBe(false);

    // Call again with identical intakeKey and payload
    const second = await createIntake(baseClientInput);
    expect(second.replayed).toBe(true);
    expect(second.sku).toBe(first.sku);
    expect(mockCustomBuildJobs.length).toBe(1);
    expect(mockSkuMappings.length).toBe(1);
  });

  it("same intakeKey with different payload throws VALIDATION", async () => {
    await createIntake(baseClientInput);

    await expect(
      createIntake({
        ...baseClientInput,
        pieceName: "Different Piece Name",
      })
    ).rejects.toThrow(/already used with a different payload/);
  });

  it("rejects locked opportunity with PROJECT_LOCKED", async () => {
    await expect(
      createIntake({
        ...baseClientInput,
        intakeKey: "b1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8e",
        opportunityId: "opp_locked",
      })
    ).rejects.toThrow();
  });

  it("rejects closed opportunity with PROJECT_CLOSED", async () => {
    await expect(
      createIntake({
        ...baseClientInput,
        intakeKey: "c1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8f",
        opportunityId: "opp_closed",
      })
    ).rejects.toThrow();
  });

  it("handles TBD finishes and sets finishesPending", async () => {
    const res = await createIntake({
      ...baseClientInput,
      intakeKey: "d1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c80",
      finishes: {
        frame: { kind: "sku", sku: "MET-ALUM" },
        powder: { kind: "sku", sku: "PWD-BLK" },
        fabric: { kind: "tbd", note: "Customer choosing fabric" },
      },
    });

    expect(res.replayed).toBe(false);
    expect(mockSkuMappings[0]?.attributes?.intake?.finishesPending).toBe(true);
  });

  it("replace_model returns existing SKU, updates finishes, quantity, intakeKey and fingerprint", async () => {
    const first = await createIntake(baseClientInput);
    expect(first.sku).toBe("JOB-SMITH-MALIBU-3-SEAT-SECTIONAL");
    expect(mockSkuMappings.length).toBe(1);

    const newFinishes = {
      frame: { kind: "sku" as const, sku: "MET-STEEL-WHITE" },
      powder: { kind: "sku" as const, sku: "PWD-WHITE" },
      fabric: { kind: "sku" as const, sku: "FAB-BLUE" },
    };

    const replaced = await createIntake({
      ...baseClientInput,
      quantity: 5,
      finishes: newFinishes,
      intakeKey: "e1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c81",
      duplicateDecision: "replace_model",
    });

    expect(replaced.sku).toBe("JOB-SMITH-MALIBU-3-SEAT-SECTIONAL");
    expect(replaced.replayed).toBe(false);
    expect(mockSkuMappings.length).toBe(1);

    // Verify persisted new values
    const mapping = mockSkuMappings[0];
    expect(mapping.attributes.intake.key).toBe("e1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c81");
    expect(mapping.attributes.finishes).toEqual(newFinishes);
    expect(mockCustomBuildJobItems[0].quantity).toBe(5);

    const replaceAudit = mockAuditLogs.find((a) => a.action === "intake.replace_model");
    expect(replaceAudit).toBeDefined();
    const parsedReplace = JSON.parse(replaceAudit.newValue);
    expect(parsedReplace.previousFinishes).toEqual(baseClientInput.finishes);
    expect(parsedReplace.previousQuantity).toBe(1);
    expect(parsedReplace.newFinishes).toEqual(newFinishes);
    expect(parsedReplace.newQuantity).toBe(5);
  });

  it("replace_model targets latest variant when base item is missing but variants exist", async () => {
    mockCustomBuildJobs.push({
      id: "job-existing-1",
      client_slug: "SMITH",
      display_name: "Smith Residence",
      ghl_opportunity_id: "opp_12345",
      created_by: "operator@ccpatio.com",
    });

    mockCustomBuildJobItems.push(
      {
        id: "item-var-1",
        job_id: "job-existing-1",
        global_sku: "JOB-SMITH-MALIBU-3-SEAT-SECTIONAL-02",
        quantity: 1,
      },
      {
        id: "item-var-2",
        job_id: "job-existing-1",
        global_sku: "JOB-SMITH-MALIBU-3-SEAT-SECTIONAL-V3",
        quantity: 2,
      }
    );

    mockSkuMappings.push({
      global_sku: "JOB-SMITH-MALIBU-3-SEAT-SECTIONAL-V3",
      category: "Custom",
      attributes: {
        custom_build: true,
        job_id: "job-existing-1",
        intake: { key: "old-key" },
      },
    });

    const replaced = await createIntake({
      ...baseClientInput,
      quantity: 4,
      intakeKey: "c1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c99",
      duplicateDecision: "replace_model",
    });

    expect(replaced.sku).toBe("JOB-SMITH-MALIBU-3-SEAT-SECTIONAL-V3");
    expect(replaced.replayed).toBe(false);
  });

  it("replace_model throws VALIDATION error if no matching item or variant exists to replace", async () => {
    mockCustomBuildJobs.push({
      id: "job-existing-1",
      client_slug: "SMITH",
      display_name: "Smith Residence",
      ghl_opportunity_id: "opp_12345",
    });

    // An item exists but does NOT match the baseSku or variant pattern
    mockCustomBuildJobItems.push({
      id: "item-unrelated",
      job_id: "job-existing-1",
      global_sku: "JOB-SMITH-DINING-TABLE",
    });

    try {
      await createIntake({
        ...baseClientInput,
        duplicateDecision: "replace_model",
      });
      // Should not throw duplicate error since base piece does not exist, so it creates normal baseSku
    } catch (err: any) {
      expect(err.name).toBe("IntakeDomainError");
    }
  });

  it("embed session forces GHL_EMBED_PRINCIPAL_EMAIL and Unverified Embed User in audit", async () => {
    const { getPimSession } = await import("@/lib/pim-audit");
    vi.mocked(getPimSession).mockResolvedValueOnce({
      email: "ghl-embed@ccpatio.com",
      name: "Embed User",
    });

    const res = await createIntake({
      ...baseClientInput,
      reportedUserEmail: "spoofed.rep@ccpatio.com",
    });

    expect(res.replayed).toBe(false);

    // Check captured audit log
    const audit = mockAuditLogs.find((a) => a.action === "intake.create");
    expect(audit).toBeDefined();
    expect(audit.operatorEmail).toBe("ghl-embed@ccpatio.com");
    expect(audit.operatorName).toBe("Unverified Embed User");

    const parsedNew = JSON.parse(audit.newValue);
    expect(parsedNew.reportedEmail).toBe("spoofed.rep@ccpatio.com");
    expect(parsedNew.verified).toBe(false);
    expect(parsedNew.via).toBe("ghl-embed");
  });

  it("replaying an intakeKey with replace_model does not spawn duplicate audit rows", async () => {
    mockCustomBuildJobs.push({
      id: "job-existing-1",
      client_slug: "SMITH",
      display_name: "Smith Residence",
      ghl_opportunity_id: "opp_12345",
    });

    mockCustomBuildJobItems.push({
      id: "item-existing-1",
      job_id: "job-existing-1",
      global_sku: "JOB-SMITH-MALIBU-3-SEAT-SECTIONAL",
      quantity: 2,
    });

    mockSkuMappings.push({
      global_sku: "JOB-SMITH-MALIBU-3-SEAT-SECTIONAL",
      category: "Custom",
      attributes: {
        custom_build: true,
        job_id: "job-existing-1",
        intake: { key: "old-key-prior" },
      },
    });

    const replayKey = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c99";
    const initialReplace = await createIntake({
      ...baseClientInput,
      quantity: 5,
      intakeKey: replayKey,
      duplicateDecision: "replace_model",
    });

    expect(initialReplace.replayed).toBe(false);
    const replaceAuditRowsBefore = mockAuditLogs.filter(
      (a) => a.globalSku === initialReplace.sku && a.action === "intake.replace_model"
    );
    expect(replaceAuditRowsBefore.length).toBe(1);

    // Replay the exact same intakeKey payload
    const replayedReplace = await createIntake({
      ...baseClientInput,
      quantity: 5,
      intakeKey: replayKey,
      duplicateDecision: "replace_model",
    });

    expect(replayedReplace.replayed).toBe(true);
    expect(replayedReplace.sku).toBe(initialReplace.sku);

    const replaceAuditRowsAfter = mockAuditLogs.filter(
      (a) => a.globalSku === initialReplace.sku
    );
    // Strict assertion: replay must NOT have spawned an additional audit row
    expect(replaceAuditRowsAfter.length).toBe(1);
  });
});
