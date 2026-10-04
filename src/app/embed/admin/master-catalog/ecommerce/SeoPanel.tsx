"use client";

import { useState } from "react";
import { Loader2, Save, Sparkles } from "lucide-react";
import { saveListingSeo, generateAiSeoAction } from "../actions";
import {
  SEO_LIMITS,
  SLUG_RE,
  TITLE_GOOD_FROM,
  DESCRIPTION_GOOD_FROM,
  counterBand,
  normalizeSlug,
  normalizeTags,
  typingSlug,
  type CounterBand,
} from "@/lib/seo-limits";

const BAND_CLASS: Record<CounterBand, string> = {
  empty: "text-slate-400",
  short: "text-amber-600",
  good: "text-emerald-600",
  over: "text-rose-600 font-semibold",
};

function Counter({
  id,
  length,
  limit,
  goodFrom,
}: {
  id: string;
  length: number;
  limit: number;
  goodFrom: number | null;
}) {
  const band = goodFrom === null ? (length === 0 ? "empty" : length > limit ? "over" : "good") : counterBand(length, limit, goodFrom);
  return (
    <span id={id} data-band={band} className={`text-[11px] tabular-nums ${BAND_CLASS[band]}`}>
      {length} / {limit}
    </span>
  );
}

type Field = "title" | "description" | "slug";
type Source = "empty" | "saved" | "hub" | "ai" | "edited";

const SOURCE_BADGE: Record<Exclude<Source, "empty">, { text: string; cls: string }> = {
  saved: { text: "Saved on listing", cls: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  hub: { text: "Hub default · not saved to this listing", cls: "bg-slate-100 text-slate-500 border-slate-200 border-dashed" },
  ai: { text: "AI suggestion · review before saving", cls: "bg-violet-50 text-violet-700 border-violet-100" },
  edited: { text: "Unsaved change", cls: "bg-amber-50 text-amber-700 border-amber-100" },
};

function SourceBadge({ id, source }: { id: string; source: Source }) {
  if (source === "empty") return null;
  const b = SOURCE_BADGE[source];
  return (
    <span
      id={id}
      data-source={source}
      className={`text-[10px] font-semibold rounded-full border px-2 py-0.5 ${b.cls}`}
    >
      {b.text}
    </span>
  );
}

export function SeoPanel({
  listingId,
  version,
  assistantConfigured,
  aiOperatorEligible,
  hasSavedMarketing,
  initial,
  hub,
  onSaved,
}: {
  listingId: string;
  version: number;
  assistantConfigured: boolean;
  /** False only for the GHL embed principal with no human session. */
  aiOperatorEligible: boolean;
  /** True only once marketing copy has been SAVED (the action reads committed copy). */
  hasSavedMarketing: boolean;
  /** Values explicitly saved on THIS listing (null = never saved). */
  initial: { seoTitle: string | null; seoDescription: string | null; slug: string | null; tags: string[] };
  /** Hub (finished_goods_catalog) defaults. Shown as a prefill only; never written unless the operator saves. */
  hub: { seoTitle: string | null; seoDescription: string | null; slug: string | null };
  onSaved: (patch: { version: number }) => void;
}) {
  // What is persisted on the listing right now.
  const [savedListing, setSavedListing] = useState<Record<Field, string>>({
    title: initial.seoTitle ?? "",
    description: initial.seoDescription ?? "",
    slug: initial.slug ?? "",
  });
  const hubDefaults: Record<Field, string> = {
    title: hub.seoTitle ?? "",
    description: hub.seoDescription ?? "",
    slug: hub.slug ?? "",
  };

  // Inputs are prefilled from the listing, falling back to the hub default (display only).
  const prefill = (f: Field) => (savedListing[f] ? savedListing[f] : hubDefaults[f]);
  const [title, setTitle] = useState(() => prefill("title"));
  const [description, setDescription] = useState(() => prefill("description"));
  const [slug, setSlug] = useState(() => prefill("slug"));
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));

  // Baseline for the dirty check: what the inputs held when last loaded/saved.
  const [baseline, setBaseline] = useState({
    title: prefill("title"),
    description: prefill("description"),
    slug: prefill("slug"),
    tags: initial.tags.join(", "),
  });
  const [aiFields, setAiFields] = useState<Set<Field>>(new Set());

  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggested, setSuggested] = useState(false);
  const [slugConflict, setSlugConflict] = useState<{ slug: string; name: string } | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  const values: Record<Field, string> = { title, description, slug };
  function sourceOf(f: Field): Source {
    const v = values[f].trim();
    if (!v) return "empty";
    if (aiFields.has(f)) return "ai";
    if (savedListing[f] && v === savedListing[f].trim()) return "saved";
    if (!savedListing[f] && hubDefaults[f] && v === hubDefaults[f].trim()) return "hub";
    return "edited";
  }

  const slugTrim = slug.trim();
  const slugValid = slugTrim === "" || SLUG_RE.test(slugTrim);
  const titleOver = title.length > SEO_LIMITS.title;
  const descOver = description.length > SEO_LIMITS.description;
  const slugOver = slug.length > SEO_LIMITS.slug;
  const conflictActive = !!slugConflict && slugConflict.slug === slugTrim;
  const dirty =
    title !== baseline.title ||
    description !== baseline.description ||
    slug !== baseline.slug ||
    tagsText !== baseline.tags;

  const aiDisabledReason = !aiOperatorEligible
    ? "Sign in as an @ccpatio.com operator to use the SEO assistant."
    : !assistantConfigured
      ? "SEO assistant is not configured."
      : !hasSavedMarketing
        ? "Save a marketing description in the Story tab first."
        : null;

  function clearAi(f: Field) {
    setAiFields((s) => {
      if (!s.has(f)) return s;
      const n = new Set(s);
      n.delete(f);
      return n;
    });
  }

  async function optimize() {
    if (optimizing || aiDisabledReason) return; // one request in flight per drawer
    setOptimizing(true);
    setError(null);
    setSavedOk(false);
    try {
      const s = await generateAiSeoAction(listingId);
      // Inputs only. Nothing is persisted until the operator clicks Save SEO.
      const nextSlug = normalizeSlug(s.slug);
      setTitle(s.seoTitle);
      setDescription(s.metaDescription);
      setSlug(nextSlug);
      setAiFields(new Set<Field>(["title", "description", "slug"]));
      setSuggested(true);
      setSlugConflict(s.slugConflict ? { slug: nextSlug, name: s.slugConflict } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a suggestion");
    } finally {
      setOptimizing(false);
    }
  }

  async function save() {
    // Slug must be the strict hyphenated form BEFORE we call the server.
    const cleanSlug = normalizeSlug(slug);
    if (titleOver || descOver || slugOver || conflictActive || !(cleanSlug === "" || SLUG_RE.test(cleanSlug))) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const res = await saveListingSeo(listingId, version, {
        seoTitle: title,
        seoDescription: description,
        slug: cleanSlug,
        tags: tagsText.split(","),
      });
      const tags = res.tags.join(", ");
      const t = title.trim();
      const d = description.trim();
      setTagsText(tags);
      setTitle(t);
      setDescription(d);
      setSlug(cleanSlug);
      setSavedListing({ title: t, description: d, slug: cleanSlug });
      setBaseline({ title: t, description: d, slug: cleanSlug, tags });
      setAiFields(new Set());
      setSuggested(false);
      setSavedOk(true);
      onSaved({ version: res.version });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setError(msg);
      const m = /already used by "(.+)"\.$/.exec(msg);
      if (m) setSlugConflict({ slug: cleanSlug, name: m[1] });
    } finally {
      setSaving(false);
    }
  }

  const fieldBase =
    "w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50";
  const hubStyle = (f: Field) =>
    sourceOf(f) === "hub" ? "border-dashed bg-slate-50 italic text-slate-500" : "";

  return (
    <div id="seo-panel" className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2 gap-3">
        <h3 className="font-bold text-slate-700">SEO</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            id="seo-optimize"
            onClick={optimize}
            disabled={optimizing || !!aiDisabledReason}
            title={aiDisabledReason ?? "Suggest luxury-tone metadata (nothing is saved)"}
            className="px-3 py-1.5 bg-violet-600 text-white text-xs font-semibold rounded-md hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {optimizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {optimizing ? "Optimizing…" : "Optimize with AI"}
          </button>
          <button
            type="button"
            id="seo-save"
            onClick={save}
            disabled={saving || !dirty || titleOver || descOver || slugOver || conflictActive || !slugValid}
            className="px-3 py-1.5 bg-sky-600 text-white text-xs font-semibold rounded-md hover:bg-sky-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save SEO
          </button>
        </div>
      </div>

      {aiDisabledReason && <p id="seo-ai-hint" className="text-[11px] text-slate-400">{aiDisabledReason}</p>}
      {suggested && (
        <p id="seo-suggestion-banner" className="text-xs text-violet-700 bg-violet-50 border border-violet-100 p-2 rounded">
          Suggestion. Review before saving.
        </p>
      )}
      {error && <p className="text-xs text-rose-600 bg-rose-50 p-2 rounded">{error}</p>}
      {savedOk && !dirty && <p className="text-xs text-emerald-700 bg-emerald-50 p-2 rounded">SEO saved.</p>}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="seo-title" className="text-xs font-semibold text-slate-600">SEO Title</label>
          <span className="flex items-center gap-2">
            <SourceBadge id="seo-title-source" source={sourceOf("title")} />
            <Counter id="seo-title-counter" length={title.length} limit={SEO_LIMITS.title} goodFrom={TITLE_GOOD_FROM} />
          </span>
        </div>
        <input
          id="seo-title"
          type="text"
          value={title}
          onChange={(e) => { setTitle(e.target.value); clearAi("title"); setSavedOk(false); }}
          className={`${fieldBase} ${titleOver ? "border-rose-400" : "border-slate-200"} ${hubStyle("title")}`}
        />
        {titleOver && <p className="text-[11px] text-rose-600">Shorten to {SEO_LIMITS.title} characters.</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="seo-description" className="text-xs font-semibold text-slate-600">Meta Description</label>
          <span className="flex items-center gap-2">
            <SourceBadge id="seo-description-source" source={sourceOf("description")} />
            <Counter id="seo-description-counter" length={description.length} limit={SEO_LIMITS.description} goodFrom={DESCRIPTION_GOOD_FROM} />
          </span>
        </div>
        <textarea
          id="seo-description"
          rows={3}
          value={description}
          onChange={(e) => { setDescription(e.target.value); clearAi("description"); setSavedOk(false); }}
          className={`${fieldBase} ${descOver ? "border-rose-400" : "border-slate-200"} ${hubStyle("description")}`}
        />
        {descOver && <p className="text-[11px] text-rose-600">Shorten to {SEO_LIMITS.description} characters.</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="seo-slug" className="text-xs font-semibold text-slate-600">URL Slug</label>
          <span className="flex items-center gap-2">
            <SourceBadge id="seo-slug-source" source={sourceOf("slug")} />
            <Counter id="seo-slug-counter" length={slug.length} limit={SEO_LIMITS.slug} goodFrom={null} />
          </span>
        </div>
        <input
          id="seo-slug"
          type="text"
          value={slug}
          // Normalized as the operator types (lowercase, single hyphens); trailing hyphen is
          // trimmed on blur so the stored value always matches the slug regex.
          onChange={(e) => { setSlug(typingSlug(e.target.value)); clearAi("slug"); setSavedOk(false); }}
          onBlur={() => setSlug((s) => normalizeSlug(s))}
          spellCheck={false}
          autoCapitalize="none"
          className={`${fieldBase} font-mono ${slugOver || conflictActive || !slugValid ? "border-rose-400" : "border-slate-200"} ${hubStyle("slug")}`}
        />
        <p className="text-[11px] text-slate-400 font-mono">
          /{normalizeSlug(slug) || "…"}
          {!slugValid && (
            <span id="seo-slug-invalid" className="ml-2 text-amber-600">Lowercase words with single hyphens only.</span>
          )}
        </p>
        {slugOver && <p className="text-[11px] text-rose-600">Shorten to {SEO_LIMITS.slug} characters.</p>}
        {conflictActive && (
          <p id="seo-slug-conflict" className="text-[11px] text-rose-600">
            Slug already used by “{slugConflict!.name}”. Change it to save.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="seo-tags" className="text-xs font-semibold text-slate-600">Tags</label>
        <input
          id="seo-tags"
          type="text"
          value={tagsText}
          onChange={(e) => { setTagsText(e.target.value); setSavedOk(false); }}
          placeholder="comma, separated, tags"
          className={`${fieldBase} border-slate-200`}
        />
        <p className="text-[11px] text-slate-400">
          Saved as lowercase tags: {normalizeTags(tagsText.split(",")).join(" · ") || "none"}
        </p>
      </div>
    </div>
  );
}
