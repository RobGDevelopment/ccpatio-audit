"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmCadUpload,
  getLatestCadUpload,
  requestCadUpload,
  uploadCadStillImage,
  type CadUploadRow,
} from "./actions";

type Props = {
  globalSku: string;
  isPending: boolean;
  onDraftReady: () => void;
};

function statusTone(status: CadUploadRow["status"] | null): string {
  switch (status) {
    case "draft_ready":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
    case "failed":
      return "border-rose-500/40 bg-rose-500/10 text-rose-200";
    case "processing":
    case "queued":
    case "uploaded":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    default:
      return "border-zinc-700 bg-zinc-950/60 text-zinc-400";
  }
}

export function CadUploadDropzone({
  globalSku,
  isPending,
  onDraftReady,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceRename, setForceRename] = useState(false);
  const [replaceImage, setReplaceImage] = useState(false);
  const [job, setJob] = useState<CadUploadRow | null>(null);

  const refresh = useCallback(async () => {
    const latest = await getLatestCadUpload(globalSku);
    setJob(latest);
    return latest;
  }, [globalSku]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const latest = await getLatestCadUpload(globalSku);
      if (!cancelled) setJob(latest);
    })();
    return () => {
      cancelled = true;
    };
  }, [globalSku]);

  useEffect(() => {
    if (!job) return;
    if (job.status !== "queued" && job.status !== "processing") return;
    const handle = window.setInterval(() => {
      void refresh().then((latest) => {
        if (latest?.status === "draft_ready") onDraftReady();
      });
    }, 2000);
    return () => window.clearInterval(handle);
  }, [job, onDraftReady, refresh]);

  async function handleFiles(fileList: FileList | null): Promise<void> {
    if (!fileList?.length || busy || isPending) return;
    setError(null);

    const files = [...fileList];
    const images = files.filter((f) => f.type.startsWith("image/"));
    const cad = files.find((f) => {
      const n = f.name.toLowerCase();
      return n.endsWith(".dae") || n.endsWith(".skp");
    });

    setBusy(true);
    try {
      for (const image of images) {
        const buf = await image.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 1) {
          binary += String.fromCharCode(bytes[i]!);
        }
        const base64 = btoa(binary);
        const still = await uploadCadStillImage({
          globalSku,
          base64,
          contentType: image.type || "image/jpeg",
          replaceImage,
        });
        if (!still.ok) {
          setError(still.error);
          return;
        }
      }

      if (!cad) {
        if (images.length === 0) {
          setError("Drop a .dae (geometry) or .skp (preview) file");
        }
        return;
      }

      const requested = await requestCadUpload({
        globalSku,
        filename: cad.name,
        byteSize: cad.size,
        contentType: cad.type || undefined,
        forceRename,
        replaceImage,
      });
      if (!requested.ok) {
        setError(requested.error);
        return;
      }

      const put = await fetch(requested.signedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": cad.type || "application/octet-stream",
        },
        body: cad,
      });
      if (!put.ok) {
        setError(`Storage upload failed (${put.status})`);
        return;
      }

      const confirmed = await confirmCadUpload(requested.uploadId);
      if (!confirmed.ok) {
        setError(confirmed.error);
        await refresh();
        return;
      }

      const latest = await refresh();
      if (latest?.status === "draft_ready") onDraftReady();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "CAD upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div
      data-testid="factory-bom-cad-dropzone"
      className="mt-3 rounded-lg border border-dashed border-zinc-600/80 bg-zinc-950/40 p-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
          CAD upload · Master SKU{" "}
          <span className="font-mono text-zinc-300">{globalSku}</span>
        </p>
        {job ? (
          <span
            className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusTone(job.status)}`}
            data-testid="factory-bom-cad-status"
          >
            {job.status.replace(/_/g, " ")}
          </span>
        ) : null}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-md border px-3 py-6 text-center transition ${
          dragOver
            ? "border-emerald-400/60 bg-emerald-500/10"
            : "border-zinc-800 bg-zinc-900/40"
        }`}
      >
        <p className="text-sm text-zinc-200">
          Drop <span className="font-mono text-emerald-300">.dae</span> for
          cut-list drafts
        </p>
        <p className="mt-1 text-[11px] text-zinc-500">
          Optional: .skp (thumbnail only) · .jpg/.png still for PIM image
        </p>
        <button
          type="button"
          disabled={busy || isPending}
          onClick={() => inputRef.current?.click()}
          className="mt-3 rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 disabled:opacity-40"
        >
          {busy ? "Uploading…" : "Choose files"}
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".dae,.skp,image/png,image/jpeg,image/webp"
          multiple
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-zinc-400">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={forceRename}
            onChange={(e) => setForceRename(e.target.checked)}
          />
          Force rename to {globalSku}.*
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={replaceImage}
            onChange={(e) => setReplaceImage(e.target.checked)}
          />
          Replace catalog image
        </label>
      </div>

      {job?.errorMessage ? (
        <p className="mt-2 text-xs text-rose-300">{job.errorMessage}</p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
      {job?.status === "draft_ready" ? (
        <p className="mt-2 text-xs text-emerald-300">
          Draft BOM + estimates ready — review below, then Approve when ready.
        </p>
      ) : null}
    </div>
  );
}
