import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSkuMappings: any[] = [];
const mockJobs: any[] = [];
const mockAuditLogs: any[] = [];
const mockStorageFiles = new Map<string, { bytes: Uint8Array; contentType?: string | null }>();
const mockRemovedPaths: string[] = [];
let signedUploadUpsertOption: boolean | null = null;

vi.mock("@/lib/supabase-storage", () => ({
  PRODUCT_DOCUMENTS_BUCKET: "product-documents",
  createAssetSignedUpload: vi.fn(async (input: { bucket: string; path: string; upsert?: boolean }) => {
    signedUploadUpsertOption = input.upsert ?? false;
    return {
      path: input.path,
      token: "test-token",
      signedUrl: `https://storage.example.com/upload/${input.path}`,
    };
  }),
  createAssetSignedDownload: vi.fn(async (_bucket: string, path: string) => {
    return `https://storage.example.com/download/${path}?secret_token=SECRET_DOWNLOAD_TOKEN_xyz999`;
  }),
  getVaultStorage: vi.fn(() => ({
    download: async (_bucket: string, path: string) => {
      const file = mockStorageFiles.get(path);
      if (!file) throw new Error("File not found");
      return file;
    },
    remove: async (_bucket: string, path: string) => {
      mockRemovedPaths.push(path);
      mockStorageFiles.delete(path);
    },
    publicUrl: vi.fn(() => {
      throw new Error("getPublicUrl should never be called for packets");
    }),
  })),
}));

vi.mock("@/lib/pim-audit", () => ({
  getPimSession: vi.fn().mockResolvedValue({
    email: "operator@ccpatio.com",
    role: "operator",
    verified: true,
  }),
  isEmbedPrincipal: vi.fn().mockReturnValue(false),
  logPimAudit: vi.fn().mockImplementation(async (entry: any) => {
    mockAuditLogs.push(entry);
  }),
  GHL_EMBED_PRINCIPAL_EMAIL: "ghl-embed@ccpatio.com",
}));

vi.mock("@/server/db/client", () => {
  const fakeDb: any = {
    transaction: vi.fn(async (cb: any) => cb(fakeDb)),
    select: vi.fn(() => ({
      from: vi.fn((table: any) => ({
        where: vi.fn((_cond: any) => ({
          limit: vi.fn(() => {
            if (table._name === "sku_mappings" || table.global_sku) {
              return [mockSkuMappings[0] || null].filter(Boolean);
            }
            if (table._name === "custom_build_jobs" || table.client_slug) {
              return [mockJobs[0] || null].filter(Boolean);
            }
            return [];
          }),
        })),
      })),
    })),
    update: vi.fn((table: any) => ({
      set: vi.fn((vals: any) => ({
        where: vi.fn(() => {
          if (table._name === "custom_build_jobs" || table.client_slug) {
            if (mockJobs[0]) Object.assign(mockJobs[0], vals);
          }
          if (table._name === "sku_mappings" || table.global_sku) {
            if (mockSkuMappings[0]) Object.assign(mockSkuMappings[0], vals);
          }
          return Promise.resolve([vals]);
        }),
      })),
    })),
  };
  return { getDb: vi.fn(() => fakeDb) };
});

import {
  requestPacketUpload,
  confirmPacketUpload,
  getPacketDownloadLink,
} from "@/server/factory-bom/intake/packet";

describe("Factory Order PDF Packet Capture (Task 8)", () => {
  const testJobId = "job-12345";
  const testSku = "JOB-SMITH-CHAIR";

  // Valid PDF header bytes "%PDF-"
  const validPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

  beforeEach(() => {
    mockSkuMappings.length = 0;
    mockJobs.length = 0;
    mockAuditLogs.length = 0;
    mockStorageFiles.clear();
    mockRemovedPaths.length = 0;
    signedUploadUpsertOption = null;

    mockJobs.push({
      id: testJobId,
      client_slug: "SMITH",
      packet_storage_path: null,
    });

    mockSkuMappings.push({
      global_sku: testSku,
      attributes: {
        custom_build: true,
        job_id: testJobId,
        intake: {
          jobId: testJobId,
        },
      },
    });
  });

  it("requestPacketUpload enforces .pdf extension and generates key matching factory-packets/{jobId}/...", async () => {
    // Rejects x.pdf.exe
    await expect(
      requestPacketUpload({
        sku: testSku,
        filename: "malicious.pdf.exe",
        byteSize: 1024,
      })
    ).rejects.toThrow("That file isn't a readable PDF");

    // Success with .pdf
    const res = await requestPacketUpload({
      sku: testSku,
      filename: "factory-order.pdf",
      byteSize: 1024 * 50,
    });

    expect(res.uploadUrl).toBeDefined();
    expect(res.storagePath).toMatch(new RegExp(`^factory-packets/${testJobId}/\\d+-[0-9a-f]{16}\\.pdf$`));
  });

  it("requestPacketUpload rejects oversize files (> 25MB)", async () => {
    await expect(
      requestPacketUpload({
        sku: testSku,
        filename: "huge.pdf",
        byteSize: 26 * 1024 * 1024,
      })
    ).rejects.toThrow("That file is too large");
  });

  it("confirmPacketUpload rejects path from wrong job", async () => {
    const wrongPath = `factory-packets/other-job-999/123456789-0123456789abcdef.pdf`;
    mockStorageFiles.set(wrongPath, { bytes: validPdfBytes });

    await expect(
      confirmPacketUpload({
        sku: testSku,
        storagePath: wrongPath,
        originalFilename: "order.pdf",
      })
    ).rejects.toThrow("Storage path does not match job");
  });

  it("confirmPacketUpload sniffs %PDF- magic bytes and deletes corrupt/fake PDFs", async () => {
    const validPath = `factory-packets/${testJobId}/1234567890-abcdef0123456789.pdf`;
    // Not a PDF (starts with "NOTAPDF")
    mockStorageFiles.set(validPath, {
      bytes: new TextEncoder().encode("NOTAPDF CONTENT HERE"),
    });

    await expect(
      confirmPacketUpload({
        sku: testSku,
        storagePath: validPath,
        originalFilename: "fake.pdf",
      })
    ).rejects.toThrow("That file isn't a readable PDF");

    // Must remove corrupt object from bucket
    expect(mockRemovedPaths).toContain(validPath);
  });

  it("confirmPacketUpload is idempotent on replay of same path", async () => {
    const validPath = `factory-packets/${testJobId}/1234567890-abcdef0123456789.pdf`;
    mockJobs[0].packet_storage_path = validPath;

    const res = await confirmPacketUpload({
      sku: testSku,
      storagePath: validPath,
      originalFilename: "order.pdf",
    });

    expect(res.confirmed).toBe(true);
    expect(res.replayed).toBe(true);
    expect(res.path).toBe(validPath);
  });

  it("confirmPacketUpload happy path saves path to custom_build_jobs and piece attributes", async () => {
    const validPath = `factory-packets/${testJobId}/1234567890-abcdef0123456789.pdf`;
    mockStorageFiles.set(validPath, { bytes: validPdfBytes });

    const res = await confirmPacketUpload({
      sku: testSku,
      storagePath: validPath,
      originalFilename: "order.pdf",
    });

    expect(res.confirmed).toBe(true);
    expect(mockJobs[0].packet_storage_path).toBe(validPath);
    expect(mockSkuMappings[0].attributes.intake.packet.path).toBe(validPath);
    expect(mockSkuMappings[0].attributes.intake.packet.sha256).toBeDefined();
  });

  it("getPacketDownloadLink logs intake.packet_viewed audit and does not leak token in audit log", async () => {
    const validPath = `factory-packets/${testJobId}/1234567890-abcdef0123456789.pdf`;
    mockSkuMappings[0].attributes.intake.packet = {
      path: validPath,
      filename: "order.pdf",
    };

    const res = await getPacketDownloadLink({ sku: testSku });
    expect(res.downloadUrl).toContain("https://storage.example.com/download/");

    // Check audit log
    const audit = mockAuditLogs.find((a) => a.action === "intake.packet_viewed");
    expect(audit).toBeDefined();
    expect(audit.newValue).toContain(validPath);
    // Secret token must NOT appear in audit log
    expect(JSON.stringify(mockAuditLogs)).not.toContain("secret_token");
    expect(JSON.stringify(mockAuditLogs)).not.toContain("SECRET_DOWNLOAD_TOKEN_xyz999");
  });

  it("getPacketDownloadLink with embed session forces GHL_EMBED_PRINCIPAL_EMAIL and Unverified Embed User", async () => {
    const validPath = `factory-packets/${testJobId}/1234567890-abcdef0123456789.pdf`;
    mockSkuMappings[0].attributes.intake.packet = {
      path: validPath,
      filename: "order.pdf",
    };

    const { getPimSession, isEmbedPrincipal } = await import("@/lib/pim-audit");
    vi.mocked(getPimSession).mockResolvedValueOnce({
      email: "ghl-embed@ccpatio.com",
      name: "Embed User",
    });
    vi.mocked(isEmbedPrincipal).mockReturnValueOnce(true);

    const res = await getPacketDownloadLink({
      sku: testSku,
      reportedUserEmail: "spoofed.rep@ccpatio.com",
    });
    expect(res.downloadUrl).toContain("https://storage.example.com/download/");

    const audit = mockAuditLogs.find((a) => a.action === "intake.packet_viewed" && a.operatorEmail === "ghl-embed@ccpatio.com");
    expect(audit).toBeDefined();
    expect(audit.operatorEmail).toBe("ghl-embed@ccpatio.com");
    expect(audit.operatorName).toBe("Unverified Embed User");

    const parsedNew = JSON.parse(audit.newValue);
    expect(parsedNew.path).toBe(validPath);
    expect(parsedNew.reportedEmail).toBe("spoofed.rep@ccpatio.com");
    expect(parsedNew.verified).toBe(false);
  });
});
