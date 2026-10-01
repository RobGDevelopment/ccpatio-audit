"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Upload, X } from "lucide-react";
import { useToast } from "@/app/admin/shared/ToastProvider";
import { VARIANT_IMAGE_BUCKET, VARIANT_IMAGE_MAX_BYTES } from "@/lib/product-image-url";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { requestVariantImageUpload } from "../actions";

type ImageUploadModalProps = {
  isOpen: boolean;
  onClose: () => void;
  sku: string;
  variantName: string;
  onUploaded?: () => void;
};

function contentTypeFor(file: File): string | null {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (type === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (type === "image/png" || name.endsWith(".png")) return "image/png";
  if (type === "image/webp" || name.endsWith(".webp")) return "image/webp";
  return null;
}

export function ImageUploadModal({
  isOpen,
  onClose,
  sku,
  variantName,
  onUploaded,
}: ImageUploadModalProps) {
  const toast = useToast();
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  onCloseRef.current = onClose;
  pendingRef.current = pending;

  useEffect(() => {
    if (!isOpen) return;
    setMessage(null);
    setDragOver(false);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pendingRef.current) onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  async function upload(file: File) {
    const contentType = contentTypeFor(file);
    if (!contentType) {
      const text = "Use a JPG, PNG, or WebP image.";
      setMessage(text);
      toast.error(text);
      return;
    }
    if (file.size > VARIANT_IMAGE_MAX_BYTES) {
      const text = "This image is over the 5 MB limit. Choose a smaller file.";
      setMessage(text);
      toast.error(text);
      return;
    }

    setPending(true);
    setMessage(null);
    try {
      const requested = await requestVariantImageUpload({
        sku,
        byteSize: file.size,
        contentType,
      });
      if (!requested.ok) {
        setMessage(requested.error);
        toast.error(requested.error);
        return;
      }

      const supabase = getSupabaseBrowser();
      if (!supabase) {
        const text = "Image storage is not configured.";
        setMessage(text);
        toast.error(text);
        return;
      }

      const { error } = await supabase.storage
        .from(VARIANT_IMAGE_BUCKET)
        .uploadToSignedUrl(requested.path, requested.token, file, {
          upsert: true,
          contentType,
          cacheControl: "60",
        });
      if (error) {
        setMessage(error.message);
        toast.error(error.message);
        return;
      }

      toast.success(`Photo saved for ${sku}`);
      onUploaded?.();
      onClose();
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Upload failed";
      setMessage(text);
      toast.error(text);
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function takeFile(file: File | undefined) {
    if (!file || pending) return;
    void upload(file);
  }

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-md" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="image-upload-modal"
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_24px_80px_-24px_rgba(15,23,42,0.45)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-slate-900">
              Add photo
            </h2>
            <p className="mt-1 text-sm text-slate-600">{variantName}</p>
            <p className="mt-0.5 font-mono text-xs text-slate-500">{sku}</p>
          </div>
          <button
            type="button"
            className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            if (!pending) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            takeFile(event.dataTransfer.files?.[0]);
          }}
          className={`mt-5 flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center transition ${
            dragOver
              ? "border-[#C5A059] bg-amber-50/60"
              : "border-slate-300 bg-slate-50 hover:border-slate-400"
          } disabled:cursor-wait`}
        >
          {pending ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-slate-500" aria-hidden="true" />
              <span className="text-sm text-slate-600">Uploading…</span>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-slate-400" aria-hidden="true" />
              <span className="text-sm font-medium text-slate-800">
                Drop a JPG, PNG, or WebP here, or browse
              </span>
              <span className="text-xs text-slate-500">
                5 MB maximum. Stored as {sku.trim().toUpperCase()}.jpg and replaces the previous photo.
              </span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          className="sr-only"
          aria-label={`Upload photo for ${variantName}`}
          onChange={(event) => {
            takeFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {message ? <p className="mt-3 text-sm text-rose-700">{message}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
