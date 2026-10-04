"use client";

import { useRef, useState } from "react";
import { Loader2, Save, Bold, Italic, List, ListOrdered, Link2, Pilcrow } from "lucide-react";
import { saveListingStory } from "../actions";

function RichTextField({
  id,
  label,
  value,
  onChange,
  rows,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function wrap(open: string, close: string, fallback = "text") {
    const el = ref.current;
    const s = el?.selectionStart ?? value.length;
    const e = el?.selectionEnd ?? value.length;
    const selected = value.slice(s, e) || fallback;
    onChange(value.slice(0, s) + open + selected + close + value.slice(e));
    requestAnimationFrame(() => el?.focus());
  }

  function link() {
    const url = window.prompt("Link URL (http or https only)");
    if (!url) return;
    wrap(`<a href="${url.replace(/"/g, "&quot;")}">`, "</a>", "link text");
  }

  const tools: { title: string; icon: typeof Bold; run: () => void }[] = [
    { title: "Paragraph", icon: Pilcrow, run: () => wrap("<p>", "</p>") },
    { title: "Bold", icon: Bold, run: () => wrap("<strong>", "</strong>") },
    { title: "Italic", icon: Italic, run: () => wrap("<em>", "</em>") },
    { title: "Bulleted list", icon: List, run: () => wrap("<ul><li>", "</li></ul>", "item") },
    { title: "Numbered list", icon: ListOrdered, run: () => wrap("<ol><li>", "</li></ol>", "item") },
    { title: "Link", icon: Link2, run: link },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-slate-600">
        {label}
      </label>
      <div className="flex items-center gap-1 rounded-t-md border border-b-0 border-slate-200 bg-slate-50 px-1.5 py-1">
        {tools.map((t) => (
          <button
            key={t.title}
            type="button"
            title={t.title}
            aria-label={t.title}
            onClick={t.run}
            className="rounded p-1.5 text-slate-500 hover:bg-white hover:text-sky-600 transition-colors"
          >
            <t.icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
      <textarea
        id={id}
        ref={ref}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="-mt-1.5 w-full rounded-b-md border border-slate-200 px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-sky-500/50"
      />
    </div>
  );
}

export function StoryPanel({
  listingId,
  version,
  initialMarketing,
  initialConstruction,
  onSaved,
}: {
  listingId: string;
  version: number;
  initialMarketing: string | null;
  initialConstruction: string | null;
  onSaved: (patch: {
    version: number;
    marketingDescription: string | null;
    constructionDetails: string | null;
  }) => void;
}) {
  const [marketing, setMarketing] = useState(initialMarketing ?? "");
  const [construction, setConstruction] = useState(initialConstruction ?? "");
  const [savedMarketing, setSavedMarketing] = useState(initialMarketing ?? "");
  const [savedConstruction, setSavedConstruction] = useState(initialConstruction ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(false);

  const dirty = marketing !== savedMarketing || construction !== savedConstruction;

  async function save() {
    setSaving(true);
    setError(null);
    setSavedAt(false);
    try {
      const res = await saveListingStory(listingId, version, {
        marketingDescription: marketing || null,
        constructionDetails: construction || null,
      });
      // The server returns the sanitized HTML that was actually stored.
      setMarketing(res.marketingDescription ?? "");
      setConstruction(res.constructionDetails ?? "");
      setSavedMarketing(res.marketingDescription ?? "");
      setSavedConstruction(res.constructionDetails ?? "");
      setSavedAt(true);
      onSaved({
        version: res.version,
        marketingDescription: res.marketingDescription,
        constructionDetails: res.constructionDetails,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div id="story-panel" className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <h3 className="font-bold text-slate-700">Story</h3>
        <button
          type="button"
          id="story-save"
          onClick={save}
          disabled={saving || !dirty}
          className="px-3 py-1.5 bg-sky-600 text-white text-xs font-semibold rounded-md hover:bg-sky-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save Story
        </button>
      </div>
      {error && <p className="text-xs text-rose-600 bg-rose-50 p-2 rounded">{error}</p>}
      {savedAt && !dirty && <p className="text-xs text-emerald-700 bg-emerald-50 p-2 rounded">Story saved (sanitized).</p>}

      <RichTextField
        id="story-marketing"
        label="Marketing Copy"
        value={marketing}
        onChange={(v) => {
          setMarketing(v);
          setSavedAt(false);
        }}
        rows={7}
        placeholder="Describe the product. Plain text works; blank lines become paragraphs."
      />
      <RichTextField
        id="story-construction"
        label="Construction Details"
        value={construction}
        onChange={(v) => {
          setConstruction(v);
          setSavedAt(false);
        }}
        rows={5}
        placeholder="Frame, welds, hardware, and care notes."
      />
      <p className="text-[11px] text-slate-400">
        Allowed on save: p, br, strong, em, ul, ol, li, and links (http/https). Everything else is stripped by the server.
      </p>
    </div>
  );
}
