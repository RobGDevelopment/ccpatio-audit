import { authenticatePrimeviewHandoffToken } from "@/lib/primeview-handoff-auth";
import { generateLiveHandoffBundle } from "@/server/woocommerce/handoff-spec-generator";
import {
  finishCategoryForSku,
  listFinishAssets,
  updateFinishAsset,
} from "@/server/assets/finish-assets";
import { getDb } from "@/server/db/client";
import { ecommerce_listings, type EcommerceFinishAssetRow } from "@/server/db/schema";
import { and, isNotNull, isNull } from "drizzle-orm";
import PartnerHandoffClient, {
  type PartnerCalibrationInput,
  type PartnerCalibrationResult,
  type PartnerFinishAsset,
  type PartnerProduct3d,
} from "./PartnerHandoffClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toPartnerAsset(r: EcommerceFinishAssetRow): PartnerFinishAsset {
  const n = (v: string | null) => (v == null ? null : Number(v));
  return {
    sku: r.sku,
    finishCategory: r.finish_category,
    displayName: r.display_name,
    hexCode: r.hex_code,
    swatchThumbUrl: r.swatch_thumb_url,
    texture2kUrl: r.texture_2k_url,
    sampleWidthIn: n(r.sample_width_in),
    sampleHeightIn: n(r.sample_height_in),
    patternRepeatWIn: n(r.pattern_repeat_w_in),
    patternRepeatHIn: n(r.pattern_repeat_h_in),
    qualityStatus: r.quality_status,
  };
}

/**
 * Partner-token-gated calibration save (sample size + pattern repeat only). The token is
 * re-validated on every call; the finish SKU must already be a registered FAB/PWD/DEC row.
 */
async function savePartnerCalibration(
  token: string,
  sku: string,
  input: PartnerCalibrationInput,
): Promise<PartnerCalibrationResult> {
  "use server";
  const auth = authenticatePrimeviewHandoffToken(token);
  if (!auth.ok) return { ok: false, error: auth.reason };
  if (typeof sku !== "string" || !finishCategoryForSku(sku)) {
    return { ok: false, error: "Not a finish SKU." };
  }
  try {
    const row = await updateFinishAsset(sku, {
      sample_width_in: input.sample_width_in,
      sample_height_in: input.sample_height_in,
      pattern_repeat_w_in: input.pattern_repeat_w_in,
      pattern_repeat_h_in: input.pattern_repeat_h_in,
    });
    if (!row) return { ok: false, error: `Unknown finish SKU ${sku}` };
    return { ok: true, asset: toPartnerAsset(row) };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save scale" };
  }
}

function AuthGate({ status, reason }: { status: 401 | 403; reason: string }) {
  return (
    <div className="min-h-screen grid place-items-center bg-[#0f1419] text-slate-200 px-6">
      <div className="text-center max-w-md">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
          CC Patio × PrimeView
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          {status} {status === 401 ? "Unauthorized" : "Forbidden"}
        </h1>
        <p className="mt-2 text-sm text-slate-400">{reason}</p>
      </div>
    </div>
  );
}

export default async function PrimeviewHandoffPartnerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  const auth = authenticatePrimeviewHandoffToken(token);
  if (!auth.ok) {
    return <AuthGate status={auth.status} reason={auth.reason} />;
  }

  const bundle = await generateLiveHandoffBundle();

  // Asset studio data. A missing table (migration 0060 not applied) must not take the
  // downloads tab down, so failures degrade to an empty studio with a visible error.
  let finishAssets: PartnerFinishAsset[] = [];
  let finishAssetsError: string | null = null;
  const product3d: Record<string, PartnerProduct3d> = {};
  try {
    finishAssets = (await listFinishAssets()).map(toPartnerAsset);
    const l = ecommerce_listings;
    const rows = await getDb()
      .select({
        wooSku: l.woo_sku,
        glb: l.model_3d_glb_url,
        usdz: l.model_3d_usdz_url,
        size: l.model_3d_file_size,
      })
      .from(l)
      .where(and(isNull(l.archived_at), isNotNull(l.woo_sku)));
    for (const r of rows) {
      if (r.wooSku && (r.glb || r.usdz)) {
        product3d[r.wooSku] = { glbUrl: r.glb, usdzUrl: r.usdz, fileSize: r.size };
      }
    }
  } catch (error: unknown) {
    finishAssetsError =
      error instanceof Error ? `Asset studio unavailable: ${error.message}` : "Asset studio unavailable.";
  }

  return (
    <PartnerHandoffClient
      token={auth.token}
      generatedAtUtc={bundle.generatedAtUtc}
      generatedAtMst={bundle.generatedAtMst}
      miaApprovedCount={bundle.miaApprovedCount}
      miaLatestApprovedAt={bundle.miaLatestApprovedAt}
      sowItemCount={bundle.sowItemCount}
      parentCount={bundle.parentCount}
      uniquePurchasableSkus={bundle.uniquePurchasableSkus}
      variationCount={bundle.variationCount}
      simpleCount={bundle.simpleCount}
      webhookUrl={bundle.webhookUrl}
      storefrontRows={bundle.storefrontRows}
      finishAssets={finishAssets}
      finishAssetsError={finishAssetsError}
      product3d={product3d}
      onSaveCalibration={savePartnerCalibration}
    />
  );
}
