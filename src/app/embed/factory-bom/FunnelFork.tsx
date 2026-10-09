"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { beginAirlockIntake, requestCadUpload, confirmCadUpload, uploadCadStillImage } from "@/app/admin/factory-bom/actions";
import { glassCard, tactileButton, softField } from "@/app/admin/factory-bom/factory-bom-ui";

type Props = {
  files: File[];
  onCancel: () => void;
  opportunityId?: string;
};

export function FunnelFork({ files, onCancel, opportunityId }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"custom_build" | "catalog">("custom_build");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // custom fields
  const [clientSlug, setClientSlug] = useState("");
  const [itemSlug, setItemSlug] = useState("");
  
  // catalog fields
  const [originalName, setOriginalName] = useState("");
  const [category, setCategory] = useState("Custom");
  const [collection, setCollection] = useState("");
  const [length, setLength] = useState("");
  const [depth, setDepth] = useState("");
  
  // both
  const [displayName, setDisplayName] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const result = await beginAirlockIntake({
        mode,
        clientSlug: mode === "custom_build" ? clientSlug : undefined,
        itemSlug: mode === "custom_build" ? itemSlug : undefined,
        ghlOpportunityId: mode === "custom_build" ? opportunityId : undefined,
        originalName: mode === "catalog" ? originalName : undefined,
        category: mode === "catalog" ? category : undefined,
        collection: mode === "catalog" ? collection : undefined,
        length: mode === "catalog" ? length : undefined,
        depth: mode === "catalog" ? depth : undefined,
        displayName,
      });

      if (!result.ok || !result.sku) {
        throw new Error(result.error || "Failed to start intake");
      }

      const globalSku = result.sku;

      // Upload files
      const images = files.filter((f) => f.type.startsWith("image/"));
      const cad = files.find((f) => {
        const n = f.name.toLowerCase();
        return n.endsWith(".dae") || n.endsWith(".glb") || n.endsWith(".skp");
      });

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
          replaceImage: true,
        });
        if (!still.ok) {
          throw new Error(still.error || "Failed to upload image");
        }
      }

      if (cad) {
        const requested = await requestCadUpload({
          globalSku,
          filename: cad.name,
          byteSize: cad.size,
          contentType: cad.type || undefined,
          forceRename: false,
          replaceImage: true,
        });
        if (!requested.ok) {
          throw new Error(requested.error || "Failed to request CAD upload");
        }

        const put = await fetch(requested.signedUrl, {
          method: "PUT",
          headers: {
            "Content-Type": cad.type || "application/octet-stream",
          },
          body: cad,
        });
        if (!put.ok) {
          throw new Error(`Storage upload failed (${put.status})`);
        }

        const confirmed = await confirmCadUpload(requested.uploadId);
        if (!confirmed.ok) {
          throw new Error(confirmed.error || "Failed to confirm CAD upload");
        }
      }

      router.push(`?sku=${globalSku}`);
    } catch (err: any) {
      setError(err.message || "An error occurred");
      setBusy(false);
    }
  }

  return (
    <div className={`p-6 ${glassCard}`}>
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Identify this build</h2>
          <p className="mt-1 text-sm text-slate-500">
            {files.length} file{files.length === 1 ? "" : "s"} ready to process
          </p>
        </div>
        <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-800">
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6">
        <div className="flex gap-4 border-b border-slate-200 pb-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="mode" value="custom_build" checked={mode === "custom_build"} onChange={() => setMode("custom_build")} />
            <span className="text-sm font-medium text-slate-800">Mint Custom Job</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="mode" value="catalog" checked={mode === "catalog"} onChange={() => setMode("catalog")} />
            <span className="text-sm font-medium text-slate-800">Promote to Catalog</span>
          </label>
        </div>

        {mode === "custom_build" && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Client Slug (e.g. LAPAGLIA)</label>
              <input required value={clientSlug} onChange={(e) => setClientSlug(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} className={softField} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Item Slug (e.g. OCEAN-CHAISE)</label>
              <input required value={itemSlug} onChange={(e) => setItemSlug(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} className={softField} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Display Name (Optional)</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={softField} />
            </div>
          </div>
        )}

        {mode === "catalog" && (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Original Name</label>
              <input required value={originalName} onChange={(e) => setOriginalName(e.target.value)} className={softField} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
              <input required value={category} onChange={(e) => setCategory(e.target.value)} className={softField} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Collection (Optional)</label>
              <input value={collection} onChange={(e) => setCollection(e.target.value)} className={softField} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Length (Optional)</label>
              <input value={length} onChange={(e) => setLength(e.target.value)} className={softField} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Depth (Optional)</label>
              <input value={depth} onChange={(e) => setDepth(e.target.value)} className={softField} />
            </div>
          </div>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end pt-4">
          <button type="submit" disabled={busy} className={`${tactileButton} disabled:opacity-50`}>
            {busy ? "Processing..." : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
