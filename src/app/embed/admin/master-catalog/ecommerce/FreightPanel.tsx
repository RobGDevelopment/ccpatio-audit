"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import {
  extractCadDimensions,
  getCadExtractAvailability,
  getFreightProfile,
  saveFreightProfile,
  type ShipProfileData,
} from "../actions";
import { mapDisplayToFreight } from "@/lib/freight-utils";

export function FreightPanel({
  globalSku,
  hubLength,
  hubDepth,
  hubHeight,
  hubWeight,
  onDisplayExtracted,
}: {
  globalSku: string;
  hubLength?: string | null;
  hubDepth?: string | null;
  hubHeight?: string | null;
  hubWeight?: string | null;
  onDisplayExtracted?: (dims: { length: string; depth: string; height: string }) => void;
}) {
  const [data, setData] = useState<ShipProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cadReady, setCadReady] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<{ length: string; depth: string; height: string } | null>(null);

  useEffect(() => {
    let active = true;
    getFreightProfile(globalSku).then(d => {
      if (active) {
        setData(d || {
          shipMode: "",
          lengthIn: "",
          widthIn: "",
          heightIn: "",
          weightLb: "",
          ltlClass: "",
          stackable: false,
        });
        setLoading(false);
      }
    }).catch(err => {
      if (active) {
        setError(err.message);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [globalSku]);

  useEffect(() => {
    let active = true;
    getCadExtractAvailability(globalSku)
      .then((row) => {
        if (active) setCadReady(row.ready);
      })
      .catch(() => {
        if (active) setCadReady(false);
      });
    return () => {
      active = false;
    };
  }, [globalSku]);

  const displayLength = extracted?.length ?? hubLength ?? "";
  const displayDepth = extracted?.depth ?? hubDepth ?? "";
  const displayHeight = extracted?.height ?? hubHeight ?? "";
  const displayWeight = hubWeight ?? "";

  if (loading) return <div className="p-6 text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading freight...</div>;
  if (!data) return <div className="p-6 text-sm text-rose-500">Failed to load freight profile.</div>;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    setData(prev => prev ? { ...prev, [name]: type === 'checkbox' ? checked : value } : null);
  };

  const handleSave = () => {
    startTransition(async () => {
      setError(null);
      try {
        await saveFreightProfile(globalSku, data);
      } catch (err: any) {
        setError(err.message);
      }
    });
  };

  const l = parseFloat(data.lengthIn) || 0;
  const w = parseFloat(data.widthIn) || 0;
  const h = parseFloat(data.heightIn) || 0;
  const dimWeight = Math.max(0, Math.ceil((l * w * h) / 139));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Freight Profile</h3>
          <p className="text-xs text-slate-500 mt-1">Quoting keeps reading logistics_profiles until a later publish copies the row.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setExtracting(true);
              setError(null);
              extractCadDimensions(globalSku)
                .then((dims) => {
                  setExtracted(dims);
                  onDisplayExtracted?.(dims);
                })
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : "Could not extract CAD dimensions");
                })
                .finally(() => setExtracting(false));
            }}
            disabled={extracting || isPending || !cadReady}
            title={cadReady ? undefined : "Upload a .dae file to extract dimensions."}
            className="px-3 py-1.5 bg-amber-100 text-amber-700 text-xs font-semibold rounded-md hover:bg-amber-200 transition-colors disabled:opacity-50"
          >
            {extracting && <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />}
            [Extract from CAD]
          </button>
          <button
            onClick={handleSave}
            disabled={isPending || extracting}
            className="px-3 py-1.5 bg-sky-600 text-white text-xs font-semibold rounded-md hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save Freight
          </button>
        </div>
      </div>

      {error && <div className="p-3 bg-rose-50 text-rose-700 text-sm rounded-md border border-rose-100">{error}</div>}

      {!data.lengthIn && !data.widthIn && !data.heightIn && !data.weightLb && (displayLength || displayDepth || displayHeight || displayWeight) && (
        <div className="p-3 bg-sky-50 text-sky-800 text-sm rounded-md border border-sky-100 flex items-center justify-between gap-3">
          <span>
            <strong>Display dimensions:</strong> L: {displayLength || "-"} x W: {displayDepth || "-"} x H: {displayHeight || "-"} / {displayWeight || "-"} lbs
          </span>
          <button
            type="button"
            onClick={() => setData(prev => prev ? { ...prev, ...mapDisplayToFreight({ length: displayLength, depth: displayDepth, height: displayHeight, weight: displayWeight }) } : null)}
            className="shrink-0 px-3 py-1 bg-white text-sky-600 hover:bg-sky-50 text-xs font-semibold rounded border border-sky-200 transition-colors"
          >
            Apply display dimensions
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-600">Ship Mode</label>
          <select
            name="shipMode"
            value={data.shipMode}
            onChange={handleChange}
            className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
          >
            <option value="" disabled>Select Mode...</option>
            <option value="ltl">LTL (Palletized Freight)</option>
            <option value="parcel">Parcel (FedEx/UPS)</option>
            <option value="white_glove_only">White Glove Only</option>
            <option value="not_shipped">Not Shipped</option>
          </select>
        </div>

        {data.shipMode !== "not_shipped" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-600">NMFC Class</label>
            <input
              type="text"
              name="ltlClass"
              value={data.ltlClass}
              onChange={handleChange}
              placeholder="e.g. 150"
              className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50"
            />
          </div>
        )}
      </div>

      {data.shipMode !== "not_shipped" && (
        <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 flex flex-col gap-4">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Packaged Dimensions</h4>
          <div className="grid grid-cols-4 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-600">Length (in)</label>
              <input type="number" step="0.1" name="lengthIn" value={data.lengthIn} onChange={handleChange} className="px-3 py-2 border border-slate-200 rounded-md text-sm w-full" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-600">Width (in)</label>
              <input type="number" step="0.1" name="widthIn" value={data.widthIn} onChange={handleChange} className="px-3 py-2 border border-slate-200 rounded-md text-sm w-full" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-600">Height (in)</label>
              <input type="number" step="0.1" name="heightIn" value={data.heightIn} onChange={handleChange} className="px-3 py-2 border border-slate-200 rounded-md text-sm w-full" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-600">Weight (lb)</label>
              <input type="number" step="0.1" name="weightLb" value={data.weightLb} onChange={handleChange} className="px-3 py-2 border border-slate-200 rounded-md text-sm w-full" />
            </div>
          </div>
          
          <div className="flex items-center justify-between pt-4 border-t border-slate-200/60">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="stackable" checked={data.stackable} onChange={handleChange} className="rounded text-sky-600 focus:ring-sky-500" />
              <span className="text-sm font-medium text-slate-700">Stackable Pallet</span>
            </label>

            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span className="font-medium">Dim Weight:</span>
              <span className="font-mono bg-white px-2 py-1 rounded border border-slate-200">{dimWeight} lb</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
