"use client";

import React, { useState } from "react";
import { UploadCloud, AlertCircle, ArrowRight } from "lucide-react";
import { classifyDropped, type ClassifiedDropped } from "@/lib/intake/files";
import { readGlbSummary, type GlbSummary } from "@/lib/intake/glb-summary";
import { ModelCard } from "./ModelCard";
import { PacketSlot } from "./PacketSlot";

interface DropStepProps {
  initialCadFile?: File | null;
  initialPacketFile?: File | null;
  initialSummary?: GlbSummary | null;
  onNext: (data: {
    cadFile: File;
    packetFile: File | null;
    summary: GlbSummary | null;
  }) => void;
}

export function DropStep({
  initialCadFile = null,
  initialPacketFile = null,
  initialSummary = null,
  onNext,
}: DropStepProps) {
  const [cadFile, setCadFile] = useState<File | null>(initialCadFile);
  const [packetFile, setPacketFile] = useState<File | null>(initialPacketFile);
  const [summary, setSummary] = useState<GlbSummary | null>(initialSummary);
  const [dragOver, setDragOver] = useState(false);
  const [rejections, setRejections] = useState<string[]>([]);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const classification: ClassifiedDropped = classifyDropped(list);

    if (classification.rejected.length > 0) {
      setRejections(classification.rejected.map((r) => r.message));
    } else {
      setRejections([]);
    }

    if (classification.geometry) {
      setCadFile(classification.geometry);
      if (classification.geometry.name.toLowerCase().endsWith(".glb")) {
        const sum = await readGlbSummary(classification.geometry);
        setSummary(sum);
      } else {
        setSummary(null);
      }
    }

    if (classification.packet) {
      setPacketFile(classification.packet);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleContinue = () => {
    if (!cadFile) return;
    onNext({
      cadFile,
      packetFile,
      summary,
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          Drop your design
        </h2>
        <p className="text-xs text-stone-500">
          Upload your 3D model (.glb, .blend, .skp, .dae) and factory order PDF.
        </p>
      </div>

      {/* Main Dropzone (shown when CAD is not yet selected) */}
      {!cadFile && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-3xl p-8 sm:p-12 text-center cursor-pointer transition flex flex-col items-center justify-center space-y-3 ${
            dragOver
              ? "border-amber-500 bg-amber-50/30 dark:bg-amber-950/20 scale-[0.99]"
              : "border-stone-200 dark:border-stone-800 hover:border-amber-400 dark:hover:border-amber-600 bg-white/40 dark:bg-stone-900/40"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".glb,.dae,.blend,.skp,.pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
            }}
          />
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 shadow-sm">
            <UploadCloud className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              Drag &amp; drop your files here, or browse
            </p>
            <p className="text-xs text-stone-400">
              Accepts 3D models (.glb, .blend, .skp, .dae) and factory orders (.pdf) up to 25 MB
            </p>
          </div>
        </div>
      )}

      {/* Rejections Banners */}
      {rejections.length > 0 && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/30 rounded-2xl border border-rose-200 dark:border-rose-800/50 space-y-2">
          {rejections.map((reason, i) => (
            <div key={i} className="flex items-center space-x-2 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{reason}</span>
            </div>
          ))}
        </div>
      )}

      {/* Uploaded Cards Area */}
      {cadFile && (
        <div className="space-y-4">
          <ModelCard
            file={cadFile}
            summary={summary}
            onRemove={() => {
              setCadFile(null);
              setSummary(null);
            }}
          />

          <PacketSlot
            file={packetFile}
            onSelect={(file) => setPacketFile(file)}
            onRemove={() => setPacketFile(null)}
          />
        </div>
      )}

      {/* Next Button */}
      <div className="pt-2 space-y-2">
        {!cadFile && (
          <p className="text-xs text-center text-stone-400">
            Please add a 3D model (.glb or .blend) to continue.
          </p>
        )}
        <button
          type="button"
          disabled={!cadFile}
          onClick={handleContinue}
          className="w-full h-12 flex items-center justify-center space-x-2 rounded-2xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:pointer-events-none text-white font-semibold text-sm shadow-sm transition"
        >
          <span>Continue</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
