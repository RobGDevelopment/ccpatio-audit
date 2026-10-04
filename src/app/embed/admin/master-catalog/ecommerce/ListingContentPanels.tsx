"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getListingEditorData, type ListingEditorData } from "../actions";
import { AssetVaultDropzone } from "./AssetVaultDropzone";
import { StoryPanel } from "./StoryPanel";
import { SeoPanel } from "./SeoPanel";
import { FreightPanel } from "./FreightPanel";

export type ListingPanelTab = "asset_vault" | "story" | "seo" | "freight" | "channels";

export type ListingPatch = {
  version?: number;
  marketingDescription?: string | null;
  constructionDetails?: string | null;
};

/**
 * Owns the shared listing snapshot (version, saved marketing copy) for the Asset
 * Vault / Story / SEO tabs. All three stay mounted so unsaved edits survive tab
 * switches, and a save in one tab immediately hands the new optimistic-lock
 * version to the others.
 */
export function ListingContentPanels({
  listingId,
  globalSku,
  active,
  externalVersion,
  onListingPatched,
  onImageUploaded,
}: {
  listingId: string;
  globalSku: string;
  active: ListingPanelTab | null;
  /** Version known to the parent (e.g. after the Details tab saved). Versions only increase. */
  externalVersion?: number;
  onListingPatched?: (patch: ListingPatch) => void;
  onImageUploaded?: (url: string) => void;
}) {
  const [data, setData] = useState<ListingEditorData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [savedMarketing, setSavedMarketing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoadError(null);
    getListingEditorData(listingId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setVersion(d.version);
        setSavedMarketing(!!d.marketingDescription?.trim());
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load listing");
      });
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  const effectiveVersion = Math.max(version, externalVersion ?? 0);

  function bump(patch: ListingPatch) {
    if (patch.version !== undefined) setVersion(patch.version);
    if ("marketingDescription" in patch) setSavedMarketing(!!patch.marketingDescription?.trim());
    onListingPatched?.(patch);
  }

  return (
    <>
      <div hidden={active !== "asset_vault"}>
        <AssetVaultDropzone globalSku={globalSku} onImageUploaded={onImageUploaded} />
      </div>

      <div hidden={active !== "freight"}>
        <FreightPanel globalSku={globalSku} />
      </div>

      {(active === "story" || active === "seo") && !data && (
        <div className="flex items-center gap-2 p-6 text-sm text-slate-400">
          {loadError ? (
            <span className="text-rose-600">{loadError}</span>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Loading listing…
            </>
          )}
        </div>
      )}

      {data && (
        <>
          <div hidden={active !== "story"}>
            <StoryPanel
              listingId={listingId}
              version={effectiveVersion}
              initialMarketing={data.marketingDescription}
              initialConstruction={data.constructionDetails}
              onSaved={bump}
            />
          </div>
          <div hidden={active !== "seo"}>
            <SeoPanel
              listingId={listingId}
              version={effectiveVersion}
              assistantConfigured={data.seoAssistantConfigured}
              aiOperatorEligible={data.aiOperatorEligible}
              hasSavedMarketing={savedMarketing}
              initial={{
                seoTitle: data.seoTitle,
                seoDescription: data.seoDescription,
                slug: data.slug,
                tags: data.tags,
              }}
              hub={{
                seoTitle: data.hubSeoTitle,
                seoDescription: data.hubSeoDescription,
                slug: data.hubSlug,
              }}
              onSaved={(p) => bump({ version: p.version })}
            />
          </div>
        </>
      )}
    </>
  );
}
