import { describe, expect, it, vi, afterEach } from "vitest";
import { convertBlendToGlb, CadConvertError } from "@/lib/cad-upload/convert-client";

describe("CAD Convert Client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("handles successful conversion", async () => {
    const mockGlb = Buffer.from("mock-glb-content");
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockGlb.buffer,
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await convertBlendToGlb(Buffer.from("blend"), "test.blend");
    
    expect(result.glb).toBeInstanceOf(Buffer);
    expect(typeof result.sha256).toBe("string");
    expect(result.sha256.length).toBeGreaterThan(0);
    
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/convert",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("handles SKP_CONVERT_UNAVAILABLE (415)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 415,
      statusText: "Unsupported Media Type",
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(convertBlendToGlb(Buffer.from("skp"), "test.skp")).rejects.toThrow(
      "SKP_CONVERT_UNAVAILABLE"
    );
  });

  it("handles AbortError timeout", async () => {
    const abortError = new Error("AbortError");
    abortError.name = "AbortError";
    const mockFetch = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", mockFetch);

    await expect(convertBlendToGlb(Buffer.from("blend"), "test.blend")).rejects.toThrow(
      "Conversion timeout"
    );
  });

  it("handles non-200 body behavior (e.g. GLB_LOAD_FAILED)", async () => {
    expect.assertions(3);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ detail: "GLB_LOAD_FAILED" }),
      text: async () => JSON.stringify({ detail: "GLB_LOAD_FAILED" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    try {
      await convertBlendToGlb(Buffer.from("blend"), "test.blend");
    } catch (error: any) {
      expect(error).toBeInstanceOf(CadConvertError);
      expect(error.status).toBe(500);
      expect(error.message).toBe("Conversion failed: Internal Server Error");
    }
  });
});
