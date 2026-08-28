"use client";

import { useState, type KeyboardEvent } from "react";

type Props = {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
};

export function TagInput({ values, onChange, placeholder }: Props) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const tag = draft.trim();
    if (!tag || values.includes(tag)) {
      setDraft("");
      return;
    }
    onChange([...values, tag]);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="rounded border border-slate-700 bg-slate-950 p-2">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {values.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded border border-cyan-900/60 bg-cyan-950/40 px-2 py-0.5 text-[11px] text-cyan-200"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => onChange(values.filter((v) => v !== tag))}
              className="text-cyan-500 hover:text-white"
            >
              ×
            </button>
          </span>
        ))}
        {values.length === 0 ? (
          <span className="text-[11px] italic text-slate-600">None</span>
        ) : null}
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={placeholder ?? "Type and press Enter"}
        className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600"
      />
    </div>
  );
}
