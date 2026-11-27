"use client";

import { useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import { displayStockUom } from "@/lib/hold-quantity";
import { formatQty, type StockRow } from "@/lib/stock-display";
import { variantImagePublicUrl } from "@/lib/product-image-url";
import type { SalesHoldBadge, WarehouseQty } from "@/server/showroom/sales-projection";
import { ImageUploadModal } from "./ImageUploadModal";
import type { ActiveShowroomHold } from "../actions";
import { HoldLifecycleControls } from "./HoldLifecycleControls";
import { PlaceHoldModal } from "./PlaceHoldModal";
import { ReleaseHoldModal } from "./ReleaseHoldModal";
import FullResImageLightbox from "@/app/embed/admin/master-catalog/ecommerce/FullResImageLightbox";
import { formatFinishRepeatScaleLabel } from "@/lib/finish-physical-scale";

const floatCard =
  "group relative overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]";

function availableBadgeClass(available: number): string {
  if (available > 10) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (available > 0) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function Swatch({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-center text-slate-300">
      <svg viewBox="0 0 48 48" className="h-10 w-10" fill="none" aria-hidden="true">
        <rect x="8" y="10" width="32" height="24" rx="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="18" cy="20" r="2.5" fill="currentColor" />
        <path d="M8 30l8-6 6 4 6-8 12 10" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className="sr-only">{name}</span>
    </div>
  );
}

export function InventoryCard({
  row,
  opsMode = false,
  salesperson,
  canHold,
  holdDisabledReason,
  ghlUserId,
  ghlUserEmail,
  holds,
  warehouses,
  holdBadges,
  heldQty = 0,
  showMtoQuote = false,
  mtoHref,
  onHoldPlaced,
  onOptimisticRelease,
  onReleaseFailed,
  onHoldReleased,
  onHoldExtended,
}: {
  row: StockRow;
  opsMode?: boolean;
  salesperson: string | null;
  canHold: boolean;
  holdDisabledReason: string | null;
  ghlUserId?: string;
  ghlUserEmail?: string;
  holds: ActiveShowroomHold[];
  warehouses?: WarehouseQty[];
  holdBadges?: SalesHoldBadge[];
  heldQty?: number;
  showMtoQuote?: boolean;
  mtoHref?: string;
  onHoldPlaced: () => void;
  onOptimisticRelease: (holdId: string) => void;
  onReleaseFailed: () => void;
  onHoldReleased: () => void;
  onHoldExtended: (holdId: string, expiresAt: string) => void;
}) {
  const [imageExists, setImageExists] = useState(true);
  const [version, setVersion] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const uom = displayStockUom(row.sku, row.uom);
  const outOfStock = row.available <= 0;
  const holdDisabled = !canHold || !salesperson || outOfStock;
  const holdButtonLabel = outOfStock
    ? heldQty > 0 || holds.length > 0
      ? "Fully Held"
      : "Out of Stock"
    : "Place Hold";
  const imageUrl = row.imageUrl?.trim() || variantImagePublicUrl(row.sku);
  const lightboxUrl = row.fullResImageUrl?.trim() || imageUrl;
  const src = imageUrl && version > 0 ? `${imageUrl}?v=${version}` : imageUrl;
  const lightboxSrc =
    lightboxUrl && version > 0 ? `${lightboxUrl}?v=${version}` : lightboxUrl;

  useEffect(() => {
    setImageExists(true);
    setVersion(0);
  }, [row.sku]);

  return (
    <article className={floatCard}>
      <span className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px] overflow-hidden" aria-hidden="true">
        <span className="animate-beam-glide-lux absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-[#C5A059] to-transparent opacity-80 group-hover:opacity-100" />
      </span>
      <div className="relative h-32 overflow-hidden bg-slate-100">
        {imageExists && src ? (
          <div className="relative h-full w-full">
            <img
              key={`${row.sku}-${version}`}
              src={src}
              alt={row.name}
              className="h-full w-full object-cover"
              onError={() => setImageExists(false)}
            />
            <button
              type="button"
              data-testid="inventory-open-lightbox"
              className="absolute inset-0 cursor-pointer"
              aria-label={`Preview photo for ${row.name}`}
              onClick={() => setLightboxOpen(true)}
            />
          </div>
        ) : (
          <button
            type="button"
            data-testid="inventory-add-photo"
            className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 text-slate-500"
            onClick={() => setUploadOpen(true)}
          >
            <Swatch name={row.name} />
            <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest">
              <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
              Add photo
            </span>
          </button>
        )}
      </div>
      <div className="space-y-2 p-3">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-semibold tracking-tight text-slate-900">{row.name}</h3>
            {row.ecommerceCertified ? (
              <span
                data-testid="ecommerce-certified-badge"
                className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800"
              >
                E-Commerce Certified
              </span>
            ) : null}
          </div>
          {row.vendorMillCode ? (
            <p className="mt-0.5 text-[11px] text-slate-500" data-testid="vendor-mill-subtitle">
              {row.vendorMillCode}
            </p>
          ) : null}
          {row.variantLabel ? (
            <p className="break-words line-clamp-3 text-xs text-slate-600">{row.variantLabel}</p>
          ) : null}
          <p className="mt-0.5 font-mono text-xs text-slate-500">{row.sku}</p>
          {warehouses && warehouses.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="warehouse-badges">
              {warehouses.map((w) => (
                <span
                  key={w.key}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium tabular-nums text-slate-700"
                  title={`${w.locationName}: ${formatQty(w.available)} available`}
                >
                  {w.label} {formatQty(w.inStock)}
                </span>
              ))}
            </div>
          ) : null}
          {holdBadges && holdBadges.length > 0 ? (
            <div className="mt-1.5 space-y-1" data-testid="hold-badges">
              {holdBadges.map((badge) => {
                const expires = (() => {
                  try {
                    return new Date(badge.expiresAt).toLocaleDateString();
                  } catch {
                    return badge.expiresAt;
                  }
                })();
                return (
                  <p
                    key={badge.id}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900"
                    data-testid="hold-badge-uom"
                  >
                    Held: {formatQty(badge.qty)} {uom} ({badge.opportunityName || "Customer"} · Expires{" "}
                    {expires})
                  </p>
                );
              })}
            </div>
          ) : null}
          {opsMode ? (
            <div className="mt-1 space-y-0.5 text-[11px] text-slate-500">
              {row.itemType ? <p>{row.itemType}</p> : null}
              {row.category ? <p>Category: {row.category}</p> : null}
              {row.locationName ? <p>Warehouse: {row.locationName}</p> : null}
              {row.uom ? <p>UOM: {row.uom}</p> : null}
            </div>
          ) : null}
        </div>
        <dl className={`grid gap-4 text-center ${opsMode ? "grid-cols-4" : "grid-cols-3"}`}>
          <div className="min-w-0">
            <dt className="whitespace-nowrap text-xs font-medium uppercase leading-none tracking-normal text-slate-500">
              In stock
            </dt>
            <dd className="mt-1 flex min-h-6 items-center justify-center text-sm tabular-nums text-slate-900">
              {formatQty(row.inStock)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="whitespace-nowrap text-xs font-medium uppercase leading-none tracking-normal text-slate-500">
              Committed
            </dt>
            <dd className="mt-1 flex min-h-6 items-center justify-center text-sm tabular-nums text-slate-900">
              {formatQty(row.committed)}
            </dd>
          </div>
          {opsMode ? (
            <div className="min-w-0">
              <dt className="whitespace-nowrap text-xs font-medium uppercase leading-none tracking-normal text-slate-500">
                Expected
              </dt>
              <dd className="mt-1 flex min-h-6 items-center justify-center text-sm tabular-nums text-slate-900">
                {formatQty(row.expected ?? 0)}
              </dd>
            </div>
          ) : null}
          <div className="min-w-0">
            <dt className="whitespace-nowrap text-xs font-medium uppercase leading-none tracking-normal text-slate-500">
              Available
            </dt>
            <dd className="mt-1 flex min-h-6 items-center justify-center">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${availableBadgeClass(row.available)}`}
              >
                {formatQty(row.available)}
              </span>
            </dd>
          </div>
        </dl>
        {!opsMode && showMtoQuote && mtoHref ? (
          <a
            href={mtoHref}
            className="block w-full rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-center text-xs font-medium text-white transition-colors hover:bg-slate-800"
          >
            Quote Make-to-Order in Order Desk
          </a>
        ) : null}
        {!opsMode ? (
        <button
          type="button"
          data-testid="place-hold-button"
          disabled={holdDisabled}
          title={
            outOfStock
              ? holdButtonLabel
              : holdDisabledReason ??
                (!salesperson ? "Confirming salesperson…" : undefined)
          }
          onClick={() => {
            if (outOfStock) return;
            setHoldOpen(true);
          }}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {holdButtonLabel}
        </button>
        ) : null}
        {!opsMode && holds.length > 0 ? (
          <ul className="space-y-2">
            {holds.map((hold) => (
              <li key={hold.id} className="rounded-xl border border-slate-200 p-2">
                <p className="text-xs font-medium text-slate-900">{hold.opportunityName}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {hold.salesperson} · {formatQty(Number(hold.qty))} {uom}
                </p>
                <HoldLifecycleControls
                  hold={hold}
                  uom={uom}
                  ghlUserId={ghlUserId}
                  ghlUserEmail={ghlUserEmail}
                  disabled={!canHold || !salesperson}
                  onOptimisticRelease={() => onOptimisticRelease(hold.id)}
                  onReleaseFailed={onReleaseFailed}
                  onReleased={onHoldReleased}
                  onExtended={(expiresAt) => onHoldExtended(hold.id, expiresAt)}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {!opsMode && holds.length > 0 ? (
          <button
            type="button"
            onClick={() => setReleaseOpen(true)}
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            Hold details ({holds.length})
          </button>
        ) : null}
      </div>
      {!opsMode && salesperson && !outOfStock ? (
        <PlaceHoldModal
          isOpen={holdOpen}
          onClose={() => setHoldOpen(false)}
          row={row}
          salesperson={salesperson}
          ghlUserId={ghlUserId}
          ghlUserEmail={ghlUserEmail}
          onPlaced={onHoldPlaced}
        />
      ) : null}
      {!opsMode ? (
        <ReleaseHoldModal
          isOpen={releaseOpen}
          onClose={() => setReleaseOpen(false)}
          row={row}
          holds={holds}
          ghlUserId={ghlUserId}
          ghlUserEmail={ghlUserEmail}
          disabled={!canHold || !salesperson}
          onOptimisticRelease={onOptimisticRelease}
          onReleaseFailed={onReleaseFailed}
          onReleased={onHoldReleased}
          onExtended={onHoldExtended}
        />
      ) : null}
      <ImageUploadModal
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        sku={row.sku}
        variantName={row.name}
        onUploaded={() => {
          setImageExists(true);
          setVersion((current) => current + 1);
        }}
      />
      {lightboxOpen && lightboxSrc ? (
        <FullResImageLightbox
          open
          onClose={() => setLightboxOpen(false)}
          sku={row.sku}
          displayName={row.name}
          category={row.category ?? "finish"}
          apfGroup="Current Inventory"
          sourceProvenance="Showroom inventory photo"
          repeatScale={formatFinishRepeatScaleLabel({ sku: row.sku })}
          sha256={null}
          thumbUrl={src}
          fullResUrl={lightboxSrc ?? src}
          onReplace={() => {
            setLightboxOpen(false);
            setUploadOpen(true);
          }}
        />
      ) : null}
    </article>
  );
}
