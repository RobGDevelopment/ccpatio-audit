"use client";

import React from "react";
import { FileText, Upload, X } from "lucide-react";

interface PacketSlotProps {
  file: File | null;
  onSelect: (file: File) => void;
  onRemove: () => void;
  isRequired?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PacketSlot({
  file,
  onSelect,
  onRemove,
  isRequired = false,
}: PacketSlotProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected && selected.name.toLowerCase().endsWith(".pdf")) {
      onSelect(selected);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  if (file) {
    return (
      <div className="bg-white/80 dark:bg-stone-900/80 backdrop-blur-md rounded-2xl border border-stone-200/80 dark:border-stone-800/80 p-4 shadow-sm flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate max-w-[200px] sm:max-w-xs">
              {file.name}
            </h4>
            <p className="text-[11px] text-stone-500">{formatBytes(file.size)} · Factory order</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 rounded-lg text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
          aria-label="Remove factory order PDF"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={() => fileInputRef.current?.click()}
      className={`border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition flex flex-col items-center justify-center space-y-1 ${
        isRequired
          ? "border-amber-300 dark:border-amber-800/60 bg-amber-50/20 hover:bg-amber-50/40 dark:bg-amber-950/10 dark:hover:bg-amber-950/20"
          : "border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700 bg-white/40 dark:bg-stone-900/40"
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="w-8 h-8 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center text-stone-400 mb-0.5">
        <Upload className="w-4 h-4" />
      </div>
      <p className="text-xs font-medium text-stone-700 dark:text-stone-300">
        Factory order (PDF)
      </p>
      <p className="text-[11px] text-stone-400">
        {isRequired ? "Required for client projects" : "Optional drawing or order sheet"}
      </p>
    </div>
  );
}
