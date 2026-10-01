"use client";

import { useRef, useState, useTransition } from "react";
import { availableTone, formatQty, type StockRow } from "@/lib/stock-display";
import { uploadShowroomStockImage } from "../actions";
import { eyebrow } from "../showroom-ui";

const toneClass = {
  green: "text-emerald-700",
  amber: "text-amber-700",
  red: "text-rose-700",
} as const;

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
  const [failed, setFailed] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const tone = availableTone(row.available);
  const displayUrl = uploadedUrl ?? row.imageUrl;
  const showImage = Boolean(displayUrl) && !failed;

  function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const preview = URL.createObjectURL(file);
    setUploadedUrl(preview);
    setFailed(false);
    const formData = new FormData();
    formData.set("sku", row.sku);
    formData.set("image", file);
    startTransition(async () => {
      try {
        const result = await uploadShowroomStockImage(formData);
        URL.revokeObjectURL(preview);
        if (!result.ok) {
          setUploadedUrl(null);
          setFailed(true);
          setError(result.error);
          return;
        }
        setUploadedUrl(result.imageUrl);
      } catch (uploadError: unknown) {
        URL.revokeObjectURL(preview);
        setUploadedUrl(null);
        setFailed(true);
        setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
      }
    });
  }

  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <div className="aspect-[4/3] bg-slate-100">
        {showImage ? (
          <img
            src={displayUrl ?? undefined}
            alt={row.name}
            className="h-full w-full object-cover"
            onError={() => {
              setFailed(true);
              setUploadedUrl(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 text-slate-500"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
          >
            <Swatch name={row.name} />
            <span className="text-xs uppercase tracking-widest">
              {pending ? "Uploading…" : "Add photo"}
            </span>
            {error ? <span className="px-4 text-center text-xs text-rose-700">{error}</span> : null}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label={`Upload image for ${row.name}`}
          onChange={(event) => {
            onFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
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
            <dd className={`mt-1 font-medium ${toneClass[tone]}`}>{formatQty(row.available)}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
