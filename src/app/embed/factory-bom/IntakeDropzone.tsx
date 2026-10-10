"use client";

import { useRef, useState } from "react";
import { FunnelFork } from "./FunnelFork";
import { PacketLines, type PacketLineResult } from "./PacketLines";
import { tactileButton } from "@/app/admin/factory-bom/factory-bom-ui";
import { uploadFactoryPacketAction } from "@/app/admin/factory-bom/actions";

export function IntakeDropzone({ opportunityId, restrictPdf = false }: { opportunityId?: string; restrictPdf?: boolean }) {
  const [fileList, setFileList] = useState<File[]>([]);
  const [packetLines, setPacketLines] = useState<PacketLineResult[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [isProcessingPdf, setIsProcessingPdf] = useState(false);

  if (packetLines) {
    return <PacketLines lines={packetLines} opportunityId={opportunityId} />;
  }

  if (fileList.length > 0) {
    return <FunnelFork files={fileList} onCancel={() => setFileList([])} opportunityId={opportunityId} />;
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    
    const fileArray = Array.from(files);
    const pdfs = fileArray.filter(f => f.name.toLowerCase().endsWith(".pdf"));
    
    if (pdfs.length > 0 && !restrictPdf) {
      setIsProcessingPdf(true);
      try {
        const formData = new FormData();
        formData.append("file", pdfs[0]);
        if (opportunityId) {
          formData.append("opportunityId", opportunityId);
        }
        
        const res = await uploadFactoryPacketAction(formData);
        if (res.ok && res.lines) {
          setPacketLines(res.lines);
        } else {
          alert("Error parsing packet: " + res.error);
        }
      } catch (err: any) {
        alert("Error: " + err.message);
      } finally {
        setIsProcessingPdf(false);
      }
      return;
    }
    
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
          Drop {!restrictPdf ? <span className="font-mono font-medium">.pdf</span> : null} {!restrictPdf ? "or " : ""}<span className="font-mono font-medium">.glb</span> or <span className="font-mono font-medium">.dae</span> for cut-list drafts
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Optional: .skp for thumbnail
        </p>
        <button
          type="button"
          disabled={isProcessingPdf}
          onClick={() => inputRef.current?.click()}
          className={`${tactileButton} mt-6 disabled:opacity-50`}
        >
          {isProcessingPdf ? "Processing PDF..." : "Choose files"}
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
