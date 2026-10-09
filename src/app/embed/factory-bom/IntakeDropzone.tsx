"use client";

import { useRef, useState } from "react";
import { FunnelFork } from "./FunnelFork";
import { tactileButton } from "@/app/admin/factory-bom/factory-bom-ui";

export function IntakeDropzone({ opportunityId }: { opportunityId?: string }) {
  const [fileList, setFileList] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  if (fileList.length > 0) {
    return <FunnelFork files={fileList} onCancel={() => setFileList([])} opportunityId={opportunityId} />;
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setFileList([...files]);
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`w-full max-w-md rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragOver ? "border-emerald-400 bg-emerald-50" : "border-slate-300 bg-white hover:bg-slate-50"
        }`}
      >
        <h3 className="text-lg font-medium text-slate-800">Start Airlock Intake</h3>
        <p className="mt-2 text-sm text-slate-500">
          Drop <span className="font-mono font-medium">.glb</span> or <span className="font-mono font-medium">.dae</span> for cut-list drafts
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Optional: .skp for thumbnail
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`${tactileButton} mt-6`}
        >
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".dae,.glb,.skp,image/png,image/jpeg,image/webp"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    </div>
  );
}
