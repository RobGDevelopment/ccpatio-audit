"use client";

import { useState } from "react";
import { testVendorKeyAction, saveVendorKeyAction } from "@/app/mission-control/actions";

export function KeyManager() {
  const [service, setService] = useState<"katana" | "woocommerce" | "clover">("katana");
  const [key, setKey] = useState("");
  
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleTest() {
    if (!key) {
      setMessage({ type: "error", text: "Please enter an API key to test." });
      return;
    }
    
    setTesting(true);
    setMessage(null);
    const res = await testVendorKeyAction(service, key);
    
    if (res.ok) {
      setMessage({ type: "success", text: "Connection successful! You can now safely save this key." });
    } else {
      setMessage({ type: "error", text: `Connection failed: ${res.error}` });
    }
    setTesting(false);
  }

  async function handleSave() {
    if (!key) return;
    
    setSaving(true);
    setMessage(null);
    const res = await saveVendorKeyAction(service, key);
    
    if (res.ok) {
      setMessage({ type: "success", text: "Key saved securely and cache cleared." });
      setKey("");
    } else {
      setMessage({ type: "error", text: `Failed to save key: ${res.error}` });
    }
    setSaving(false);
  }

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-6">
      <h2 className="text-lg font-semibold text-zinc-100">Connection Manager</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Rotate expired API keys for third-party systems. Keys are securely stored and cached.
      </p>

      {message && (
        <div className={`mt-4 rounded-md px-4 py-3 text-sm ${message.type === "success" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/10 text-rose-400 border border-rose-500/30"}`}>
          {message.text}
        </div>
      )}

      <div className="mt-6 space-y-4 max-w-lg">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
            System
          </label>
          <select
            value={service}
            onChange={(e) => {
              setService(e.target.value as any);
              setMessage(null);
            }}
            className="mt-1.5 block w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="katana">Katana (Factory Floor)</option>
            <option value="woocommerce">WooCommerce (Website)</option>
            <option value="clover">Clover (Retail POS)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
            New API Key / Password
          </label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Enter new credential..."
            className="mt-1.5 block w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleTest}
            disabled={testing || saving || !key}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-700 disabled:opacity-50"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
          
          <button
            onClick={handleSave}
            disabled={testing || saving || !key}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Key"}
          </button>
        </div>
      </div>
    </div>
  );
}
