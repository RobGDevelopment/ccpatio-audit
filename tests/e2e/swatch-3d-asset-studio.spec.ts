import { test, expect } from "@playwright/test";

/**
 * Smoke coverage for High-Res Swatch & 3D Asset Studio APIs.
 * Auth-negative paths must stay green even without partner/embed tokens in CI.
 */
test.describe("Swatch & 3D Asset Studio API", () => {
  test("presign-upload rejects unauthenticated requests with 401", async ({ request }) => {
    const res = await request.post("/api/assets/presign-upload", {
      data: {
        kind: "product_3d",
        woo_sku: "FIN-BRV-CLB-CHA-34X34",
        slot: "glb",
        filename: "model.glb",
        contentType: "model/gltf-binary",
        byteSize: 1_000_000,
      },
    });
    expect(res.status()).toBe(401);
  });

  test("presign-upload rejects dangerous extensions with 400 when partner token present", async ({
    request,
  }) => {
    const token = process.env.PRIMEVIEW_HANDOFF_TOKEN?.trim();
    test.skip(!token, "PRIMEVIEW_HANDOFF_TOKEN not configured");
    const res = await request.post("/api/assets/presign-upload", {
      headers: { "x-primeview-partner-token": token! },
      data: {
        kind: "finish_swatch",
        sku: "FAB-ACT-ASH",
        slot: "thumb",
        filename: "evil.svg",
        contentType: "image/svg+xml",
        byteSize: 1000,
        token,
      },
    });
    expect(res.status()).toBe(400);
  });
});
