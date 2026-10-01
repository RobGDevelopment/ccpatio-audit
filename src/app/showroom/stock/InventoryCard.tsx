"use client";

import Image from "next/image";
import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { useToast } from "@/app/admin/shared/ToastProvider";
import { formatQty, type StockRow } from "@/lib/stock-display";
import { eyebrow } from "../showroom-ui";

const floatCard =
  "group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-3px_rgba(6,81,237,0.15)]";

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
  const toast = useToast();
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(row.imageUrl) && !failed;

  function handleImageUpload(variantId: string) {
    toast.success("Supabase upload modal coming soon");
    console.info("Supabase upload modal coming soon", variantId);
  }

  return (
    <article className={floatCard}>
      <span className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px] overflow-hidden" aria-hidden="true">
        <span className="animate-beam-glide absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-[#C5A059] to-transparent opacity-80 group-hover:opacity-100" />
      </span>
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
        {showImage && row.imageUrl ? (
          <Image
            src={row.imageUrl}
            alt={row.name}
            fill
            unoptimized
            sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <button
            type="button"
            className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 text-slate-500"
            onClick={() => handleImageUpload(row.sku)}
          >
            <Swatch name={row.name} />
            <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest">
              <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
              Add photo
            </span>
          </button>
        )}
      </div>
      <div className="space-y-4 p-5">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-slate-900">{row.name}</h3>
          <p className="mt-1 font-mono text-xs text-slate-500">{row.sku}</p>
        </div>
        <dl className="grid grid-cols-3 gap-3 text-sm">
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
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums ${availableBadgeClass(row.available)}`}
              >
                {formatQty(row.available)}
              </span>
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
