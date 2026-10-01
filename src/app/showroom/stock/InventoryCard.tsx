"use client";

import { useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import { formatQty, type StockRow } from "@/lib/stock-display";
import { variantImagePublicUrl } from "@/lib/product-image-url";
import { eyebrow } from "../showroom-ui";
import { ImageUploadModal } from "./ImageUploadModal";

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

export function InventoryCard({ row }: { row: StockRow }) {
  const [imageExists, setImageExists] = useState(true);
  const [version, setVersion] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
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
          <p className="mt-0.5 font-mono text-xs text-slate-500">{row.sku}</p>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className={eyebrow}>In stock</dt>
            <dd className="mt-1 text-slate-900">{formatQty(row.inStock)}</dd>
          </div>
          <div>
            <dt className={eyebrow}>Committed</dt>
            <dd className="mt-1 text-slate-900">{formatQty(row.committed)}</dd>
          </div>
          <div>
            <dt className={eyebrow}>Available</dt>
            <dd className="mt-1">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${availableBadgeClass(row.available)}`}
              >
                {formatQty(row.available)}
              </span>
            </dd>
          </div>
        </dl>
      </div>
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
