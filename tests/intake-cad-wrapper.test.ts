import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCadUploads: any[] = [];
let mockAdminRequestResult: any = { ok: true, uploadId: "new-upload-1", path: "sku/sku.glb", token: "tok", signedUrl: "https://...", targetFilename: "sku.glb" };
let mockAdminConfirmResult: any = { ok: true, status: "queued" };
let lastAdminRequestInput: any = null;
let lastAdminConfirmInput: any = null;

vi.mock("@/app/admin/factory-bom/actions", () => ({
  requestCadUpload: vi.fn(async (input: any) => {
    lastAdminRequestInput = input;
    return mockAdminRequestResult;
  }),
  confirmCadUpload: vi.fn(async (uploadId: string, actorEmail?: string) => {
    lastAdminConfirmInput = { uploadId, actorEmail };
    return mockAdminConfirmResult;
  }),
  getLatestCadUpload: vi.fn(async (sku: string) => {
    return mockCadUploads.find((c) => c.global_sku === sku) || null;
  }),
}));

vi.mock("@/lib/pim-audit", () => ({
  getPimSession: vi.fn().mockResolvedValue({
    email: "ghl-embed@ccpatio.com",
    role: "embed",
    verified: false,
  }),
  isEmbedPrincipal: vi.fn().mockReturnValue(true),
  logPimAudit: vi.fn().mockResolvedValue(undefined),
  GHL_EMBED_PRINCIPAL_EMAIL: "ghl-embed@ccpatio.com",
}));

vi.mock("@/server/db/client", () => {
  const fakeDb: any = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() =>
            mockCadUploads.filter((c) =>
              ["queued", "processing", "draft_ready"].includes(c.status)
            )
          ),
        })),
      })),
    })),
  };
  return { getDb: vi.fn(() => fakeDb) };
});

import {
  requestCadUploadWrapper,
  confirmCadUploadWrapper,
} from "@/server/factory-bom/intake/cad-wrapper";

describe("CAD Wrapper (Task 8.2)", () => {
  beforeEach(() => {
    mockCadUploads.length = 0;
    lastAdminRequestInput = null;
    lastAdminConfirmInput = null;
    mockAdminRequestResult = {
      ok: true,
      uploadId: "new-upload-1",
      path: "sku/sku.glb",
      token: "tok",
      signedUrl: "https://...",
      targetFilename: "sku.glb",
    };
    mockAdminConfirmResult = { ok: true, status: "queued" };
  });

  it("reuses existing upload if row with same global_sku and sha256 exists in reusable status", async () => {
    mockCadUploads.push({
      id: "existing-upload-99",
      global_sku: "JOB-SMITH-CHAIR",
      sha256: "abc123sha",
      status: "draft_ready",
    });

    const res = await requestCadUploadWrapper({
      sku: "JOB-SMITH-CHAIR",
      filename: "chair.glb",
      byteSize: 1024 * 100,
      sha256: "abc123sha",
      reportedUserEmail: "drafter@ccpatio.com",
    });

    expect(res.reused).toBe(true);
    if (res.reused) {
      expect(res.uploadId).toBe("existing-upload-99");
      expect(res.status).toBe("draft_ready");
    }
    // Should NOT have called admin requestCadUpload
    expect(lastAdminRequestInput).toBeNull();
  });

  it("does not reuse upload with status 'uploaded' to prevent stuck retry loops", async () => {
    mockCadUploads.push({
      id: "existing-upload-uploaded",
      global_sku: "JOB-SMITH-CHAIR",
      sha256: "abc123sha",
      status: "uploaded",
    });

    const res = await requestCadUploadWrapper({
      sku: "JOB-SMITH-CHAIR",
      filename: "chair.glb",
      byteSize: 1024 * 100,
      sha256: "abc123sha",
      reportedUserEmail: "drafter@ccpatio.com",
    });

    // Must NOT be reused; must initiate new upload
    expect(res.reused).toBe(false);
    expect(res.uploadId).toBe("new-upload-1");
    expect(lastAdminRequestInput).not.toBeNull();
  });

  it("calls admin action with actorEmail when not reused", async () => {
    const res = await requestCadUploadWrapper({
      sku: "JOB-SMITH-CHAIR",
      filename: "chair.glb",
      byteSize: 1024 * 100,
      sha256: "new-sha-456",
      reportedUserEmail: "drafter@ccpatio.com",
    });

    expect(res.reused).toBe(false);
    expect(res.uploadId).toBe("new-upload-1");
    expect(lastAdminRequestInput).toBeDefined();
    expect(lastAdminRequestInput.actorEmail).toBe("drafter@ccpatio.com");
  });

  it("never forwards raw admin error text on request failure", async () => {
    mockAdminRequestResult = {
      ok: false,
      error: "Internal DB connection failed at postgres://user:secret@db.internal:5432/hub with timeout",
    };

    try {
      await requestCadUploadWrapper({
        sku: "JOB-SMITH-CHAIR",
        filename: "chair.glb",
        byteSize: 1024 * 100,
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.name).toBe("IntakeDomainError");
      // Must NOT contain internal error text
      expect(err.message).not.toContain("postgres://");
      expect(err.message).not.toContain("timeout");
      expect(err.code).toBe("STORAGE_FAILED");
    }
  });

  it("confirmCadUploadWrapper passes reportedUserEmail and maps errors", async () => {
    const res = await confirmCadUploadWrapper({
      uploadId: "up-123",
      reportedUserEmail: "drafter@ccpatio.com",
    });

    expect(res.ok).toBe(true);
    expect(lastAdminConfirmInput.actorEmail).toBe("drafter@ccpatio.com");

    // Test error mapping
    mockAdminConfirmResult = {
      ok: false,
      error: "Fatal Katana downstream call threw SocketException: connection refused",
    };

    try {
      await confirmCadUploadWrapper({
        uploadId: "up-123",
        reportedUserEmail: "drafter@ccpatio.com",
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.name).toBe("IntakeDomainError");
      expect(err.message).not.toContain("SocketException");
      expect(err.message).not.toContain("Katana");
    }
  });
});
