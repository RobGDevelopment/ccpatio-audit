import { describe, expect, it, vi, beforeEach } from "vitest";
import { toIntakeFailure, redact } from "@/server/factory-bom/intake/errors";
import { PathAFenceError } from "@/server/path-a/katana-fence";

describe("Intake Error Masking & Redaction (toIntakeFailure)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redacts postgres URLs, bearer tokens, signed URLs, and JWTs", () => {
    const raw = "Error: postgres://user:secret123@db.host.internal:5432/production with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDN and https://storage.supabase.co/object/sign/bucket/file.pdf?token=secrettoken123";
    const cleaned = redact(raw);

    expect(cleaned).not.toContain("secret123");
    expect(cleaned).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDN");
    expect(cleaned).not.toContain("secrettoken123");
  });

  it("masks Postgres constraint errors and never leaks DB strings to the user", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const err = new Error('duplicate key value violates unique constraint "sku_mappings_pkey" DETAIL: Key (global_sku)=(JOB-SMITH-1) already exists. postgres://admin:pass@host/db');
    const result = toIntakeFailure(err, "testWhere");

    expect(result.ok).toBe(false);
    expect(result.code).toBe("INTERNAL");
    expect(result.message).toBe("Something went wrong on our side.");
    expect(result.ref).toBeDefined();
    expect(result.ref.length).toBeGreaterThanOrEqual(6);
    expect(result.ref.length).toBeLessThanOrEqual(8);

    // Ensure raw error details do not appear in the returned message
    expect(result.message).not.toContain("sku_mappings_pkey");
    expect(result.message).not.toContain("JOB-SMITH-1");
    expect(result.message).not.toContain("postgres://");

    // Check server log output
    expect(consoleSpy).toHaveBeenCalled();
    const logCall = consoleSpy.mock.calls[0]?.[0];
    const parsedLog = JSON.parse(logCall);
    expect(parsedLog.tag).toBe("embed-intake-error");
    expect(parsedLog.ref).toBe(result.ref);
    expect(parsedLog.where).toBe("testWhere");
    expect(parsedLog.message).not.toContain("pass");

    consoleSpy.mockRestore();
  });

  it("masks upstream GHL error bodies and auth tokens", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const err = new Error("GHL 500: Internal Server Error { \"message\": \"Failed to query location loc_123\", \"token\": \"ghl_secret_token_abc\" }");
    const result = toIntakeFailure(err, "ghlAction");

    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("Failed to query location");
    expect(result.message).not.toContain("ghl_secret_token_abc");

    consoleSpy.mockRestore();
  });

  it("maps PathAFenceError to PROJECT_LOCKED", () => {
    const fenceErr = new PathAFenceError("Saga in progress");
    const result = toIntakeFailure(fenceErr, "fenceCheck");

    expect(result.ok).toBe(false);
    expect(result.code).toBe("PROJECT_LOCKED");
    expect(result.message).toBe("This project was already sent to production. Ask an Ops Manager about a change order.");
    expect(result.ref).toBeDefined();
  });
});
