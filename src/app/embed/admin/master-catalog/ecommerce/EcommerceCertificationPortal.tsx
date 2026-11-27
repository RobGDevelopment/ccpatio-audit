"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  ImagePlus,
  Loader2,
  Lock,
  Archive,
  Palette,
  Search,
  Shield,
  UploadCloud,
} from "lucide-react";
import { useEmbedSession } from "@/components/embed/EmbedSessionProvider";
import {
  ECOMMERCE_32_FINISH_COUNT,
  ECOMMERCE_32_FINISHES,
  isFinishSkuLocked,
} from "@/lib/ecommerce-roster";
import {
  PHASE1_PARENT_COUNT,
  PHASE1_PURCHASABLE_SKU_COUNT,
  PHASE1_SIMPLE_COUNT,
  PHASE1_SOW_ITEM_COUNT,
  PHASE1_VARIATION_COUNT,
  reconcileMiaApprovedCounts,
  sowKeyFromSku,
} from "@/server/ecommerce/phase1-portal";
import { ecommerceFinishBySku } from "@/server/ecommerce/ecommerce-32-finish-roster";
import { needsMiaSpotCheck, STOREFRONT_POLICY_BANNER } from "@/server/ecommerce/two-tab-portal";
import {
  apfTargetGroupForFamily,
  formatVariationsFacing,
  freightDimsBadge,
  inferSurfaceProfile,
  mediaBadge,
  stagingPushGuardrailMessage,
  storefrontDisplayTitle,
  stripFinBracketsFromTitle,
  surfaceBadgeFromProfile,
} from "@/server/ecommerce/portal-readiness";
import { sameGroupedParent } from "@/server/ecommerce/grouped-sku-resolve";
import {
  isAllCapsFactoryTitle,
  powderFactorySubtitle,
} from "@/server/ecommerce/katana-ssot-bridge";
import {
  addFinishRowForPortal,
  archiveEcommerceListingForPortal,
  disableFinishRowForPortal,
  reenableFinishRowForPortal,
  dryRunWooPushForSku,
  getPrimeviewHandoffDownloadUrls,
  getPrimeviewPartnerHandoffLink,
  listArchivedEcommerceListingsForPortal,
  listFinishAssetsForPortal,
  restoreEcommerceListingForPortal,
  runPortalStagingPush,
  saveFinishCalibration,
  testWooConnectionAction,
  buildWooDiagnosticReportAction,
  toggleMiaApproval,
  updateFinishDisplayForPortal,
  type FinishAssetCategory,
  type FinishAssetView,
  archiveOpenDlqEventsAction,
  listOpenDlqEventsAction,
  retryDlqEventAction,
  resolveDlqEventAction,
  verifyLiveQboTokenAction,
  verifyQboCredentialsPairAction,
  listFinishIntakeAction,
  type DlqOpenRow,
} from "../actions";
import type { FinishIntakeView } from "@/server/ecommerce/finish-intake";
import { DropButton, uploadEmbedAsset } from "./SwatchesFinishesDrawer";
import IntakeMediaStudio from "./IntakeMediaStudio";
import { Model3dCell, type Phase1Listing } from "./Phase1PortalViews";
import FullResImageLightbox from "./FullResImageLightbox";
import ExecutiveStackHealthStrip from "./ExecutiveStackHealthStrip";
import ArchiveImpactModal, { type ArchiveImpactTarget } from "./ArchiveImpactModal";
import PendingCommitBar, { type StagedPortalChange } from "./PendingCommitBar";
import type { StackLayerPill } from "@/server/ecommerce/executive-stack-health";
import { formatFinishRepeatScaleLabel } from "@/lib/finish-physical-scale";

type PortalTab = "intake" | "finishes" | "products" | "sync";
type StatusFilter = "all" | "spot_check" | "approved";
type FinishSubFilter =
  | "all_active"
  | "sunbrella"
  | "ultraleather"
  | "dekton"
  | "powder"
  | "addons"
  | "archived";
type CatalogShapeFilter = "all" | "parents" | "variations" | "simple" | "purchasable";
type ProductTypeFilter = "all" | "sofas" | "chairs" | "tables" | "ottomans" | "swings" | "misc";
type ReadinessFilter =
  | "none"
  | "missing_dims"
  | "missing_media"
  | "spot_check"
  | "approved"
  | "phase2"
  | "archived";

type Props = {
  listings: Phase1Listing[];
  listingsLoading: boolean;
  listingsError: string | null;
  miaApprovedCount: number;
  sowItemCount: number;
  parentCount?: number;
  variationCount?: number;
  simpleCount?: number;
  purchasableSkuCount?: number;
  wooBadgeLabel: string | null;
  wooConfigured: boolean;
  onToast: (msg: string) => void;
  onListingsChange: (next: Phase1Listing[]) => void;
  onOpenProductEdit: (
    listing: Phase1Listing,
    focus?: "freight" | "media" | "surface" | "title",
  ) => void;
  /** SSR-hydrated finishes so Tab 1 never flashes 0/16. */
  initialAssets?: FinishAssetView[];
  /** SSR-hydrated 7-pill stack so Katana MRP never unmounts. */
  initialStackLayers?: StackLayerPill[];
  /** SSR-hydrated Tab 1 intake queue (27 photoshoot finishes + ad-hoc). */
  initialIntake?: FinishIntakeView[];
};

const FAMILY_GROUPS = [
  {
    key: "sunbrella" as const,
    title: "Sunbrella Fabrics",
    count: 16,
    category: "fabric" as FinishAssetCategory,
    skus: () => ECOMMERCE_32_FINISHES.filter((f) => f.family === "sunbrella").map((f) => f.sku),
    apf: apfTargetGroupForFamily("sunbrella"),
  },
  {
    key: "ultraleather" as const,
    title: "Ultraleather",
    count: 4,
    category: "fabric" as FinishAssetCategory,
    skus: () => ECOMMERCE_32_FINISHES.filter((f) => f.family === "ultraleather").map((f) => f.sku),
    apf: apfTargetGroupForFamily("ultraleather"),
  },
  {
    key: "dekton" as const,
    title: "Dekton Stones",
    count: 6,
    category: "dekton" as FinishAssetCategory,
    skus: () => ECOMMERCE_32_FINISHES.filter((f) => f.family === "dekton").map((f) => f.sku),
    apf: apfTargetGroupForFamily("dekton"),
  },
  {
    key: "powder" as const,
    title: "Aluminum Frame Powder Coats",
    count: 6,
    category: "powder" as FinishAssetCategory,
    skus: () => ECOMMERCE_32_FINISHES.filter((f) => f.family === "powder").map((f) => f.sku),
    apf: apfTargetGroupForFamily("powder"),
    policyBadge: true,
  },
];

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.png,.webp";
const MEDIA_ACCEPT = `${IMAGE_ACCEPT},.glb,model/gltf-binary`;
const FINISH_INPUT =
  "bg-slate-900 border border-slate-600 text-slate-100 placeholder:text-slate-400 focus:border-amber-400";

function chip(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
    active
      ? "border-amber-400 bg-amber-500 text-slate-950"
      : "border-white/15 bg-white/5 text-slate-300 hover:border-amber-400/50"
  }`;
}

function DarkFinishRow({
  asset,
  embedToken,
  onChanged,
  onToast,
  onArchive,
  restoreMode = false,
  onRestore,
  onInspect,
}: {
  asset: FinishAssetView;
  embedToken: string | null;
  onChanged: () => void;
  onToast: (msg: string) => void;
  onArchive: (sku: string, displayName: string) => void;
  restoreMode?: boolean;
  onRestore?: (sku: string) => void;
  onInspect?: () => void;
}) {
  const [displayName, setDisplayName] = useState(asset.displayName);
  const [repeatW, setRepeatW] = useState(asset.patternRepeatWIn?.toString() ?? "");
  const [repeatH, setRepeatH] = useState(asset.patternRepeatHIn?.toString() ?? "");
  const [textureScale, setTextureScale] = useState(
    asset.patternRepeatWIn?.toString() ?? asset.sampleWidthIn?.toString() ?? "",
  );
  const [busy, setBusy] = useState<"thumb" | "texture_2k" | null>(null);
  const [progress, setProgress] = useState<Partial<Record<"thumb" | "texture_2k", number>>>({});
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<"idle" | "saving" | "saved">("idle");
  const [imgBroken, setImgBroken] = useState(false);
  const skuLocked = isFinishSkuLocked(asset.sku);
  const finishDef = ecommerceFinishBySku(asset.sku);

  useEffect(() => {
    setDisplayName(asset.displayName);
    setRepeatW(asset.patternRepeatWIn?.toString() ?? "");
    setRepeatH(asset.patternRepeatHIn?.toString() ?? "");
    setTextureScale(asset.patternRepeatWIn?.toString() ?? asset.sampleWidthIn?.toString() ?? "");
    setImgBroken(false);
  }, [asset]);

  async function upload(slot: "thumb" | "texture_2k", file: File) {
    setBusy(slot);
    setProgress((p) => ({ ...p, [slot]: 0 }));
    const res = await uploadEmbedAsset({
      embedToken,
      kind: "finish_swatch",
      slot,
      sku: asset.sku,
      file,
      onProgress: (pct) => setProgress((p) => ({ ...p, [slot]: pct })),
    });
    setBusy(null);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast(`${asset.sku}: ${slot === "thumb" ? "swatch" : "2048px texture"} uploaded`);
    onChanged();
  }

  function fieldDirty() {
    const parse = (v: string) => {
      const t = v.trim();
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    return (
      (displayName.trim() && displayName.trim() !== asset.displayName) ||
      parse(repeatW) !== asset.patternRepeatWIn ||
      parse(repeatH) !== asset.patternRepeatHIn ||
      parse(textureScale) !==
        (asset.patternRepeatWIn ?? asset.sampleWidthIn ?? null)
    );
  }

  async function save() {
    if (!fieldDirty()) return;
    setSaving(true);
    setSaveFeedback("saving");
    if (displayName.trim() && displayName.trim() !== asset.displayName) {
      const renamed = await updateFinishDisplayForPortal(asset.sku, {
        displayName: displayName.trim(),
      });
      if (!renamed.ok) {
        setSaving(false);
        setSaveFeedback("idle");
        onToast(renamed.error);
        return;
      }
    }
    const parse = (v: string) => {
      const t = v.trim();
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const scale = parse(textureScale);
    const res = await saveFinishCalibration(asset.sku, {
      sample_width_in: scale,
      sample_height_in: scale,
      pattern_repeat_w_in: parse(repeatW) ?? scale,
      pattern_repeat_h_in: parse(repeatH) ?? scale,
    });
    setSaving(false);
    if (!res.ok) {
      setSaveFeedback("idle");
      onToast(res.error);
      return;
    }
    setSaveFeedback("saved");
    onToast(`${asset.sku} saved`);
    onChanged();
    window.setTimeout(() => setSaveFeedback("idle"), 1600);
  }

  return (
    <tr className="border-t border-white/5" data-testid={`finish-row-${asset.sku}`}>
      <td className="px-3 py-2.5">
        <button
          type="button"
          className="block cursor-pointer"
          onClick={() => onInspect?.()}
          aria-label={`Inspect ${asset.displayName}`}
        >
          <span className="block h-12 w-12 min-w-12 aspect-square overflow-hidden rounded-md border border-slate-700 p-0">
            {asset.swatchThumbUrl && !imgBroken ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={asset.swatchThumbUrl}
                alt={asset.displayName}
                className="block h-full w-full object-cover"
                onError={() => setImgBroken(true)}
              />
            ) : (
              <span
                className="block h-full w-full"
                style={{ backgroundColor: asset.hexCode ?? "#334155" }}
                title={asset.hexCode ?? "No swatch"}
              />
            )}
          </span>
        </button>
      </td>
      <td className="px-3 py-2.5">
        {asset.qualityStatus === "photoshoot_verified" ? (
          <button
            type="button"
            onClick={() => onInspect?.()}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300 cursor-pointer hover:bg-emerald-500/25"
          >
            <CheckCircle2 className="h-3 w-3" />
            2048px Ready
          </button>
        ) : (
          <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
            Needs 2048px
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span
          className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-amber-300"
          data-testid={`finish-sku-locked-${asset.sku}`}
          title="System-generated SKU — locked"
        >
          {skuLocked ? <Lock className="h-3 w-3 text-amber-400/70" /> : null}
          <input
            readOnly
            value={asset.sku}
            aria-readonly="true"
            className="w-32 cursor-not-allowed whitespace-nowrap rounded border border-white/10 bg-[#0b0f17] px-1.5 py-0.5 font-mono text-[11px] text-amber-300"
          />
        </span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-1">
          <input
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setSaveFeedback("idle");
            }}
            onBlur={() => void save()}
            data-testid={`finish-display-${asset.sku}`}
            className={`w-full min-w-[8rem] rounded px-2 py-1 text-xs ${FINISH_INPUT}`}
          />
          <span
            className="text-[10px] font-semibold text-emerald-300"
            data-testid={`finish-save-feedback-${asset.sku}`}
          >
            {saveFeedback === "saving"
              ? "Saving…"
              : saveFeedback === "saved"
                ? "Saved ✓"
                : "\u00a0"}
          </span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        {asset.finishCategory !== "fabric" && !repeatW && !repeatH ? (
          <span className="text-[10px] text-slate-500 italic">
            {asset.finishCategory === "dekton" ? "N/A (Slab)" : "N/A (Matte Coat)"}
          </span>
        ) : null}
        <div className="flex items-center gap-1">
          <label className="flex flex-col items-center">
            <span className="text-[9px] text-slate-500">Repeat</span>
            <div className="flex items-center gap-1">
              <label className="flex flex-col items-center">
                <span className="text-[8px] text-slate-600">W&quot;</span>
                <input
                  inputMode="decimal"
                  value={repeatW}
                  onChange={(e) => setRepeatW(e.target.value)}
                  onBlur={() => void save()}
                  placeholder="W"
                  className={`w-16 text-center rounded px-1.5 py-1 font-mono text-[11px] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${FINISH_INPUT}`}
                  data-testid={`cal-patternRepeatWIn-${asset.sku}`}
                />
              </label>
              <span className="text-slate-600 mt-3">×</span>
              <label className="flex flex-col items-center">
                <span className="text-[8px] text-slate-600">H&quot;</span>
                <input
                  inputMode="decimal"
                  value={repeatH}
                  onChange={(e) => setRepeatH(e.target.value)}
                  onBlur={() => void save()}
                  placeholder="H"
                  className={`w-16 text-center rounded px-1.5 py-1 font-mono text-[11px] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${FINISH_INPUT}`}
                  data-testid={`cal-patternRepeatHIn-${asset.sku}`}
                />
              </label>
            </div>
          </label>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <input
          inputMode="decimal"
          value={textureScale}
          onChange={(e) => setTextureScale(e.target.value)}
          onBlur={() => void save()}
          placeholder="Scale"
          title="Texture Scale (in) for Yardi 3D plugin"
          className={`w-16 rounded px-1.5 py-1 font-mono text-[11px] ${FINISH_INPUT}`}
          data-testid={`cal-textureScale-${asset.sku}`}
        />
      </td>
      <td className="min-w-[165px] whitespace-nowrap px-3 py-2.5">
        {asset.finishCategory === "fabric" ? (
          <span
            className="inline-flex rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-200"
            title="fabric_sku"
          >
            Cushion &amp; Pillow
          </span>
        ) : asset.finishCategory === "dekton" ? (
          <span
            className="inline-flex rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold text-violet-200"
            title="dekton"
          >
            Dekton Tabletop
          </span>
        ) : (
          <span
            className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-200"
            title="powder_coat"
          >
            Aluminum Frame
          </span>
        )}
        {asset.finishCategory === "powder" && finishDef ? (
          <span
            className="mt-0.5 block text-[9px] text-slate-500"
            title={`Factory SKU: ${asset.sku}`}
            data-testid={`finish-factory-subtitle-${asset.sku}`}
          >
            {powderFactorySubtitle(asset.sku) ?? asset.sku}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex min-w-[12rem] flex-row gap-1">
          <DropButton
            label="↑ Swatch"
            accept={IMAGE_ACCEPT}
            busy={busy === "thumb"}
            disabled={busy !== null || saving}
            progress={progress.thumb}
            onFile={(f) => void upload("thumb", f)}
            testId={`upload-thumb-${asset.sku}`}
            variant="dark"
          />
          <DropButton
            label="↑ 2048px"
            accept={IMAGE_ACCEPT}
            busy={busy === "texture_2k"}
            disabled={busy !== null || saving}
            progress={progress.texture_2k}
            onFile={(f) => void upload("texture_2k", f)}
            testId={`upload-texture-${asset.sku}`}
            variant="dark"
          />
        </div>
      </td>
      <td className="px-3 py-2.5">
        {restoreMode ? (
          <button
            type="button"
            data-testid={`finish-row-restore-${asset.sku}`}
            onClick={() => onRestore?.(asset.sku)}
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-200"
          >
            Restore
          </button>
        ) : (
          <button
            type="button"
            data-testid={`finish-row-archive-${asset.sku}`}
            title="Archive from e-commerce roster"
            onClick={() => onArchive(asset.sku, asset.displayName)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
}

function MediaUploadZone({
  listings,
  finishSkus,
  embedToken,
  onToast,
}: {
  listings: Phase1Listing[];
  finishSkus: string[];
  embedToken: string | null;
  onToast: (msg: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [wooSku, setWooSku] = useState(listings[0]?.wooSku || listings[0]?.globalSku || "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const options = useMemo(() => {
    const productOpts = listings.map((l) => ({
      sku: (l.wooSku || l.globalSku).toUpperCase(),
      label: stripFinBracketsFromTitle(l.productName) || l.productName,
      kind: "product" as const,
    }));
    const finishOpts = finishSkus.map((sku) => {
      const def = ECOMMERCE_32_FINISHES.find((f) => f.sku === sku);
      return {
        sku,
        label: def?.displayName ?? sku,
        kind: "finish" as const,
      };
    });
    const all = [...productOpts, ...finishOpts];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 40);
    return all
      .filter(
        (o) =>
          o.sku.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [listings, finishSkus, query]);

  useEffect(() => {
    if (!wooSku && listings[0]) {
      setWooSku(listings[0].wooSku || listings[0].globalSku);
    }
  }, [listings, wooSku]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end" data-testid="glb-upload-zone">
      <div className="relative min-w-[14rem] flex-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Product &amp; Finish SKU
          <input
            value={query || wooSku}
            onChange={(e) => {
              setQuery(e.target.value);
              setWooSku(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search SKU or name…"
            data-testid="portal-sku-combobox"
            className={`mt-0.5 block w-full rounded px-2 py-1.5 font-mono text-xs ${FINISH_INPUT}`}
          />
        </label>
        {open ? (
          <ul
            className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-600 bg-slate-900 py-1 shadow-xl"
            data-testid="portal-sku-combobox-list"
          >
            {options.map((o) => (
              <li key={`${o.kind}-${o.sku}`}>
                <button
                  type="button"
                  className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-amber-500/15"
                  onClick={() => {
                    setWooSku(o.sku);
                    setQuery(o.sku);
                    setOpen(false);
                  }}
                >
                  <span className="font-mono text-[11px] text-amber-300">{o.sku}</span>
                  <span className="text-[10px] text-slate-400">
                    {o.kind}: {o.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="min-w-[12rem] flex-1">
        <DropButton
          label="Upload Photo / .glb"
          accept={MEDIA_ACCEPT}
          busy={busy}
          disabled={!wooSku.trim() || busy}
          progress={progress}
          testId="glb-upload-btn"
          onFile={async (file) => {
            setBusy(true);
            setProgress(0);
            const isGlb = /\.glb$/i.test(file.name) || file.type.includes("gltf");
            const isFinish = finishSkus.includes(wooSku.trim().toUpperCase());
            const res = isFinish
              ? await uploadEmbedAsset({
                  embedToken,
                  kind: "finish_swatch",
                  slot: "texture_2k",
                  sku: wooSku.trim().toUpperCase(),
                  file,
                  onProgress: (pct) => setProgress(pct),
                })
              : await uploadEmbedAsset({
                  embedToken,
                  kind: "product_3d",
                  slot: isGlb ? "glb" : "poster",
                  wooSku: wooSku.trim(),
                  file,
                  onProgress: (pct) => setProgress(pct),
                });
            setBusy(false);
            setProgress(null);
            onToast(
              res.ok
                ? `${isGlb ? ".glb" : "Image"} uploaded for ${wooSku.trim()}`
                : res.error,
            );
          }}
        />
      </div>
    </div>
  );
}

/**
 * Unified dark E-Commerce Certification & Handoff Portal —
 * default surface for `/embed/admin/master-catalog` (GHL tab).
 */
export default function EcommerceCertificationPortal({
  listings,
  listingsLoading,
  listingsError,
  miaApprovedCount,
  sowItemCount,
  parentCount = PHASE1_PARENT_COUNT,
  variationCount = PHASE1_VARIATION_COUNT,
  simpleCount = PHASE1_SIMPLE_COUNT,
  purchasableSkuCount = PHASE1_PURCHASABLE_SKU_COUNT,
  wooBadgeLabel,
  wooConfigured,
  onToast,
  onListingsChange,
  onOpenProductEdit,
  initialAssets,
  initialStackLayers,
  initialIntake,
}: Props) {
  const { embedToken } = useEmbedSession();
  const [tab, setTab] = useState<PortalTab>("intake");
  const [intakeItems, setIntakeItems] = useState<FinishIntakeView[]>(() => initialIntake ?? []);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [syncSkuQuery, setSyncSkuQuery] = useState("");
  const [syncSkuOpen, setSyncSkuOpen] = useState(false);
  const [syncSku, setSyncSku] = useState("");
  const [finishSubFilter, setFinishSubFilter] = useState<FinishSubFilter>("all_active");
  const [archivedAssets, setArchivedAssets] = useState<FinishAssetView[]>([]);
  const [archivedProducts, setArchivedProducts] = useState<
    Array<{
      id: string;
      globalSku: string;
      wooSku: string | null;
      productName: string;
      collectionLabel: string;
      archivedAt: string | null;
    }>
  >([]);
  const [stagedChanges, setStagedChanges] = useState<StagedPortalChange[]>([]);
  const [committing, setCommitting] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<
    (ArchiveImpactTarget & { listingId?: string }) | null
  >(null);
  const [guidance, setGuidance] = useState<string | null>(null);
  const [productTypeFilter, setProductTypeFilter] = useState<ProductTypeFilter>("all");
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>("none");
  const [assets, setAssets] = useState<FinishAssetView[]>(() => initialAssets ?? []);
  const [assetsLoading, setAssetsLoading] = useState(!(initialAssets && initialAssets.length > 0));
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [addName, setAddName] = useState<Partial<Record<FinishAssetCategory, string>>>({});
  const [adding, setAdding] = useState<FinishAssetCategory | null>(null);
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [downloadUrls, setDownloadUrls] = useState<{
    csv: string;
    spec: string;
    swatches: string;
    finishes: string;
  } | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("https://hub.ccpatio.com/api/webhooks/woocommerce");
  const [dryRunJson, setDryRunJson] = useState<string | null>(null);
  const [addErrors, setAddErrors] = useState<Partial<Record<FinishAssetCategory, string>>>({});
  const [stagingBusy, setStagingBusy] = useState<"swatches_scales" | "certified_catalog" | null>(
    null,
  );
  const [stagingNote, setStagingNote] = useState<string | null>(null);
  const [lightboxAsset, setLightboxAsset] = useState<FinishAssetView | null>(null);
  const [catalogShapeFilter, setCatalogShapeFilter] = useState<CatalogShapeFilter>("all");
  const [operatorInfoOpen, setOperatorInfoOpen] = useState(false);
  const [policyInfoOpen, setPolicyInfoOpen] = useState(false);
  const [dlqRows, setDlqRows] = useState<DlqOpenRow[]>([]);
  /** Live Woo probe for Tab 4 — never trust env-only `wooConfigured` for a green badge. */
  const [wooProbe, setWooProbe] = useState<
    | { state: "probing" }
    | { state: "ok"; host: string }
    | { state: "failed"; reason: string; httpStatus?: number }
  >({ state: "probing" });

  const runWooProbe = useCallback(async () => {
    setWooProbe({ state: "probing" });
    try {
      const result = await testWooConnectionAction();
      if (result.ok) {
        setWooProbe({ state: "ok", host: result.host });
      } else {
        setWooProbe({
          state: "failed",
          reason: result.reason,
          httpStatus: result.httpStatus,
        });
      }
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Woo probe threw";
      setWooProbe({ state: "failed", reason, httpStatus: 500 });
      return { ok: false as const, reason };
    }
  }, []);

  useEffect(() => {
    if (tab !== "sync") return;
    void runWooProbe();
  }, [tab, runWooProbe]);

  const reconciled = useMemo(
    () => reconcileMiaApprovedCounts(listings),
    [listings],
  );
  const approvedShown = listings.length ? reconciled.miaApprovedCount : miaApprovedCount;
  const sowShown = listings.length ? reconciled.sowItemCount : sowItemCount || PHASE1_SOW_ITEM_COUNT;

  const loadAssets = useCallback(async () => {
    setAssetsLoading(true);
    const res = await listFinishAssetsForPortal();
    if (res.ok) {
      setAssets(res.assets);
      setArchivedAssets(res.archivedAssets ?? []);
      setAssetsError(null);
    } else {
      setAssetsError(res.error);
    }
    setAssetsLoading(false);
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const refreshIntake = useCallback(async () => {
    setIntakeLoading(true);
    const res = await listFinishIntakeAction();
    if (res.ok) {
      setIntakeItems(res.items);
      setIntakeError(res.powderWarning);
      if (res.powderPatched.length > 0) void loadAssets();
    } else {
      setIntakeError(res.error);
    }
    setIntakeLoading(false);
  }, [loadAssets]);

  // SSR normally hydrates the queue; fetch only when it did not (or came back empty).
  useEffect(() => {
    if (!initialIntake || initialIntake.length === 0) void refreshIntake();
  }, [initialIntake, refreshIntake]);

  /** Products missing media OR freight dims — Tab 1 Mode B queue. */
  const productsNeedingMedia = useMemo(
    () =>
      listings
        .filter((l) => {
          const dimsReady =
            freightDimsBadge({
              weightLb: l.hubWeight,
              lengthIn: l.hubLength,
              widthIn: l.hubDepth,
              heightIn: l.hubHeight,
            }) === "Ready";
          const hasMedia = Boolean(l.model3dGlbUrl || l.imageUrl);
          return !dimsReady || !hasMedia;
        })
        .map((l) => ({
          wooSku: (l.wooSku || l.globalSku).toUpperCase(),
          title: stripFinBracketsFromTitle(l.productName) || l.productName,
        })),
    [listings],
  );

  const syncSkuOptions = useMemo(() => {
    const q = syncSkuQuery.trim().toLowerCase();
    return listings
      .map((l) => ({
        sku: l.globalSku,
        label: stripFinBracketsFromTitle(l.productName) || l.productName,
        woo: (l.wooSku ?? "").toUpperCase(),
      }))
      .filter(
        (o) =>
          !q ||
          o.sku.toLowerCase().includes(q) ||
          o.woo.toLowerCase().includes(q) ||
          o.label.toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [listings, syncSkuQuery]);

  const handleDrawerAction = useCallback(
    async (_layerId: string, actionId: string) => {
      if (actionId === "qbo_verify_token") {
        const res = await verifyLiveQboTokenAction();
        onToast(res.ok ? `QBO token valid — ${res.companyName ?? "OK"}` : res.error);
      } else if (actionId === "qbo_verify_credentials_pair") {
        const res = await verifyQboCredentialsPairAction();
        onToast(
          res.ok
            ? `${res.label} · secretSha256Prefix8=${res.secretSha256Prefix8} · oauth_error=${res.oauthError ?? "n/a"}`
            : res.error,
        );
      } else if (actionId === "fedex_view_missing_dims") {
        setTab("products");
        setReadinessFilter("missing_dims");
        setGuidance("Filtered to products missing freight dimensions.");
      } else if (actionId === "woo_held_orders") {
        onToast("Held orders are managed in WooCommerce admin → Orders → On Hold.");
        setGuidance("View held orders in WooCommerce admin → Orders → On Hold.");
      } else if (actionId === "dlq_archive_stale") {
        const res = await archiveOpenDlqEventsAction();
        onToast(res.ok ? `Archived ${res.resolved} stale DLQ events` : res.error);
        if (res.ok) {
          const refresh = await listOpenDlqEventsAction();
          if (refresh.ok) setDlqRows(refresh.rows);
        }
      } else if (actionId.startsWith("dlq_retry:")) {
        const id = actionId.replace("dlq_retry:", "");
        const res = await retryDlqEventAction(id);
        onToast(res.ok ? res.message : res.error);
      } else if (actionId.startsWith("dlq_resolve:")) {
        const id = actionId.replace("dlq_resolve:", "");
        const res = await resolveDlqEventAction(id);
        onToast(res.ok ? "DLQ event resolved" : res.error);
        if (res.ok) {
          const refresh = await listOpenDlqEventsAction();
          if (refresh.ok) setDlqRows(refresh.rows);
          else setDlqRows((prev) => prev.filter((r) => r.id !== id));
        }
      } else if (actionId === "layer_reprobe") {
        onToast("Re-probing…");
      }
    },
    [onToast],
  );

  const loadDlqRows = useCallback(async () => {
    const res = await listOpenDlqEventsAction();
    if (res.ok) setDlqRows(res.rows);
  }, []);

  useEffect(() => {
    void loadDlqRows();
  }, [loadDlqRows]);

  const dlqDrawerExtras = useMemo(() => {
    if (dlqRows.length === 0) return <p className="text-xs text-slate-500">No open DLQ events.</p>;
    return (
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Open DLQ Events ({dlqRows.length})
        </p>
        {dlqRows.map((row) => (
          <div
            key={row.id}
            className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs"
          >
            <div className="min-w-0 flex-1">
              <span className="font-mono text-amber-300">{row.functionId}</span>
              <span className="ml-2 text-slate-500">{row.eventName}</span>
              <span className="ml-2 text-rose-400 truncate">{row.errorMessage?.slice(0, 60)}</span>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => void handleDrawerAction("inngest_dlq", `dlq_retry:${row.id}`)}
                className="rounded bg-amber-500/20 px-2 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/30"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => void handleDrawerAction("inngest_dlq", `dlq_resolve:${row.id}`)}
                className="rounded bg-slate-500/20 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-500/30"
              >
                Resolve
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }, [dlqRows, handleDrawerAction]);

  useEffect(() => {
    void getPrimeviewHandoffDownloadUrls().then((res) => {
      if (!res.ok) return;
      setDownloadUrls({
        csv: res.csv,
        spec: res.spec,
        swatches: res.swatches,
        finishes: res.finishes ?? res.swatches,
      });
    });
  }, []);

  const collections = useMemo(
    () => [...new Set(listings.map((l) => l.collectionLabel).filter(Boolean))].sort(),
    [listings],
  );

  const productRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    const typeMatch = (name: string) => {
      const n = name.toLowerCase();
      switch (productTypeFilter) {
        case "sofas":
          return n.includes("sofa") || n.includes("sectional");
        case "chairs":
          return n.includes("chair") || n.includes("lounger") || n.includes("chaise");
        case "tables":
          return n.includes("table") || n.includes("dining");
        case "ottomans":
          return n.includes("ottoman") || n.includes("bench");
        case "swings":
          return n.includes("swing");
        case "misc":
          return (
            n.includes("umbrella") ||
            n.includes("heater") ||
            n.includes("lamp") ||
            n.includes("pool")
          );
        default:
          return true;
      }
    };
    let filtered = listings
      .filter((l) => {
        if (collection && l.collectionLabel !== collection) return false;
        if (!typeMatch(l.productName)) return false;
        if (statusFilter === "approved" && !l.miaApproved) return false;
        if (
          statusFilter === "spot_check" &&
          !needsMiaSpotCheck({
            globalSku: l.globalSku,
            attributes: l.attributes,
            wooSku: l.wooSku,
            miaApproved: l.miaApproved,
          })
        ) {
          return false;
        }
        const freight = freightDimsBadge({
          weightLb: l.hubWeight,
          lengthIn: l.hubLength,
          widthIn: l.hubDepth,
          heightIn: l.hubHeight,
        });
        if (readinessFilter === "missing_dims" && freight === "Ready") return false;
        if (readinessFilter === "missing_media" && Boolean(l.model3dGlbUrl || l.imageUrl))
          return false;
        if (
          readinessFilter === "spot_check" &&
          !needsMiaSpotCheck({
            globalSku: l.globalSku,
            attributes: l.attributes,
            wooSku: l.wooSku,
            miaApproved: l.miaApproved,
          })
        ) {
          return false;
        }
        if (readinessFilter === "approved" && !l.miaApproved) return false;
        if (readinessFilter === "archived") return false;
        if (!q) return true;
        return (
          l.productName.toLowerCase().includes(q) ||
          l.globalSku.toLowerCase().includes(q) ||
          (l.wooSku ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.sheetOrder - b.sheetOrder || a.globalSku.localeCompare(b.globalSku));

    if (catalogShapeFilter === "variations") {
      filtered = filtered.filter((l) => /-(LS|RS)$/i.test(l.wooSku || l.globalSku));
    } else if (catalogShapeFilter === "simple") {
      filtered = filtered.filter((l) => {
        const sku = (l.wooSku || l.globalSku).toUpperCase();
        if (/-(LS|RS)$/i.test(sku)) return false;
        const vLabel = formatVariationsFacing({
          globalSku: l.globalSku,
          wooSku: l.wooSku,
          hasLsRsPair: false,
          variationCount: 1,
          productName: l.productName,
          collectionLabel: l.collectionLabel,
        });
        return vLabel === "Simple";
      });
    } else if (catalogShapeFilter === "parents") {
      const seen = new Set<string>();
      filtered = filtered.filter((l) => {
        const key = sowKeyFromSku(l.globalSku);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      filtered.sort((a, b) => {
        const aIsParent = !/-(LS|RS)$/i.test(a.wooSku || a.globalSku) ? 0 : 1;
        const bIsParent = !/-(LS|RS)$/i.test(b.wooSku || b.globalSku) ? 0 : 1;
        return aIsParent - bIsParent || a.globalSku.localeCompare(b.globalSku);
      });
    }

    return filtered;
  }, [listings, search, collection, statusFilter, productTypeFilter, readinessFilter, catalogShapeFilter]);

  async function handleAdd(category: FinishAssetCategory) {
    const name = (addName[category] ?? "").trim();
    if (!name) {
      setAddErrors((prev) => ({
        ...prev,
        [category]: "Enter a display name before adding a finish.",
      }));
      return;
    }
    setAddErrors((prev) => ({ ...prev, [category]: undefined }));
    setAdding(category);
    const res = await addFinishRowForPortal({ category, displayName: name });
    setAdding(null);
    if (!res.ok) {
      setAddErrors((prev) => ({ ...prev, [category]: res.error }));
      onToast(res.error);
      return;
    }
    setAddName((prev) => ({ ...prev, [category]: "" }));
    onToast(`Added ${res.asset.sku} (SKU locked)`);
    await loadAssets();
  }

  async function loadArchivedProducts() {
    const res = await listArchivedEcommerceListingsForPortal();
    if (res.ok) setArchivedProducts(res.listings);
  }

  useEffect(() => {
    void loadArchivedProducts();
  }, []);

  function stageArchiveFinish(sku: string, displayName: string) {
    const id = `archive_finish:${sku}:${Date.now()}`;
    setStagedChanges((prev) => [
      ...prev.filter((c) => !(c.kind === "archive_finish" && c.sku === sku)),
      { id, kind: "archive_finish", sku, label: displayName, stagedAt: new Date().toISOString() },
    ]);
    onToast(`Staged archive for ${sku}`);
  }

  function stageArchiveProduct(listingId: string, sku: string, productName: string) {
    const id = `archive_product:${listingId}:${Date.now()}`;
    setStagedChanges((prev) => [
      ...prev.filter((c) => !(c.kind === "archive_product" && c.listingId === listingId)),
      {
        id,
        kind: "archive_product",
        sku,
        listingId,
        label: productName,
        stagedAt: new Date().toISOString(),
      },
    ]);
    onToast(`Staged product archive for ${sku}`);
  }

  async function commitStagedChanges() {
    if (!stagedChanges.length) return;
    setCommitting(true);
    for (const change of stagedChanges) {
      if (change.kind === "archive_finish") {
        const res = await disableFinishRowForPortal(change.sku);
        if (!res.ok) {
          onToast(res.error);
          setCommitting(false);
          return;
        }
      } else if (change.kind === "restore_finish") {
        const res = await reenableFinishRowForPortal(change.sku);
        if (!res.ok) {
          onToast(res.error);
          setCommitting(false);
          return;
        }
      } else if (change.kind === "archive_product") {
        const res = await archiveEcommerceListingForPortal(change.listingId);
        if (!res.ok) {
          onToast(res.error);
          setCommitting(false);
          return;
        }
        onListingsChange(listings.filter((l) => l.id !== change.listingId));
      } else if (change.kind === "restore_product") {
        const res = await restoreEcommerceListingForPortal(change.listingId);
        if (!res.ok) {
          onToast(res.error);
          setCommitting(false);
          return;
        }
      }
    }
    setStagedChanges([]);
    setCommitting(false);
    onToast("Committed roster/catalog changes");
    await loadAssets();
    await loadArchivedProducts();
  }

  const variationPairSkus = useMemo(() => {
    const parents = new Map<string, Set<string>>();
    for (const l of listings) {
      const sku = (l.wooSku || l.globalSku).toUpperCase();
      const parent = sku.replace(/-(LS|RS)$/i, "");
      if (!parents.has(parent)) parents.set(parent, new Set());
      parents.get(parent)!.add(sku);
    }
    return parents;
  }, [listings]);

  return (
    <div
      className="h-[100dvh] max-h-[100dvh] min-h-0 overflow-y-auto overscroll-contain bg-[#0b0f17] pb-24 text-slate-100"
      data-testid="ecommerce-certification-portal"
    >
      <div className="w-full max-w-none px-5 py-6 xl:px-8">
        <ExecutiveStackHealthStrip
          onToast={onToast}
          initialLayers={initialStackLayers ?? null}
          onDrawerAction={handleDrawerAction}
          drawerExtras={dlqDrawerExtras}
        />
        <header className="border-b border-white/10 pb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/90">
                CC PATIO · EXECUTIVE CONTROL PLANE
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Executive Control Center
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">
                Unified dark certification lane — {assets.length} active storefront finishes · locked
                system SKUs · Mia / Kian / SuperAdmin.
              </p>
              <div className="relative mt-2 inline-block">
                <button
                  type="button"
                  onClick={() => setOperatorInfoOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-500/20 cursor-pointer hover:bg-amber-500/20"
                >
                  <Shield className="h-3.5 w-3.5" />
                  Rob · Mia · Kian · Executive
                </button>
                {operatorInfoOpen ? (
                  <div
                    data-testid="operator-info-popover"
                    className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-white/10 bg-slate-900 p-4 text-xs text-slate-300 shadow-xl"
                  >
                    <p className="font-semibold text-white">Operator Roles</p>
                    <ul className="mt-2 space-y-1">
                      <li><span className="font-semibold text-amber-300">Rob</span> — Owner / executive sign-off</li>
                      <li><span className="font-semibold text-amber-300">Mia</span> — Catalog QA & spot-check approvals</li>
                      <li><span className="font-semibold text-amber-300">Kian</span> — 3D asset pipeline & finish calibration</li>
                      <li><span className="font-semibold text-amber-300">Executive</span> — Authorized GHL embed sessions &amp; Superadmin: full portal access, staging push, archive</li>
                    </ul>
                    <button
                      type="button"
                      onClick={() => setOperatorInfoOpen(false)}
                      className="mt-3 text-[10px] text-slate-500 hover:text-white"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-500/30"
                data-testid="mia-approved-pill"
                onClick={() => {
                  setTab("products");
                  setStatusFilter("approved");
                  setGuidance(`Filtering ${approvedShown} Mia-approved SOW items.`);
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Mia Approved {approvedShown} / {sowShown}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-3 py-1 text-xs font-semibold text-sky-200 ring-1 ring-sky-500/30"
                data-testid="storefront-readiness-pill"
                onClick={() => {
                  setTab("finishes");
                  setFinishSubFilter("all_active");
                  setGuidance("Active finish roster — upload swatches + 2048px textures.");
                }}
              >
                <Activity className="h-3.5 w-3.5" />
                Storefront Readiness · {assets.length} / {ECOMMERCE_32_FINISH_COUNT} Finishes
              </button>
            </div>
          </div>

          {guidance ? (
            <div
              className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-xs text-sky-100"
              data-testid="portal-guidance-strip"
            >
              <span>{guidance}</span>
              <button
                type="button"
                className="text-sky-200/80 hover:text-white"
                onClick={() => setGuidance(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="portal-kpi-cards">
            {(
              [
                ["Parents", parentCount, "parents" as CatalogShapeFilter],
                ["Variations", variationCount, "variations" as CatalogShapeFilter],
                ["Simple", simpleCount, "simple" as CatalogShapeFilter],
                ["Purchasable SKUs", purchasableSkuCount, "purchasable" as CatalogShapeFilter],
              ] as const
            ).map(([label, n, shape]) => (
              <button
                key={label}
                type="button"
                data-testid={`portal-kpi-${shape}`}
                onClick={() => {
                  setTab("products");
                  setCatalogShapeFilter(shape);
                  setReadinessFilter("none");
                  setGuidance(`Opened ${label} view.`);
                }}
                className="rounded-lg bg-[#111827] px-3 py-2 text-left ring-1 ring-white/10 hover:ring-amber-400/40"
              >
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className="text-lg font-semibold text-white">{n}</dd>
              </button>
            ))}
            <button
              type="button"
              data-testid="portal-kpi-active-finishes"
              onClick={() => {
                setTab("finishes");
                setFinishSubFilter("all_active");
                setGuidance("Opened Active Finishes view.");
              }}
              className="rounded-lg bg-[#111827] px-3 py-2 text-left ring-1 ring-white/10 hover:ring-amber-400/40"
            >
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Active Finishes</dt>
              <dd className="text-lg font-semibold text-white">{assets.length}</dd>
            </button>
          </dl>
        </header>

        <nav
          className="sticky top-0 z-20 mt-6 flex flex-wrap gap-2 bg-[#0b0f17]/95 py-2 backdrop-blur"
          role="tablist"
          data-testid="portal-pill-tabs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "intake"}
            data-testid="portal-tab-intake"
            onClick={() => setTab("intake")}
            className={chip(tab === "intake")}
          >
            <span className="inline-flex items-center gap-1.5">
              <ImagePlus className="h-3.5 w-3.5" />
              Intake &amp; Media Studio
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "finishes"}
            data-testid="portal-tab-finishes"
            onClick={() => setTab("finishes")}
            className={chip(tab === "finishes")}
          >
            <span className="inline-flex items-center gap-1.5">
              <Palette className="h-3.5 w-3.5" />
              Certified Finishes &amp; Add-Ons
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "products"}
            data-testid="portal-tab-products"
            onClick={() => setTab("products")}
            className={chip(tab === "products")}
          >
            Certified Products
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "sync"}
            data-testid="portal-tab-sync"
            onClick={() => setTab("sync")}
            className={chip(tab === "sync")}
          >
            WooCommerce Sync &amp; Handoff
          </button>
        </nav>

        {tab === "intake" ? (
          <>
            {intakeError ? (
              <p
                className="mt-6 rounded-lg bg-rose-500/10 p-3 text-xs text-rose-300"
                data-testid="intake-load-error"
              >
                {intakeError}
              </p>
            ) : null}
            {intakeLoading ? (
              <p className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Refreshing intake queue…
              </p>
            ) : null}
            <IntakeMediaStudio
              initialItems={intakeItems}
              onRefresh={() => void refreshIntake()}
              productsNeedingMedia={productsNeedingMedia}
            />
          </>
        ) : null}

        {tab === "finishes" ? (
          <div className="mt-6 space-y-6" data-testid="portal-panel-finishes">
            <div className="flex flex-wrap gap-2" data-testid="portal-finish-subfilters">
              {(
                [
                  ["all_active", `All Active (${assets.length})`],
                  ["sunbrella", `Sunbrella (${assets.filter((a) => { const d = ecommerceFinishBySku(a.sku); return d?.family === "sunbrella"; }).length})`],
                  ["ultraleather", `Ultraleather (${assets.filter((a) => { const d = ecommerceFinishBySku(a.sku); return d?.family === "ultraleather"; }).length})`],
                  ["dekton", `Dekton (${assets.filter((a) => { const d = ecommerceFinishBySku(a.sku); return d?.family === "dekton"; }).length})`],
                  ["powder", `Powder Coats (${assets.filter((a) => { const d = ecommerceFinishBySku(a.sku); return d?.family === "powder"; }).length})`],
                  ["addons", "Storefront Add-Ons (5)"],
                  ["archived", `Archived (${archivedAssets.length})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  data-testid={`finish-subfilter-${key}`}
                  onClick={() => setFinishSubFilter(key)}
                  className={chip(finishSubFilter === key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setPolicyInfoOpen((v) => !v)}
                className="w-full rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-left text-xs text-amber-100 cursor-pointer hover:bg-amber-500/15"
              >
                {STOREFRONT_POLICY_BANNER}
                <span className="mt-1 block text-amber-200/80">
                  Aluminum-Only Storefront Policy — Steel/+10% Excluded from web export.
                </span>
              </button>
              {policyInfoOpen ? (
                <div
                  data-testid="policy-info-popover"
                  className="absolute left-0 top-full z-30 mt-2 w-96 rounded-xl border border-white/10 bg-slate-900 p-4 text-xs text-slate-300 shadow-xl"
                >
                  <p className="font-semibold text-white">Aluminum-Only Storefront Policy</p>
                  <p className="mt-2">
                    Only aluminum-frame products are exported to the web storefront.
                    Steel frames carry a +10% surcharge and are excluded from automated
                    WooCommerce sync. This prevents incorrect pricing from reaching customers.
                  </p>
                  <p className="mt-2 text-slate-400">
                    Powder coat finishes (6 active) apply exclusively to the aluminum frame SKUs.
                    Steel variants must be quoted manually.
                  </p>
                  <button
                    type="button"
                    onClick={() => setPolicyInfoOpen(false)}
                    className="mt-3 text-[10px] text-slate-500 hover:text-white"
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
            </div>
            {assetsError ? (
              <p className="rounded-lg bg-rose-500/10 p-3 text-xs text-rose-300">{assetsError}</p>
            ) : null}
            {finishSubFilter === "archived" ? (
              <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#111827]">
                <table className="min-w-full text-left text-xs">
                  <tbody>
                    {archivedAssets.length === 0 ? (
                      <tr>
                        <td className="px-3 py-8 text-center text-slate-500">No archived finishes.</td>
                      </tr>
                    ) : (
                      archivedAssets.map((a) => (
                        <DarkFinishRow
                          key={a.sku}
                          asset={a}
                          embedToken={embedToken}
                          onChanged={() => void loadAssets()}
                          onToast={onToast}
                          onArchive={() => {}}
                          restoreMode
                          onRestore={(sku) => {
                            setStagedChanges((prev) => [
                              ...prev,
                              {
                                id: `restore_finish:${sku}:${Date.now()}`,
                                kind: "restore_finish",
                                sku,
                                label: a.displayName,
                                stagedAt: new Date().toISOString(),
                              },
                            ]);
                            onToast(`Staged restore for ${sku}`);
                          }}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </section>
            ) : null}
            {finishSubFilter === "addons" ? (
              <section
                className="rounded-2xl border border-white/10 bg-[#111827] p-5"
                data-testid="storefront-addons-editor"
              >
                <h2 className="text-sm font-semibold text-white">Storefront Add-Ons Editor</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Configure purchasable add-on categories for the storefront.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    { title: "Cushion Core/Fill", desc: "Foam density, quick-dry fill, Dacron wrap options." },
                    { title: "Accent Pillows", desc: "Lumbar & throw pillow pairings per finish family." },
                    { title: "Protective Covers", desc: "All-weather covers matched to product dimensions." },
                    { title: "Dekton Tabletop Rules", desc: "Slab size constraints and edge-profile selections." },
                    { title: "Umbrella Bases", desc: "Weight & bolt-down base pairings per umbrella SKU." },
                  ].map((addon) => (
                    <div
                      key={addon.title}
                      className="rounded-xl border border-white/10 bg-slate-900/60 p-4"
                    >
                      <h3 className="text-xs font-semibold text-amber-300">{addon.title}</h3>
                      <p className="mt-1 text-[11px] text-slate-400">{addon.desc}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {assetsLoading && assets.length === 0 ? (
              <div className="flex items-center gap-2 py-16 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading finishes…
              </div>
            ) : finishSubFilter !== "archived" && finishSubFilter !== "addons" ? (
              FAMILY_GROUPS.filter((group) => {
                if (finishSubFilter === "all_active") return true;
                return finishSubFilter === group.key;
              }).map((group) => {
                const rosterSkus = new Set(group.skus());
                const rows = assets.filter(
                  (a) => a.finishCategory === group.category && rosterSkus.has(a.sku),
                );
                const fallbackRows =
                  rows.length > 0
                    ? rows
                    : assets.filter((a) => {
                        const def = ECOMMERCE_32_FINISHES.find((f) => f.sku === a.sku);
                        return def?.family === group.key;
                      });
                const shown = fallbackRows.length ? fallbackRows : rows;
                return (
                  <section
                    key={group.key}
                    className="overflow-hidden rounded-2xl border border-white/10 bg-[#111827]"
                    data-testid={`finish-group-${group.key}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
                      <div>
                        <h2 className="text-sm font-semibold text-white">
                          {group.title}{" "}
                          <span
                            className="text-slate-400"
                            data-testid={`finish-group-count-${group.key}`}
                          >
                            ({shown.length}/{group.count})
                          </span>
                        </h2>
                        <p className="mt-1 inline-flex rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-200">
                          APF Target Group · {group.apf}
                        </p>
                        {group.policyBadge ? (
                          <p className="mt-1 inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                            Aluminum-Only Storefront Policy — Steel/+10% Excluded
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-end gap-2" data-testid={`finish-add-${group.category}`}>
                        <button
                          type="button"
                          data-testid={`finish-stage-intake-${group.category}`}
                          onClick={() => setTab("intake")}
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-slate-950"
                        >
                          {`+ Stage New ${group.title} in Intake →`}
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-white/5 text-[10px] uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Swatch</th>
                            <th className="px-3 py-2">2048px</th>
                            <th className="px-3 py-2">Canonical SKU</th>
                            <th className="px-3 py-2">Display Name</th>
                            <th className="px-3 py-2">Pattern Repeat (in)</th>
                            <th className="px-3 py-2">Texture Scale</th>
                            <th className="min-w-[165px] px-3 py-2">APF GROUP</th>
                            <th className="px-3 py-2">Upload</th>
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {shown.length === 0 ? (
                            <tr>
                              <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                                No active rows — stage a new finish in Tab 1 Intake (SKU auto-locks).
                              </td>
                            </tr>
                          ) : (
                            shown.map((a) => (
                              <DarkFinishRow
                                key={a.sku}
                                asset={a}
                                embedToken={embedToken}
                                onChanged={() => void loadAssets()}
                                onToast={onToast}
                                onArchive={(sku, displayName) =>
                                  setArchiveTarget({ kind: "finish", sku, displayName })
                                }
                                onInspect={() => setLightboxAsset(a)}
                              />
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })
            ) : null}
          </div>
        ) : null}

        {tab === "products" ? (
          <div className="mt-6 space-y-4" data-testid="portal-panel-products">
            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#111827] p-4">
              <div className="relative max-w-xl" data-testid="portal-product-search">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search products or FIN-* SKU…"
                  className="w-full rounded-xl border border-white/10 bg-[#0b0f17] py-2.5 pl-10 pr-3 text-sm text-slate-100 placeholder:text-slate-600"
                  data-testid="portal-search-input"
                />
              </div>
              <div className="flex flex-wrap gap-2" data-testid="portal-collection-pills">
                <button
                  type="button"
                  onClick={() => setCollection("")}
                  className={chip(!collection)}
                >
                  All collections
                </button>
                {collections.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCollection(c)}
                    className={chip(collection === c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2" data-testid="portal-product-type-pills">
                {(
                  [
                    ["all", "All Types"],
                    ["sofas", "Sofas & Sectionals"],
                    ["chairs", "Chairs & Loungers"],
                    ["tables", "Tables"],
                    ["ottomans", "Ottomans"],
                    ["swings", "Swings"],
                    ["misc", "Umbrellas, Heaters & Misc"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    data-testid={`portal-product-type-${key}`}
                    onClick={() => setProductTypeFilter(key)}
                    className={chip(productTypeFilter === key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2" data-testid="portal-readiness-filters">
                {(
                  [
                    ["none", "All readiness"],
                    ["missing_dims", "Missing Dims"],
                    ["missing_media", "Missing 3D/Media"],
                    ["spot_check", "Needs Mia Spot-Check"],
                    ["approved", "Mia Approved"],
                    ["archived", `Archived (${archivedProducts.length})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    data-testid={`portal-readiness-${key}`}
                    onClick={() => {
                      setReadinessFilter(key);
                      if (key === "spot_check") setStatusFilter("spot_check");
                      else if (key === "approved") setStatusFilter("approved");
                      else setStatusFilter("all");
                      if (key === "archived") void loadArchivedProducts();
                    }}
                    className={chip(readinessFilter === key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {listingsError ? (
              <p className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{listingsError}</p>
            ) : listingsLoading && listings.length === 0 ? (
              <div className="flex items-center gap-2 py-16 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading products…
              </div>
            ) : productRows.length === 0 ? (
              <div
                className="rounded-2xl border border-white/10 bg-[#111827] px-6 py-12 text-center text-sm text-slate-300"
                data-testid="portal-products-empty"
              >
                0 items match this filter — adjust product type or readiness pills.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#111827]">
                <table className="min-w-full text-left text-sm" data-testid="portal-products-table">
                  <thead className="bg-white/5 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5">Product Name</th>
                      <th className="px-3 py-2.5">Canonical Hub SKU</th>
                      <th className="px-3 py-2.5">Variations / Facing</th>
                      <th className="px-3 py-2.5">Aluminum MSRP</th>
                      <th className="px-3 py-2.5">Readiness</th>
                      <th className="px-3 py-2.5">Media / 3D</th>
                      <th className="px-3 py-2.5">Mia Approved</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {productRows.map((row) => {
                      const parentKey = (row.wooSku || row.globalSku)
                        .toUpperCase()
                        .replace(/-(LS|RS)$/i, "");
                      const pairSize = variationPairSkus.get(parentKey)?.size ?? 1;
                      const hasLsRs =
                        pairSize >= 2 ||
                        [...(variationPairSkus.get(parentKey) ?? [])].some((s) =>
                          /-(LS|RS)$/i.test(s),
                        ) ||
                        listings.some(
                          (o) =>
                            o.id !== row.id &&
                            sameGroupedParent(o.globalSku, row.globalSku),
                        );
                      const variationsLabel = formatVariationsFacing({
                        globalSku: row.globalSku,
                        wooSku: row.wooSku,
                        hasLsRsPair: hasLsRs,
                        variationCount: pairSize,
                        productName: row.productName,
                        collectionLabel: row.collectionLabel,
                      });
                      const surface = inferSurfaceProfile({
                        productName: row.productName,
                        collectionLabel: row.collectionLabel,
                        attributes: row.attributes,
                      });
                      const surfaceBadge = surfaceBadgeFromProfile(surface);
                      const freightBadge = freightDimsBadge({
                        weightLb: row.hubWeight,
                        lengthIn: row.hubLength,
                        widthIn: row.hubDepth,
                        heightIn: row.hubHeight,
                      });
                      const media = mediaBadge({
                        hasGlb: Boolean(row.model3dGlbUrl),
                        hasHubMedia: Boolean(row.imageUrl),
                        preserveWpGallery: true,
                      });
                      const needsSpot = needsMiaSpotCheck({
                        globalSku: row.globalSku,
                        attributes: row.attributes,
                        wooSku: row.wooSku,
                        miaApproved: row.miaApproved,
                      });
                      return (
                        <tr
                          key={row.id}
                          className="border-t border-white/5 text-slate-200"
                          data-testid={`product-row-${row.globalSku}`}
                        >
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-white">
                              {storefrontDisplayTitle(row.productName) || row.productName}
                            </div>
                            {isAllCapsFactoryTitle(row.productName) ? (
                              <div
                                className="text-[11px] text-slate-500"
                                data-testid={`product-factory-title-${row.globalSku}`}
                              >
                                {row.productName}
                              </div>
                            ) : null}
                            <div className="text-[11px] text-slate-500">{row.collectionLabel}</div>
                            {needsSpot ? (
                              <span
                                className="mt-1 inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-200"
                                data-testid={`needs-spot-check-${row.globalSku}`}
                              >
                                Needs Spot-Check
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-xs text-amber-300">
                              <Lock className="h-3 w-3 text-amber-400/60" />
                              {row.globalSku}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-300">
                            {variationsLabel}
                          </td>
                          <td
                            className="px-3 py-2.5 tabular-nums"
                            data-testid={`product-price-${row.globalSku}`}
                          >
                            {row.aluminumMsrp
                              ? row.aluminumMsrp
                              : row.aluminumMsrpValue != null
                                ? `$${row.aluminumMsrpValue.toFixed(2)}`
                                : "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-300 ring-1 ring-white/10">
                                {surfaceBadge}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                                  freightBadge === "Ready"
                                    ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                                    : "bg-amber-500/15 text-amber-200 ring-amber-500/30"
                                }`}
                              >
                                {freightBadge === "Ready" ? "Freight Dims Ready" : "Missing Dims"}
                              </span>
                              <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-200 ring-1 ring-sky-500/30">
                                {media}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <Model3dCell
                              glbUrl={row.model3dGlbUrl}
                              sku={row.globalSku}
                              onOpen={() => {
                                // Stage media/3D through Tab 1 Intake (single SSOT lane), not the product drawer.
                                setTab("intake");
                              }}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              data-testid={`mia-toggle-${row.globalSku}`}
                              onClick={async () => {
                                const next = !row.miaApproved;
                                const result = await toggleMiaApproval(row.globalSku, next);
                                if (!result.ok) {
                                  onToast(result.error);
                                  return;
                                }
                                onListingsChange(
                                  listings.map((l) =>
                                    l.globalSku === row.globalSku
                                      ? {
                                          ...l,
                                          miaApproved: next,
                                          miaApprovedAt: result.approvedAt,
                                        }
                                      : l,
                                  ),
                                );
                              }}
                              className={
                                row.miaApproved
                                  ? "rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30"
                                  : "rounded-full bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-400 ring-1 ring-white/10"
                              }
                            >
                              {row.miaApproved ? "Mia Approved" : "Approve"}
                            </button>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                data-testid={`edit-details-${row.globalSku}`}
                                onClick={() => onOpenProductEdit(row)}
                                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:border-amber-400/40"
                              >
                                Edit Details
                              </button>
                              <button
                                type="button"
                                data-testid={`archive-product-${row.globalSku}`}
                                onClick={() =>
                                  setArchiveTarget({
                                    kind: "product",
                                    sku: row.globalSku,
                                    productName: row.productName,
                                    listingId: row.id,
                                  })
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/20"
                              >
                                <Archive className="h-3 w-3" />
                                Archive
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {readinessFilter === "archived" ? (
              <div
                className="overflow-x-auto rounded-2xl border border-white/10 bg-[#111827]"
                data-testid="portal-archived-products"
              >
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-white/5 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5">Product</th>
                      <th className="px-3 py-2.5">SKU</th>
                      <th className="px-3 py-2.5">Archived</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {archivedProducts.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                          No archived products.
                        </td>
                      </tr>
                    ) : (
                      archivedProducts.map((p) => (
                        <tr key={p.id} className="border-t border-white/5 text-slate-200">
                          <td className="px-3 py-2.5">{p.productName}</td>
                          <td className="px-3 py-2.5 font-mono text-xs text-amber-300">
                            {p.globalSku}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-400">
                            {p.archivedAt ? new Date(p.archivedAt).toLocaleString() : "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              data-testid={`restore-product-${p.globalSku}`}
                              onClick={() => {
                                setStagedChanges((prev) => [
                                  ...prev.filter(
                                    (c) =>
                                      !(c.kind === "restore_product" && c.listingId === p.id),
                                  ),
                                  {
                                    id: `restore_product:${p.id}:${Date.now()}`,
                                    kind: "restore_product",
                                    sku: p.globalSku,
                                    listingId: p.id,
                                    label: p.productName,
                                    stagedAt: new Date().toISOString(),
                                  },
                                ]);
                                onToast(`Staged restore for ${p.globalSku}`);
                              }}
                              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-200"
                            >
                              Restore
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "sync" ? (
          <div className="mt-6 space-y-6" data-testid="portal-panel-sync">
            <section className="rounded-2xl border border-white/10 bg-[#111827] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                1-click artifacts
              </h2>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <a
                  href={downloadUrls?.csv ?? "#"}
                  data-testid="download-woo-csv"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-amber-400"
                >
                  <Download className="h-4 w-4" />
                  Download Live WooCommerce CSV
                </a>
                <a
                  href={downloadUrls?.spec ?? "#"}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  <Download className="h-4 w-4" />
                  Download Live Technical Handoff Spec (.md)
                </a>
                <a
                  href={downloadUrls?.swatches ?? "#"}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  <Download className="h-4 w-4" />
                  Download {ECOMMERCE_32_FINISH_COUNT} Active Finishes Manifest (.json)
                </a>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#111827] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                WooCommerce Staging Sync
              </h2>
              <p className="mt-1 font-mono text-sm text-amber-200/90">ccpatiodev2.primeview.com</p>
              <p
                className="mt-2 text-[11px] text-slate-400"
                data-testid="staging-guardrail-note"
              >
                {stagingPushGuardrailMessage().label}
              </p>
              <p
                className="mt-1 text-[11px] font-semibold text-amber-200/90"
                data-testid="certified-gate-note"
              >
                Certified-only gate: only Certified finishes and Mia-approved products are pushed to
                WooCommerce. Items still in Intake never sync.
              </p>
              <div className="relative mt-3 max-w-md">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Dry-run product SKU
                  <input
                    value={syncSkuQuery || syncSku}
                    onChange={(e) => {
                      setSyncSkuQuery(e.target.value);
                      setSyncSku("");
                      setSyncSkuOpen(true);
                    }}
                    onFocus={() => setSyncSkuOpen(true)}
                    placeholder="Search by title or SKU…"
                    data-testid="sync-sku-combobox"
                    role="combobox"
                    aria-expanded={syncSkuOpen}
                    aria-controls="sync-sku-combobox-list"
                    className={`mt-0.5 block w-full rounded px-2 py-1.5 font-mono text-xs ${FINISH_INPUT}`}
                  />
                </label>
                {syncSkuOpen ? (
                  <ul
                    id="sync-sku-combobox-list"
                    role="listbox"
                    data-testid="sync-sku-combobox-list"
                    className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-600 bg-slate-900 py-1 shadow-xl"
                  >
                    {syncSkuOptions.length === 0 ? (
                      <li className="px-3 py-2 text-[11px] text-slate-500">No matching products.</li>
                    ) : (
                      syncSkuOptions.map((o) => (
                        <li key={o.sku} role="option" aria-selected={syncSku === o.sku}>
                          <button
                            type="button"
                            className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-amber-500/15"
                            onClick={() => {
                              setSyncSku(o.sku);
                              setSyncSkuQuery("");
                              setSyncSkuOpen(false);
                            }}
                          >
                            <span className="font-mono text-[11px] text-amber-300">{o.sku}</span>
                            <span className="text-[10px] text-slate-400">{o.label}</span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  data-testid="woo-live-badge"
                  data-woo-probe={wooProbe.state}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    wooProbe.state === "ok"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : wooProbe.state === "probing"
                        ? "bg-amber-500/15 text-amber-200"
                        : "bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/40"
                  }`}
                >
                  {wooProbe.state === "ok"
                    ? `Connected · ${wooProbe.host}`
                    : wooProbe.state === "probing"
                      ? "Checking Woo…"
                      : `Action Required — ${
                          wooProbe.httpStatus ? `HTTP ${wooProbe.httpStatus} · ` : ""
                        }${wooProbe.reason}`}
                </span>
                {wooProbe.state === "failed" && !wooConfigured && wooBadgeLabel ? (
                  <span className="text-[10px] text-slate-500">{wooBadgeLabel}</span>
                ) : null}
                <button
                  type="button"
                  data-testid="test-woo-connection"
                  onClick={async () => {
                    const result = await runWooProbe();
                    onToast(result.ok ? `Connected to ${result.host}` : result.reason);
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200"
                >
                  Test Woo Connection
                </button>
                <button
                  type="button"
                  data-testid="copy-woo-diagnostic-primeview"
                  onClick={async () => {
                    const res = await buildWooDiagnosticReportAction();
                    if (!res.ok) {
                      onToast(res.error);
                      return;
                    }
                    try {
                      await navigator.clipboard.writeText(res.report);
                      onToast("Woo diagnostic copied for PrimeView");
                    } catch {
                      onToast("Could not copy diagnostic — clipboard blocked");
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy Diagnostic Report for PrimeView
                </button>
                <button
                  type="button"
                  data-testid="push-swatches-staging"
                  disabled={stagingBusy !== null}
                  onClick={async () => {
                    setStagingBusy("swatches_scales");
                    const res = await runPortalStagingPush({
                      kind: "swatches_scales",
                      mode: "finishes",
                    });
                    setStagingBusy(null);
                    if (!res.ok) {
                      onToast(res.error);
                      return;
                    }
                    const msg = res.simulated
                      ? `Simulation OK · ${res.guardrail} · finishes ${res.readiness.finishes}/32`
                      : `Live staging push queued · finishes ${res.readiness.finishes}/32`;
                    setStagingNote(msg);
                    setDryRunJson(JSON.stringify(res.preview ?? res, null, 2));
                    onToast(msg);
                  }}
                  className="rounded-xl border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-100 disabled:opacity-50"
                >
                  {stagingBusy === "swatches_scales" ? (
                    <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Push 32 Swatches &amp; Scales to Staging
                </button>
                <button
                  type="button"
                  data-testid="push-catalog-staging"
                  disabled={stagingBusy !== null}
                  onClick={async () => {
                    setStagingBusy("certified_catalog");
                    const res = await runPortalStagingPush({
                      kind: "certified_catalog",
                      mode: "catalog",
                      preserveWpImages: true,
                    });
                    setStagingBusy(null);
                    if (!res.ok) {
                      onToast(res.error);
                      return;
                    }
                    const summary = res.summary
                      ? ` · ${res.summary.totalProducts} products · ${res.summary.mutationMode}`
                      : "";
                    const msg = res.simulated
                      ? `Simulation OK · Preserve WP Images · ${res.guardrail}${summary}`
                      : `Live certified catalog push · Preserve WP Images${summary}`;
                    setStagingNote(msg);
                    setDryRunJson(JSON.stringify(res.preview ?? res, null, 2));
                    onToast(msg);
                  }}
                  className="rounded-xl border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-100 disabled:opacity-50"
                >
                  {stagingBusy === "certified_catalog" ? (
                    <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Push Certified Catalog to Staging [Preserve WP Images]
                </button>
                <button
                  type="button"
                  data-testid="dry-run-payload"
                  onClick={async () => {
                    const sample = syncSku || listings[0]?.globalSku;
                    if (!sample) {
                      onToast("No Phase 1 rows loaded yet.");
                      return;
                    }
                    const preview = await dryRunWooPushForSku(sample);
                    if (!preview.ok) {
                      onToast(preview.error);
                      return;
                    }
                    setDryRunJson(JSON.stringify(preview.preview, null, 2));
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200"
                >
                  Dry Run Payload Preview
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const link = await getPrimeviewPartnerHandoffLink();
                    if (!link.ok) {
                      onToast(link.error);
                      return;
                    }
                    window.open(link.url, "_blank", "noopener,noreferrer");
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200"
                >
                  Open Partner Handoff
                  <ExternalLink className="ml-1 inline h-3 w-3" />
                </button>
              </div>
              {stagingNote ? (
                <p className="mt-2 text-xs text-emerald-300" data-testid="staging-push-result">
                  {stagingNote}
                </p>
              ) : null}
              {dryRunJson ? (
                <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-[#0b0f17] p-3 text-[11px] text-slate-300 ring-1 ring-white/10">
                  {dryRunJson}
                </pre>
              ) : null}
              <div className="mt-4">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Production webhook URL
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    readOnly
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    data-testid="webhook-url-box"
                    className="flex-1 rounded-xl border border-white/10 bg-[#0b0f17] px-3 py-2 font-mono text-xs text-slate-300"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(webhookUrl);
                      onToast("Webhook URL copied");
                    }}
                    className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#111827] p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                <UploadCloud className="h-4 w-4" />
                Photoshoot / Product Media &amp; .glb
              </h2>
              <p className="mb-3 text-xs text-slate-400">
                Search a Product or Finish SKU, then drop gallery images (
                <code className="text-slate-300">.jpg/.png/.webp</code>) or a{" "}
                <code className="text-slate-300">.glb</code> model.
              </p>
              <MediaUploadZone
                listings={listings}
                finishSkus={ECOMMERCE_32_FINISHES.map((f) => f.sku)}
                embedToken={embedToken}
                onToast={onToast}
              />
            </section>
          </div>
        ) : null}
      </div>
      <ArchiveImpactModal
        open={archiveTarget !== null}
        target={archiveTarget}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => {
          if (!archiveTarget) return;
          if (archiveTarget.kind === "finish") {
            stageArchiveFinish(archiveTarget.sku, archiveTarget.displayName);
          } else if (archiveTarget.kind === "product" && archiveTarget.listingId) {
            stageArchiveProduct(
              archiveTarget.listingId,
              archiveTarget.sku,
              archiveTarget.productName,
            );
          }
          setArchiveTarget(null);
        }}
      />
      <PendingCommitBar
        changes={stagedChanges}
        committing={committing}
        onCommit={() => void commitStagedChanges()}
        onDiscard={() => setStagedChanges([])}
      />
      {lightboxAsset ? (
        <FullResImageLightbox
          open
          onClose={() => setLightboxAsset(null)}
          sku={lightboxAsset.sku}
          displayName={lightboxAsset.displayName}
          category={lightboxAsset.finishCategory}
          apfGroup={apfTargetGroupForFamily(ecommerceFinishBySku(lightboxAsset.sku)?.family ?? "sunbrella")}
          sourceProvenance={
            lightboxAsset.sourceType === "studio_photo"
              ? `Studio Photo: ${lightboxAsset.sourceFilename ?? "unknown"}`
              : lightboxAsset.sourceType === "synthetic_fallback"
                ? "Synthetic Fallback"
                : "—"
          }
          repeatScale={formatFinishRepeatScaleLabel({
            sku: lightboxAsset.sku,
            textureScale: lightboxAsset.sampleWidthIn,
            patternRepeatWIn: lightboxAsset.patternRepeatWIn,
            patternRepeatHIn: lightboxAsset.patternRepeatHIn,
            sampleWidthIn: lightboxAsset.sampleWidthIn,
            sampleHeightIn: lightboxAsset.sampleHeightIn,
          })}
          sha256={lightboxAsset.textureSha256 ?? null}
          thumbUrl={lightboxAsset.swatchThumbUrl}
          fullResUrl={lightboxAsset.texture2kUrl}
          hasPrev={assets.findIndex((a) => a.sku === lightboxAsset.sku) > 0}
          hasNext={
            assets.findIndex((a) => a.sku === lightboxAsset.sku) >= 0 &&
            assets.findIndex((a) => a.sku === lightboxAsset.sku) < assets.length - 1
          }
          onPrev={() => {
            const i = assets.findIndex((a) => a.sku === lightboxAsset.sku);
            if (i > 0) setLightboxAsset(assets[i - 1]!);
          }}
          onNext={() => {
            const i = assets.findIndex((a) => a.sku === lightboxAsset.sku);
            if (i >= 0 && i < assets.length - 1) setLightboxAsset(assets[i + 1]!);
          }}
          onReplace={(slot) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = IMAGE_ACCEPT;
            input.onchange = () => {
              const file = input.files?.[0];
              if (!file) return;
              void uploadEmbedAsset({
                embedToken,
                kind: "finish_swatch",
                slot,
                sku: lightboxAsset.sku,
                file,
              }).then((res) => {
                if (res.ok) {
                  void loadAssets();
                  onToast(`Replaced ${slot} for ${lightboxAsset.sku}`);
                } else {
                  onToast(res.error);
                }
              });
            };
            input.click();
          }}
        />
      ) : null}
    </div>
  );
}
