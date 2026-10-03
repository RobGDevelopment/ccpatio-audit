"use client";

import { useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import { formatQty, type StockRow } from "@/lib/stock-display";
import { variantImagePublicUrl } from "@/lib/product-image-url";
import { ImageUploadModal } from "./ImageUploadModal";
import type { ActiveShowroomHold } from "../actions";
import { HoldLifecycleControls } from "./HoldLifecycleControls";
import { PlaceHoldModal } from "./PlaceHoldModal";
import { ReleaseHoldModal } from "./ReleaseHoldModal";

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
  salesperson,
  canHold,
  holdDisabledReason,
  ghlUserId,
  ghlUserEmail,
  holds,
  onHoldPlaced,
  onOptimisticRelease,
  onReleaseFailed,
  onHoldReleased,
  onHoldExtended,
}: {
  row: StockRow;
  salesperson: string | null;
  canHold: boolean;
  holdDisabledReason: string | null;
  ghlUserId?: string;
  ghlUserEmail?: string;
  holds: ActiveShowroomHold[];
  onHoldPlaced: () => void;
  onOptimisticRelease: (holdId: string) => void;
  onReleaseFailed: () => void;
  onHoldReleased: () => void;
  onHoldExtended: (holdId: string, expiresAt: string) => void;
}) {
  const [imageExists, setImageExists] = useState(true);
  const [version, setVersion] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const holdDisabled = !canHold || !salesperson;
  const imageUrl = variantImagePublicUrl(row.sku);
  const src = imageUrl && version > 0 ? `${imageUrl}?v=${version}` : imageUrl;

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
              className="absolute inset-0 cursor-pointer"
              aria-label={`Replace photo for ${row.name}`}
              onClick={() => setUploadOpen(true)}
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
          <h3 className="text-sm font-semibold tracking-tight text-slate-900">{row.name}</h3>
          {row.variantLabel ? (
            <p className="break-words line-clamp-3 text-xs text-slate-600">{row.variantLabel}</p>
          ) : null}
          <p className="mt-0.5 font-mono text-xs text-slate-500">{row.sku}</p>
        </div>
        <dl className="grid grid-cols-3 gap-4 text-center">
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
        <button
          type="button"
          disabled={holdDisabled}
          title={
            holdDisabledReason ??
            (!salesperson ? "Confirming salesperson…" : undefined)
          }
          onClick={() => setHoldOpen(true)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Place Hold
        </button>
        {holds.length > 0 ? (
          <ul className="space-y-2">
            {holds.map((hold) => (
              <li key={hold.id} className="rounded-xl border border-slate-200 p-2">
                <p className="text-xs font-medium text-slate-900">{hold.opportunityName}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {hold.salesperson} · {formatQty(Number(hold.qty))}
                </p>
                <HoldLifecycleControls
                  hold={hold}
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
        {holds.length > 0 ? (
          <button
            type="button"
            onClick={() => setReleaseOpen(true)}
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            Hold details ({holds.length})
          </button>
        ) : null}
      </div>
      {salesperson ? (
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
    </article>
  );
}
