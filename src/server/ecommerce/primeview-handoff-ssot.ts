/**
 * Partner-safe Certified SSOT loaders & export builders for
 * `/partner/primeview-handoff` — same roster as GHL Tabs 2–4, no mutations,
 * no Katana/QBO/intake leaks.
 */
import {
  ECOMMERCE_32_FINISH_COUNT,
  ECOMMERCE_32_FINISHES,
  ecommerceFinishBySku,
  filterActiveEcommerceFinishes,
  type EcommerceFinishFamily,
} from "@/server/ecommerce/ecommerce-32-finish-roster";
import {
  listFinishAssets,
  seedEcommerceFinishAssets,
  buildFullFinishesManifest,
} from "@/server/assets/finish-assets";
import {
  PHASE1_ADDON_ACF_KEYS,
  PHASE1_PARENT_COUNT,
  PHASE1_PURCHASABLE_SKU_COUNT,
  PHASE1_SIMPLE_COUNT,
  PHASE1_SOW_ITEM_COUNT,
  PHASE1_VARIATION_COUNT,
  reconcileMiaApprovedCounts,
} from "@/server/ecommerce/phase1-portal";
import {
  apfTargetGroupForFamily,
  formatVariationsFacing,
  inferSurfaceProfile,
  storefrontDisplayTitle,
} from "@/server/ecommerce/portal-readiness";
import { isFreestandingNonSectionalProduct } from "@/server/ecommerce/katana-ssot-bridge";
import { uniformFinishPhysicalScale, withCacheBustQuery } from "@/lib/finish-physical-scale";
import { generateLiveHandoffBundle } from "@/server/woocommerce/handoff-spec-generator";
import {
  buildWooDiagnosticReport,
  classifyWooProbeBody,
} from "@/server/ecommerce/executive-stack-health";
import {
  resolveWooConnection,
  testWooConnection,
  pushParentToWoo,
  type HubParentInput,
} from "@/server/woocommerce/woo-catalog-sync";
import { filterExistingFacingChildren } from "@/server/ecommerce/grouped-sku-resolve";
import { PRODUCTION_WOO_WEBHOOK_URL } from "@/lib/primeview-handoff-auth";

export type PartnerFinishView = {
  sku: string;
  finishCategory: "fabric" | "powder" | "dekton";
  family: EcommerceFinishFamily;
  displayName: string;
  hexCode: string | null;
  vendorSku: string | null;
  factorySkuRef: string | null;
  swatchThumbUrl: string | null;
  texture2kUrl: string | null;
  patternRepeatWIn: number | null;
  patternRepeatHIn: number | null;
  textureScale: number;
  textureSha256: string | null;
  sourceType: "studio_photo" | "synthetic_fallback" | null;
  sourceFilename: string | null;
  textureWidthPx: number | null;
  textureHeightPx: number | null;
  qualityStatus: "placeholder_lowres" | "photoshoot_verified";
  apfGroup: string;
  apfSlotKey: "cushion_fabric" | "table_top" | "frame_finish";
  updatedAt: string;
};

export type PartnerProductView = {
  id: string;
  globalSku: string;
  wooSku: string;
  productName: string;
  storefrontTitle: string;
  collectionLabel: string;
  aluminumMsrp: string | null;
  aluminumMsrpValue: number | null;
  msrp: string;
  typeBadge: string;
  surfaceProfile: string;
  weightLb: string | null;
  lengthIn: string | null;
  widthIn: string | null;
  heightIn: string | null;
  missingFreightDims: boolean;
  imageUrl: string | null;
  marketingDescription: string | null;
  constructionDetails: string | null;
  miaApproved: boolean;
  miaApprovedAt: string | null;
  model3dGlbUrl: string | null;
  model3dUsdzUrl: string | null;
  productVideoUrl: string | null;
  materialSlots: unknown[];
  isParent: boolean;
  isVariation: boolean;
  isSimple: boolean;
  hasMedia: boolean;
  wooProductId: string | null;
};

export type PartnerWooProbe = {
  state: "ok" | "failed" | "unconfigured";
  host: string;
  httpStatus: number | null;
  reason: string;
  snippet: string | null;
  checkedAt: string;
};

export type PartnerHandoffSsot = {
  generatedAtUtc: string;
  generatedAtMst: string;
  webhookUrl: string;
  finishes: PartnerFinishView[];
  products: PartnerProductView[];
  finishCount: number;
  parentCount: number;
  variationCount: number;
  simpleCount: number;
  purchasableSkuCount: number;
  miaApprovedCount: number;
  sowItemCount: number;
  miaLatestApprovedAt: string | null;
  powderDedupOk: boolean;
  wooProbe: PartnerWooProbe;
  finishesError: string | null;
  productsError: string | null;
};

const APF_SLOT: Record<EcommerceFinishFamily, PartnerFinishView["apfSlotKey"]> = {
  sunbrella: "cushion_fabric",
  ultraleather: "cushion_fabric",
  dekton: "table_top",
  powder: "frame_finish",
};

function n(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function cacheBust(url: string | null, sha: string | null): string | null {
  if (!url) return null;
  if (!sha) return url;
  try {
    return withCacheBustQuery(url, sha);
  } catch {
    return url;
  }
}

export function apfSlotKeyForFamily(
  family: EcommerceFinishFamily,
): PartnerFinishView["apfSlotKey"] {
  return APF_SLOT[family];
}

export function partnerTypeBadge(input: {
  globalSku: string;
  wooSku?: string | null;
  productName?: string | null;
  collectionLabel?: string | null;
  hasLsRsPair?: boolean;
  variationCount?: number | null;
  isParent?: boolean;
}): string {
  if (
    isFreestandingNonSectionalProduct({
      productName: input.productName,
      globalSku: input.globalSku,
      wooSku: input.wooSku,
      collectionLabel: input.collectionLabel,
    })
  ) {
    return "Simple";
  }
  const sku = (input.wooSku || input.globalSku || "").toUpperCase();
  if (/-LS$/i.test(sku)) return "Left-Side (-LS)";
  if (/-RS$/i.test(sku)) return "Right-Side (-RS)";
  const facing = formatVariationsFacing({
    globalSku: input.globalSku,
    wooSku: input.wooSku,
    productName: input.productName,
    collectionLabel: input.collectionLabel,
    hasLsRsPair: input.hasLsRsPair,
    variationCount: input.variationCount,
  });
  if (facing.startsWith("2 Vars") && input.isParent) {
    return `Parent · ${facing}`;
  }
  return facing;
}

function toPartnerFinish(
  r: Awaited<ReturnType<typeof listFinishAssets>>[number],
): PartnerFinishView | null {
  const def = ecommerceFinishBySku(r.sku);
  if (!def) return null;
  const scale = uniformFinishPhysicalScale(r.sku);
  const sha = r.texture_sha256 ?? null;
  return {
    sku: r.sku,
    finishCategory: r.finish_category,
    family: def.family,
    displayName: r.display_name || def.displayName,
    hexCode: r.hex_code,
    vendorSku: def.aliases[0] ?? null,
    factorySkuRef: def.aliases.length ? def.aliases.join(", ") : null,
    swatchThumbUrl: cacheBust(r.swatch_thumb_url, sha),
    texture2kUrl: cacheBust(r.texture_2k_url, sha),
    patternRepeatWIn: n(r.pattern_repeat_w_in) ?? scale.pattern_repeat_w_in,
    patternRepeatHIn: n(r.pattern_repeat_h_in) ?? scale.pattern_repeat_h_in,
    textureScale: scale.texture_scale,
    textureSha256: sha,
    sourceType: r.source_type ?? null,
    sourceFilename: r.source_filename ?? null,
    textureWidthPx: r.texture_width_px ?? null,
    textureHeightPx: r.texture_height_px ?? null,
    qualityStatus: r.quality_status,
    apfGroup: apfTargetGroupForFamily(def.family),
    apfSlotKey: apfSlotKeyForFamily(def.family),
    updatedAt: r.updated_at.toISOString(),
  };
}

/** Load Certified 32 finishes — same filter as GHL Tab 2. No session required. */
export async function loadCertifiedPartnerFinishes(): Promise<{
  finishes: PartnerFinishView[];
  error: string | null;
}> {
  try {
    await seedEcommerceFinishAssets();
    const rows = filterActiveEcommerceFinishes(await listFinishAssets());
    const finishes = rows
      .map(toPartnerFinish)
      .filter((x): x is PartnerFinishView => x != null)
      .sort((a, b) => a.sku.localeCompare(b.sku));
    return { finishes, error: null };
  } catch (error: unknown) {
    return {
      finishes: [],
      error: error instanceof Error ? error.message : "Could not load certified finishes",
    };
  }
}

function missingDims(row: {
  hubWeight?: string | null;
  hubLength?: string | null;
  hubDepth?: string | null;
  hubHeight?: string | null;
}): boolean {
  return ![row.hubWeight, row.hubLength, row.hubDepth, row.hubHeight].every(
    (v) => v != null && String(v).trim() !== "",
  );
}

/** Load Certified 107 aluminum products — same Phase 1 flat roster as GHL Tab 3. */
export async function loadCertifiedPartnerProducts(): Promise<{
  products: PartnerProductView[];
  miaApprovedCount: number;
  miaLatestApprovedAt: string | null;
  error: string | null;
}> {
  try {
    const { getPhase1PortalRows } = await import(
      "@/app/embed/admin/master-catalog/actions"
    );
    const roster = await getPhase1PortalRows("phase1_flat");
    const listings = roster.listings;
    const skuSet = new Set(
      listings.map((l) => (l.wooSku || l.globalSku).toUpperCase()),
    );

    const products: PartnerProductView[] = listings.map((l) => {
      const wooSku = (l.wooSku || l.globalSku).toUpperCase();
      const facingKids = filterExistingFacingChildren(
        l.globalSku,
        [...skuSet],
      );
      const isFacing = /-(LS|RS)$/i.test(wooSku);
      const isParent =
        !isFacing &&
        facingKids.length >= 2 &&
        !isFreestandingNonSectionalProduct({
          productName: l.productName,
          globalSku: l.globalSku,
          wooSku,
          collectionLabel: l.collectionLabel,
        });
      const isSimple =
        !isFacing &&
        (facingKids.length < 2 ||
          isFreestandingNonSectionalProduct({
            productName: l.productName,
            globalSku: l.globalSku,
            wooSku,
            collectionLabel: l.collectionLabel,
          }));
      const attrs = (l.attributes ?? {}) as Record<string, unknown>;
      const videoUrl =
        typeof attrs.product_video_url === "string"
          ? attrs.product_video_url
          : typeof attrs._ccpatio_product_video_url === "string"
            ? attrs._ccpatio_product_video_url
            : null;
      const hasMedia = Boolean(
        l.imageUrl || l.model3dGlbUrl || l.model3dUsdzUrl || videoUrl,
      );
      return {
        id: l.id,
        globalSku: l.globalSku,
        wooSku,
        productName: l.productName,
        storefrontTitle: storefrontDisplayTitle(l.productName) || l.productName,
        collectionLabel: l.collectionLabel,
        aluminumMsrp: l.aluminumMsrp,
        aluminumMsrpValue: l.aluminumMsrpValue,
        msrp: l.msrp,
        typeBadge: partnerTypeBadge({
          globalSku: l.globalSku,
          wooSku,
          productName: l.productName,
          collectionLabel: l.collectionLabel,
          hasLsRsPair: facingKids.length >= 2,
          variationCount: facingKids.length,
          isParent,
        }),
        surfaceProfile: inferSurfaceProfile({
          productName: l.productName,
          collectionLabel: l.collectionLabel,
          attributes: l.attributes ?? null,
        }),
        weightLb: l.hubWeight,
        lengthIn: l.hubLength,
        widthIn: l.hubDepth,
        heightIn: l.hubHeight,
        missingFreightDims: missingDims(l),
        imageUrl: l.imageUrl,
        marketingDescription: l.marketingDescription,
        constructionDetails: l.constructionDetails,
        miaApproved: Boolean(l.miaApproved),
        miaApprovedAt: l.miaApprovedAt ?? null,
        model3dGlbUrl: l.model3dGlbUrl ?? null,
        model3dUsdzUrl: l.model3dUsdzUrl ?? null,
        productVideoUrl: videoUrl,
        materialSlots: Array.isArray(l.model3dMaterialSlots)
          ? l.model3dMaterialSlots
          : [],
        isParent,
        isVariation: isFacing,
        isSimple,
        hasMedia,
        wooProductId: l.wooProductId,
      };
    });

    const mia = reconcileMiaApprovedCounts(
      products.map((p) => ({
        globalSku: p.globalSku,
        miaApproved: p.miaApproved,
      })),
    );
    const latest = products
      .map((p) => p.miaApprovedAt)
      .filter((x): x is string => Boolean(x))
      .sort()
      .at(-1) ?? null;

    return {
      products,
      miaApprovedCount: mia.miaApprovedCount,
      miaLatestApprovedAt: latest,
      error: null,
    };
  } catch (error: unknown) {
    return {
      products: [],
      miaApprovedCount: 0,
      miaLatestApprovedAt: null,
      error: error instanceof Error ? error.message : "Could not load certified products",
    };
  }
}

export async function probePartnerWooStaging(): Promise<PartnerWooProbe> {
  const checkedAt = new Date().toISOString();
  const conn = resolveWooConnection();
  if (!conn.configured) {
    return {
      state: "unconfigured",
      host: "ccpatiodev2.primeview.com",
      httpStatus: null,
      reason: conn.reason,
      snippet: null,
      checkedAt,
    };
  }
  const probe = await testWooConnection();
  if (probe.ok) {
    return {
      state: "ok",
      host: probe.host,
      httpStatus: 200,
      reason: `Connected · REST API Healthy — Ready for Sync`,
      snippet: null,
      checkedAt,
    };
  }
  const httpStatus = probe.httpStatus ?? 500;
  const classified = classifyWooProbeBody({
    httpStatus,
    bodyText: probe.rawBody ?? probe.snippet ?? "",
    host: conn.host,
  });
  const critical = Boolean(probe.critical) || httpStatus >= 500 || !classified.ok;
  return {
    state: "failed",
    host: conn.host,
    httpStatus,
    reason: critical
      ? `ccpatiodev2.primeview.com: WordPress PHP Critical Error (HTTP ${httpStatus})`
      : probe.reason,
    snippet: probe.snippet ?? classified.snippet ?? null,
    checkedAt,
  };
}

export function buildPartnerWooDiagnostic(probe: PartnerWooProbe): string {
  const conn = resolveWooConnection();
  const host = probe.host || conn.host || "ccpatiodev2.primeview.com";
  return buildWooDiagnosticReport({
    host,
    httpStatus: probe.httpStatus ?? 500,
    label: probe.reason,
    snippet: probe.snippet,
    checkedAt: probe.checkedAt,
    sourceHost: "https://hub.ccpatio.com",
    endpointProbed: `https://${host.replace(/^https?:\/\//, "")}/wp-json/wc/v3`,
    finishesStaged: ECOMMERCE_32_FINISH_COUNT,
    aluminumSkusStaged: PHASE1_PURCHASABLE_SKU_COUNT,
  });
}

export async function loadPartnerHandoffSsot(): Promise<PartnerHandoffSsot> {
  const [finishRes, productRes, wooProbe, bundle] = await Promise.all([
    loadCertifiedPartnerFinishes(),
    loadCertifiedPartnerProducts(),
    probePartnerWooStaging(),
    generateLiveHandoffBundle().catch(() => null),
  ]);

  const powderNames = finishRes.finishes
    .filter((f) => f.family === "powder")
    .map((f) => f.displayName.trim().toLowerCase());
  const powderDedupOk =
    powderNames.length === 6 &&
    new Set(powderNames).size === 6 &&
    !finishRes.finishes.some((f) => f.sku === "PWD-BEIGE");

  const generatedAtUtc = bundle?.generatedAtUtc ?? new Date().toISOString();
  const generatedAtMst =
    bundle?.generatedAtMst ??
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Phoenix",
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(new Date(generatedAtUtc));

  return {
    generatedAtUtc,
    generatedAtMst,
    webhookUrl: bundle?.webhookUrl ?? PRODUCTION_WOO_WEBHOOK_URL,
    finishes: finishRes.finishes,
    products: productRes.products,
    finishCount: finishRes.finishes.length || ECOMMERCE_32_FINISH_COUNT,
    parentCount: bundle?.parentCount ?? PHASE1_PARENT_COUNT,
    variationCount: bundle?.variationCount ?? PHASE1_VARIATION_COUNT,
    simpleCount: bundle?.simpleCount ?? PHASE1_SIMPLE_COUNT,
    purchasableSkuCount:
      productRes.products.length ||
      bundle?.uniquePurchasableSkus ||
      PHASE1_PURCHASABLE_SKU_COUNT,
    miaApprovedCount:
      productRes.miaApprovedCount ||
      bundle?.miaApprovedCount ||
      0,
    sowItemCount: PHASE1_SOW_ITEM_COUNT,
    miaLatestApprovedAt:
      productRes.miaLatestApprovedAt ?? bundle?.miaLatestApprovedAt ?? null,
    powderDedupOk,
    wooProbe,
    finishesError: finishRes.error,
    productsError: productRes.error,
  };
}

/* ───────────────────── Certified export builders ───────────────────── */

export type CertifiedFinishExportRow = {
  sku: string;
  display_name: string;
  material_class: string;
  apf_group: string;
  apf_slot_key: string;
  vendor_sku: string | null;
  swatch_512_url: string | null;
  texture_2048_url: string | null;
  pattern_repeat_in: string | null;
  repeat_w_in: number | null;
  repeat_h_in: number | null;
  texture_scale: number;
  sha256: string | null;
};

export function buildCertifiedFinishExportRows(
  finishes: PartnerFinishView[],
): CertifiedFinishExportRow[] {
  return finishes.map((f) => ({
    sku: f.sku,
    display_name: f.displayName,
    material_class: f.family,
    apf_group: f.apfGroup,
    apf_slot_key: f.apfSlotKey,
    vendor_sku: f.vendorSku,
    swatch_512_url: f.swatchThumbUrl,
    texture_2048_url: f.texture2kUrl,
    pattern_repeat_in:
      f.patternRepeatWIn != null && f.patternRepeatHIn != null
        ? `${f.patternRepeatWIn}" × ${f.patternRepeatHIn}"`
        : null,
    repeat_w_in: f.patternRepeatWIn,
    repeat_h_in: f.patternRepeatHIn,
    texture_scale: f.textureScale,
    sha256: f.textureSha256,
  }));
}

export function certifiedFinishesToCsv(rows: CertifiedFinishExportRow[]): string {
  const headers = [
    "sku",
    "display_name",
    "material_class",
    "apf_group",
    "apf_slot_key",
    "vendor_sku",
    "swatch_512_url",
    "texture_2048_url",
    "pattern_repeat_in",
    "repeat_w_in",
    "repeat_h_in",
    "texture_scale",
    "sha256",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) =>
      headers.map((h) => esc(r[h as keyof CertifiedFinishExportRow])).join(","),
    ),
  ].join("\n");
}

export function buildStorefrontAddonsExport() {
  return {
    generatedAtUtc: new Date().toISOString(),
    addons: [
      {
        title: "Cushion Core/Fill",
        desc: "Foam density, quick-dry fill, Dacron wrap options.",
      },
      {
        title: "Accent Pillows",
        desc: "Lumbar & throw pillow pairings per finish family.",
      },
      {
        title: "Protective Covers",
        desc: "All-weather covers matched to product dimensions.",
      },
      {
        title: "Dekton Tabletop Rules",
        desc: "Slab size constraints and edge-profile selections.",
      },
      {
        title: "Umbrella Bases",
        desc: "Weight & bolt-down base pairings per umbrella SKU.",
      },
    ],
    apf_slot_mapping: {
      cushion_fabric: "Cushion & Pillow",
      table_top: "Dekton Tabletop",
      frame_finish: "Aluminum Frame",
    },
    acf_keys: [...PHASE1_ADDON_ACF_KEYS],
    finishes_roster_count: ECOMMERCE_32_FINISH_COUNT,
    finish_skus: ECOMMERCE_32_FINISHES.map((f) => f.sku),
  };
}

export async function buildCertifiedProductsRestJson(
  products: PartnerProductView[],
): Promise<unknown> {
  return {
    generatedAtUtc: new Date().toISOString(),
    count: products.length,
    products: products.map((p) => ({
      sku: p.wooSku,
      canonical_sku: p.globalSku,
      name: p.storefrontTitle,
      type: p.isSimple ? "simple" : p.isVariation ? "variation" : "variable",
      type_badge: p.typeBadge,
      collection: p.collectionLabel,
      regular_price: p.aluminumMsrpValue ?? p.aluminumMsrp,
      surface_profile: p.surfaceProfile,
      freight: {
        weight_lb: p.weightLb,
        length_in: p.lengthIn,
        width_in: p.widthIn,
        height_in: p.heightIn,
      },
      media: {
        image_url: p.imageUrl,
        model_3d_glb_url: p.model3dGlbUrl,
        model_3d_usdz_url: p.model3dUsdzUrl,
        product_video_url: p.productVideoUrl,
      },
      mia_approved: p.miaApproved,
      meta: {
        acf_fabric_swatches_json: "see finishes export",
        acf_powder_swatches_json: "see finishes export",
        acf_dekton_swatches_json: "see finishes export",
        _ccpatio_product_video_url: p.productVideoUrl,
        acf_3d_model_glb_url: p.model3dGlbUrl,
      },
    })),
  };
}

/** Session-free dry-run preview for partner payload inspector. */
export async function buildPartnerDryRunPreview(globalSku: string): Promise<
  | { ok: true; preview: Record<string, unknown> }
  | { ok: false; error: string }
> {
  try {
    const { getPhase1PortalRows } = await import(
      "@/app/embed/admin/master-catalog/actions"
    );
    const roster = await getPhase1PortalRows("phase1_flat");
    const listing = roster.listings.find(
      (l) =>
        l.globalSku === globalSku ||
        (l.wooSku || "").toUpperCase() === globalSku.toUpperCase(),
    );
    if (!listing) return { ok: false, error: "Listing not found." };

    const siblings = roster.listings.filter(
      (l) =>
        (listing.wooProductId && l.wooProductId === listing.wooProductId) ||
        l.globalSku === listing.globalSku,
    );
    const realFacing = filterExistingFacingChildren(
      listing.globalSku,
      roster.listings.map((l) => l.wooSku || l.globalSku),
    );
    const variationRows =
      realFacing.length >= 2
        ? siblings.filter((s) => {
            const sku = (s.wooSku || s.globalSku).toUpperCase();
            return realFacing.includes(sku) || s.globalSku === listing.globalSku;
          })
        : [listing];

    const {
      buildFabricSwatchesManifestJson,
      buildPowderSwatchesManifestJson,
      buildDektonSwatchesManifestJson,
    } = await import("@/server/assets/finish-assets");
    const [fabricSwatchesJson, powderSwatchesJson, dektonSwatchesJson] =
      await Promise.all([
        buildFabricSwatchesManifestJson(),
        buildPowderSwatchesManifestJson(),
        buildDektonSwatchesManifestJson(),
      ]);

    const parent: HubParentInput = {
      wooProductId: listing.wooProductId,
      sku: listing.globalSku,
      name: storefrontDisplayTitle(listing.productName) || listing.productName,
      shortDescription: listing.marketingDescription,
      description: listing.constructionDetails,
      status: listing.isWebVisible ? "publish" : "draft",
      heroImageUrl: listing.imageUrl,
      preserveExistingImages: true,
      fabricSwatchesJson,
      powderSwatchesJson,
      dektonSwatchesJson,
      model3dGlbUrl: listing.model3dGlbUrl ?? null,
      model3dUsdzUrl: listing.model3dUsdzUrl ?? null,
      variations: variationRows.map((s) => ({
        sku: s.wooSku || s.globalSku,
        regularPrice:
          s.aluminumMsrpValue ??
          (s.aluminumMsrp != null ? Number(s.aluminumMsrp) : null) ??
          null,
        salePrice: s.salePrice,
        weightLb: s.hubWeight ? Number(s.hubWeight) : null,
        lengthIn: s.hubLength ? Number(s.hubLength) : null,
        widthIn: s.hubDepth ? Number(s.hubDepth) : null,
        heightIn: s.hubHeight ? Number(s.hubHeight) : null,
        sizeLabel: storefrontDisplayTitle(s.productName) || s.productName,
        katanaSku: s.globalSku,
        makeOrResale: s.thirdParty ? "Resale" : "Make",
        model3dGlbUrl: s.model3dGlbUrl ?? null,
        model3dUsdzUrl: s.model3dUsdzUrl ?? null,
      })),
    };

    const result = await pushParentToWoo(parent, {
      dryRun: true,
      includeCopy: false,
    });
    return {
      ok: true,
      preview: (result.preview ?? result) as Record<string, unknown>,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Dry-run failed",
    };
  }
}

/** Assert powder coat display names are the 6 canonical storefront labels. */
export function assertPowderCoatParity(finishes: PartnerFinishView[]): {
  ok: boolean;
  names: string[];
} {
  const powders = finishes.filter((f) => f.family === "powder");
  const names = powders.map((f) => f.displayName);
  const expected = new Set(["Gray", "Beige", "Bronze", "Black", "Bone", "White"]);
  const ok =
    powders.length === 6 &&
    names.every((n) => expected.has(n)) &&
    !powders.some((p) => p.sku === "PWD-BEIGE");
  return { ok, names };
}

export async function buildCertifiedFinishesManifestForDownload() {
  const { finishes } = await loadCertifiedPartnerFinishes();
  const rows = buildCertifiedFinishExportRows(finishes);
  // Also include family buckets for backward-compatible consumers.
  const full = await buildFullFinishesManifest();
  return {
    generatedAtUtc: new Date().toISOString(),
    count: rows.length,
    finishes: rows,
    counts: {
      fabrics: full.fabrics.length,
      powders: full.powders.length,
      dektons: full.dektons.length,
      total: rows.length,
    },
    fabrics: full.fabrics,
    powders: full.powders,
    dektons: full.dektons,
  };
}
