import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  planPresignedUpload,
  IMAGE_MAX_BYTES,
  MODEL_MAX_BYTES,
} from "@/server/assets/presign-policy";
import {
  buildSurgicalWooPayload,
  nonEmptyUrl,
  resolveInherited3dUrl,
  type HubParentInput,
} from "@/server/woocommerce/woo-catalog-sync";
import {
  buildFabricSwatchesJson,
  buildPowderSwatchesJson,
  buildDektonSwatchesJson,
  fabricSwatchPublicUrl,
  loadHeaders,
} from "../scripts/ops/generate-primeview-phase1-csv";
import { PHASE1_FABRICS, PHASE1_POWDERS, PHASE1_DEKTONS } from "@/server/ecommerce/phase1-portal";
import { authenticateAssetStudioRequest } from "@/server/assets/asset-studio-auth";

describe("presign-policy security", () => {
  it("accepts valid .glb / .usdz / 2048px image uploads", () => {
    const glb = planPresignedUpload({
      kind: "product_3d",
      woo_sku: "FIN-BRV-CLB-CHA-34X34",
      slot: "glb",
      filename: "bravada-club.glb",
      contentType: "model/gltf-binary",
      byteSize: 12_000_000,
    });
    expect(glb.ok).toBe(true);
    if (glb.ok) {
      expect(glb.bucket).toBe("cad-models");
      expect(glb.path).toMatch(/\.glb$/);
    }

    const usdz = planPresignedUpload({
      kind: "product_3d",
      woo_sku: "FIN-BRV-CLB-CHA-34X34",
      slot: "usdz",
      filename: "bravada-club.usdz",
      contentType: "model/vnd.usdz+zip",
      byteSize: 8_000_000,
    });
    expect(usdz.ok).toBe(true);

    const png = planPresignedUpload({
      kind: "finish_swatch",
      sku: "FAB-ACT-ASH",
      slot: "texture_2k",
      filename: "ash-2k.png",
      contentType: "image/png",
      byteSize: 4_000_000,
    });
    expect(png.ok).toBe(true);
    if (png.ok) {
      expect(png.bucket).toBe("product-images");
      expect(png.byteSize).toBeLessThanOrEqual(IMAGE_MAX_BYTES);
    }
  });

  it("rejects .svg / .html / path traversal / oversize", () => {
    expect(
      planPresignedUpload({
        kind: "finish_swatch",
        sku: "FAB-ACT-ASH",
        slot: "thumb",
        filename: "evil.svg",
        contentType: "image/svg+xml",
        byteSize: 1000,
      }).ok,
    ).toBe(false);

    expect(
      planPresignedUpload({
        kind: "finish_swatch",
        sku: "FAB-ACT-ASH",
        slot: "thumb",
        filename: "page.html",
        contentType: "text/html",
        byteSize: 1000,
      }).ok,
    ).toBe(false);

    expect(
      planPresignedUpload({
        kind: "finish_swatch",
        sku: "FAB-ACT-ASH",
        slot: "thumb",
        filename: "../escape.png",
        contentType: "image/png",
        byteSize: 1000,
      }).ok,
    ).toBe(false);

    expect(
      planPresignedUpload({
        kind: "product_3d",
        woo_sku: "FIN-BRV-CLB-CHA-34X34",
        slot: "glb",
        filename: "huge.glb",
        contentType: "model/gltf-binary",
        byteSize: MODEL_MAX_BYTES + 1,
      }).ok,
    ).toBe(false);
  });
});

describe("asset-studio dual auth", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 without GHL or partner token", async () => {
    vi.stubEnv("GHL_EMBED_SECRET", "test-embed-secret");
    vi.stubEnv("PRIMEVIEW_HANDOFF_TOKEN", "partner-token");
    const req = new Request("http://localhost/api/assets/presign-upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const result = await authenticateAssetStudioRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("accepts valid partner token via header", async () => {
    vi.stubEnv("PRIMEVIEW_HANDOFF_TOKEN", "partner-token");
    const req = new Request("http://localhost/api/assets/presign-upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-primeview-partner-token": "partner-token",
      },
    });
    const result = await authenticateAssetStudioRequest(req);
    expect(result).toEqual({ ok: true, actor: "primeview_partner" });
  });
});

describe("finish manifest schema", () => {
  it("emits FAB/PWD/DEC entries with physical scale fields", () => {
    const fabrics = JSON.parse(buildFabricSwatchesJson([])) as Array<Record<string, unknown>>;
    expect(fabrics).toHaveLength(24);
    expect(PHASE1_FABRICS).toHaveLength(24);
    for (const row of fabrics) {
      expect(String(row.fabric_sku)).toMatch(/^FAB-/);
      expect(row).toHaveProperty("texture_2k_url");
      expect(row).toHaveProperty("sample_width_in");
      expect(row).toHaveProperty("sample_height_in");
      expect(row).toHaveProperty("pattern_repeat_w_in");
      expect(row).toHaveProperty("pattern_repeat_h_in");
      expect(row).toHaveProperty("quality_status");
      expect(String(row.image_url)).toMatch(/\/fabrics\/fab-.*\.jpg$/i);
    }

    const powders = JSON.parse(buildPowderSwatchesJson()) as Array<Record<string, unknown>>;
    expect(powders).toHaveLength(PHASE1_POWDERS.length);
    expect(powders[0]).toHaveProperty("powder_sku");

    const dektons = JSON.parse(buildDektonSwatchesJson()) as Array<Record<string, unknown>>;
    expect(dektons).toHaveLength(PHASE1_DEKTONS.length);
    expect(String(dektons[0]!.dekton_sku)).toMatch(/^DEC-/);
  });

  it("preserves backward-compatible 24 FAB public URL path", () => {
    for (const sku of PHASE1_FABRICS) {
      expect(fabricSwatchPublicUrl(sku)).toContain(
        `/storage/v1/object/public/product-images/fabrics/${sku.toLowerCase()}.jpg`,
      );
    }
  });

  it("CSV headers keep all 169 original columns and add 4 Meta columns (173 total)", () => {
    const headers = loadHeaders();
    expect(headers).toHaveLength(173);
    expect(headers).toContain("Meta: acf_fabric_swatches_json");
    expect(headers).toContain("Meta: acf_powder_swatches_json");
    expect(headers).toContain("Meta: acf_dekton_swatches_json");
    expect(headers).toContain("Meta: acf_3d_model_glb_url");
    expect(headers).toContain("Meta: acf_3d_model_usdz_url");
  });
});

describe("woo-catalog-sync 3D meta invariants", () => {
  const baseParent: HubParentInput = {
    wooProductId: "9449",
    sku: "FIN-BRV-CLB-CHA",
    name: "Bravada Club Chair",
    status: "publish",
    preserveExistingImages: true,
    fabricSwatchesJson: '[{"fabric_sku":"FAB-ACT-ASH"}]',
    powderSwatchesJson: '[{"powder_sku":"PWD-BLACK"}]',
    dektonSwatchesJson: '[{"dekton_sku":"DEC-VEGHA"}]',
    variations: [
      {
        sku: "FIN-BRV-CLB-CHA-34X34",
        regularPrice: 2530,
        weightLb: 40,
        lengthIn: 34,
        widthIn: 34,
        heightIn: 31,
        sizeLabel: '34"',
      },
    ],
  };

  it("never puts .glb in images[] and omits null acf_3d_model_glb_url", () => {
    const built = buildSurgicalWooPayload(
      { ...baseParent, model3dGlbUrl: null, model3dUsdzUrl: "" },
      { weightUnit: "lb", dimensionUnit: "in" },
    );
    expect(built.product).not.toHaveProperty("images");
    expect(built.product).not.toHaveProperty("description");
    const meta = built.product.meta_data as Array<{ key: string; value: string }>;
    expect(meta.some((m) => m.key === "acf_3d_model_glb_url")).toBe(false);
    expect(meta.some((m) => m.key === "acf_3d_model_usdz_url")).toBe(false);
    expect(meta.find((m) => m.key === "acf_fabric_swatches_json")?.value).toContain("FAB-ACT-ASH");
    expect(meta.find((m) => m.key === "acf_powder_swatches_json")?.value).toContain("PWD-BLACK");
    expect(meta.find((m) => m.key === "acf_dekton_swatches_json")?.value).toContain("DEC-VEGHA");
    const blob = JSON.stringify(built.product);
    expect(blob).not.toMatch(/\.glb/i);
  });

  it("sends acf_3d_model_glb_url in meta_data when populated and inherits on variations", () => {
    const glb = "https://cdn.example.com/models/club.glb";
    const built = buildSurgicalWooPayload(
      {
        ...baseParent,
        model3dGlbUrl: glb,
        variations: [
          {
            ...baseParent.variations[0]!,
            model3dGlbUrl: null,
          },
        ],
      },
      { weightUnit: "lb", dimensionUnit: "in" },
    );
    const meta = built.product.meta_data as Array<{ key: string; value: string }>;
    expect(meta.find((m) => m.key === "acf_3d_model_glb_url")?.value).toBe(glb);
    expect(built.product).not.toHaveProperty("images");
    const varMeta = (built.variationBatch.create[0]!.meta_data as Array<{ key: string; value: string }>);
    expect(varMeta.find((m) => m.key === "acf_3d_model_glb_url")?.value).toBe(glb);
    expect(resolveInherited3dUrl(null, glb)).toBe(glb);
    expect(resolveInherited3dUrl("https://cdn.example.com/override.glb", glb)).toBe(
      "https://cdn.example.com/override.glb",
    );
    expect(nonEmptyUrl("")).toBeNull();
    expect(nonEmptyUrl("  ")).toBeNull();
  });

  it("rejects hero .glb from images[] even if heroImageUrl is set", () => {
    const built = buildSurgicalWooPayload(
      {
        ...baseParent,
        heroImageUrl: "https://cdn.example.com/models/bad.glb",
        preserveExistingImages: false,
      },
      { weightUnit: "lb", dimensionUnit: "in" },
    );
    expect(built.product).not.toHaveProperty("images");
  });
});
