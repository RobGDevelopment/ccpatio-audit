"use client";

import { useState } from "react";
import { testVendorKeyAction, saveVendorKeyAction } from "@/app/mission-control/actions";
import { GoldBeam } from "@/components/ui/GoldBeam";
import {
  btnGhost,
  btnPrimary,
  card,
  eyebrow,
  field,
  heading,
  muted,
  noticeError,
  noticeSuccess,
} from "./soft-ui";

type Service = "katana" | "woocommerce" | "clover";

function isService(value: string): value is Service {
  return value === "katana" || value === "woocommerce" || value === "clover";
}

export function KeyManager() {
  const [service, setService] = useState<Service>("katana");
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
      setMessage({ type: "error", text: `HTTP ${res.status}` });
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
      setMessage({ type: "error", text: `HTTP ${res.status}. Reference ${res.ref}.` });
    }
    setSaving(false);
  }

  const busy = testing || saving;

  return (
    <div className={card} data-testid="connection-manager">
      <GoldBeam active={busy} />
      <div className={eyebrow}>Credentials</div>
      <h2 className={heading}>Connection Manager</h2>
      <p className={`mt-1 ${muted}`}>
        Rotate expired API keys for third-party systems. Keys are securely stored and cached.
      </p>

      {message && (
        <div className={`mt-4 ${message.type === "success" ? noticeSuccess : noticeError}`}>
          {message.text}
        </div>
      )}

      <div className="mt-6 max-w-lg space-y-4">
        <div>
          <label htmlFor="mc-vendor-service" className={eyebrow}>
            System
          </label>
          <select
            id="mc-vendor-service"
            value={service}
            onChange={(e) => {
              if (isService(e.target.value)) setService(e.target.value);
              setMessage(null);
            }}
            className={`mt-1.5 ${field}`}
          >
            <option value="katana">Katana (Factory Floor)</option>
            <option value="woocommerce">WooCommerce (Website)</option>
            <option value="clover">Clover (Retail POS)</option>
          </select>
        </div>

        <div>
          <label htmlFor="mc-vendor-key" className={eyebrow}>
            New API Key / Password
          </label>
          {/* Field is write-only and clears after save */}
          <input
            id="mc-vendor-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Enter new credential..."
            className={`mt-1.5 ${field}`}
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button type="button" onClick={handleTest} disabled={busy || !key} className={btnGhost}>
            {testing ? "Testing..." : "Test Connection"}
          </button>

          <button type="button" onClick={handleSave} disabled={busy || !key} className={btnPrimary}>
            {saving ? "Saving..." : "Save Key"}
          </button>
        </div>
      </div>
    </div>
  );
}
