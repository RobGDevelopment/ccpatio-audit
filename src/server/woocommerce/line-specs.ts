/**
 * Phase B1 / pipe-hardening: extract the manufacturing spec of every line item
 * (base SKU, quantity, finishes, ACF add-ons).
 *
 * Pure: no I/O. The result is the input to `resolveWooOrder` (DB authority) and to the Katana
 * leg. Anything ambiguous is an issue, never a guess.
 */
import {
  classifyFinishKey,
  FINISH_SLOTS,
  normalizeSku,
  resolveFinishValueToSku,
  type FinishSlot,
} from "./finish-keys";
import type { SkuIngressIssue, WooOrderWebhook } from "./ingress.schema";

/** PrimeView ACF add-on meta keys. Truthy / `"1"` / SKU-valued → structured addons[]; `"0"` / empty ignored. */
export const ACF_ADDON_KEYS: ReadonlySet<string> = new Set([
  "arms",
  "arms_8_thick_textile-wrapped",
  "casters",
  "dekton_sidearm",
  "ironwood",
  "fly_tables",
  "fly_table",
  "fly_table_13_x_30",
  "fly_table_12_x_36_welded_on_back",
  "fly_table_12_x_48_welded_on_back",
  "umbrella_holder",
  "umbrella_cover",
  "coated_led_weight",
  "pillow_for_loungers_w_pocket",
  "base_w_wheels",
  "base_price",
  "wheels",
  "custom_welded_fly_table",
]);

/**
 * Canonical Hub SKUs for ACF checkboxes that send `"1"` / `"yes"` / `"true"` instead of an
 * explicit FIN-* SKU. Explicit SKU values still win. Keys without a default stay `sku: null`
 * and quarantine unless the operator later provisions a mapping.
 *
 * `custom_welded_fly_table` is intentionally absent — truthy values quarantine with
 * `custom_quote_addon_requires_sales` (Contact Sales for Pricing).
 */
export const ACF_ADDON_DEFAULT_SKUS: Readonly<Record<string, string>> = {
  ironwood: "FIN-ESY-MIS-ADDIRONWOOD",
  umbrella_cover: "FIN-ESY-MIS-WEATHERPROOFCO",
  casters: "FIN-ESY-CHS",
  fly_tables: "FIN-OCN-TAB-34X12",
  fly_table: "FIN-OCN-TAB-34X12",
  fly_table_13_x_30: "FIN-OCN-TAB-13X30",
  fly_table_12_x_36_welded_on_back: "FIN-ESY-MIS-FLYTBL-12X36-WLD",
  fly_table_12_x_48_welded_on_back: "FIN-ESY-MIS-FLYTBL-12X48-WLD",
  arms: "FIN-ESY-MIS-ARMS",
  "arms_8_thick_textile-wrapped": "FIN-ESY-MIS-ARMS-8TEXTILE",
  dekton_sidearm: "FIN-ESY-MIS-DKT-SIDEARM",
  umbrella_holder: "FIN-ESY-MIS-UMBHOLDER",
  coated_led_weight: "FIN-TJM-MIS-ONECOATED",
  pillow_for_loungers_w_pocket: "FIN-TJM-MIS-PILLOWLOUNGERS",
  base_w_wheels: "FIN-ESY-MIS-ZENBASE",
  base_price: "FIN-ESY-MIS-ZENBASE",
  wheels: "FIN-ESY-CHS",
};

/** Stable quarantine token for custom-quote welded fly tables. */
export const CUSTOM_QUOTE_ADDON_REASON = "custom_quote_addon_requires_sales";

export type WooLineAddon = {
  key: string;
  /** Raw meta value after trim (e.g. `"1"`, `"true"`, or an add-on SKU). */
  rawValue: string;
  /**
   * Hub add-on SKU when the meta is an explicit FIN-* value, or when a truthy checkbox maps
   * through `ACF_ADDON_DEFAULT_SKUS`. `null` only when truthy with no default (quarantine).
   */
  sku: string | null;
};

export type WooLineSpec = {
  /** Position in `line_items`. */
  index: number;
  /** Woo line-item id when present, else `null` (the Katana mapper falls back to the index). */
  wooLineItemId: number | null;
  /** Upper-cased, trimmed base (finished good) SKU. */
  sku: string;
  quantity: number;
  /** Upper-cased finish SKUs by slot. Absent slot = customer did not choose it. */
  finishes: Partial<Record<FinishSlot, string>>;
  /** Structured ACF add-ons (empty when none). */
  addons: WooLineAddon[];
  /**
   * When this spec is an expanded mapped ACF add-on SO row, the add-on key
   * (makes `wooLineKey` unique vs the parent line).
   */
  addonKey?: string | null;
};

export type ExtractedLineSpecs = {
  specs: WooLineSpec[];
  issues: SkuIngressIssue[];
};

function scalarValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return null;
}

/** Hub-shaped SKU: at least one hyphenated segment (FIN-…, ADD-…, etc.). */
export function looksLikeAddonSku(value: string): boolean {
  return /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(value.trim());
}

function isTruthyAddonFlag(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function isFalsyAddonFlag(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "" || v === "0" || v === "false" || v === "no" || v === "off";
}

function normalizeAddonKey(raw: string): string {
  let key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  let prev = "";
  while (key !== prev) {
    prev = key;
    key = key.replace(/^attribute_/, "").replace(/^pa_/, "").replace(/^_/, "");
  }
  return key;
}

/** Stable key used on the Katana SO row attributes to map a row back to its Woo line. */
export function wooLineKey(
  spec: Pick<WooLineSpec, "index" | "wooLineItemId" | "addonKey">,
): string {
  const base = spec.wooLineItemId !== null ? String(spec.wooLineItemId) : `idx${spec.index}`;
  return spec.addonKey ? `${base}:addon:${spec.addonKey}` : base;
}

export function extractWooLineSpecs(order: WooOrderWebhook): ExtractedLineSpecs {
  const issues: SkuIngressIssue[] = [];
  const specs: WooLineSpec[] = [];

  // Finish keys belong on line items. At order level they are ambiguous (which line?).
  order.meta_data.forEach((entry, metaIndex) => {
    const keyClass = classifyFinishKey(entry.key);
    if (keyClass.kind === "ignored") return;
    issues.push({
      path: `meta_data.${metaIndex}.key`,
      message: `Finish key "${entry.key}" is not allowed at order level. Send finishes on the line item.`,
    });
  });

  order.line_items.forEach((item, index) => {
    const finishes: Partial<Record<FinishSlot, string>> = {};
    const addons: WooLineAddon[] = [];

    item.meta_data.forEach((entry, metaIndex) => {
      const keyPath = `line_items.${index}.meta_data.${metaIndex}`;
      const addonKey = normalizeAddonKey(entry.key);

      if (ACF_ADDON_KEYS.has(addonKey)) {
        const raw = scalarValue(entry.value);
        if (raw === null || isFalsyAddonFlag(raw)) return;

        // Custom welded fly table is always a sales quote — never a silent SO line.
        if (addonKey === "custom_welded_fly_table") {
          if (isTruthyAddonFlag(raw) || looksLikeAddonSku(raw)) {
            issues.push({
              path: `${keyPath}.value`,
              message: `Add-on "custom_welded_fly_table" requires Contact Sales for Pricing (${CUSTOM_QUOTE_ADDON_REASON}).`,
            });
          } else {
            issues.push({
              path: `${keyPath}.value`,
              message: `Add-on "${addonKey}" has an unusable value "${raw}". Send "1"/"0" or Contact Sales.`,
            });
          }
          return;
        }

        if (looksLikeAddonSku(raw)) {
          addons.push({ key: addonKey, rawValue: raw, sku: normalizeSku(raw) });
          return;
        }
        if (isTruthyAddonFlag(raw)) {
          const defaultSku = ACF_ADDON_DEFAULT_SKUS[addonKey];
          addons.push({
            key: addonKey,
            rawValue: raw,
            sku: defaultSku ? normalizeSku(defaultSku) : null,
          });
          return;
        }
        issues.push({
          path: `${keyPath}.value`,
          message: `Add-on "${addonKey}" has an unusable value "${raw}". Send "1"/"0" or an add-on SKU.`,
        });
        return;
      }

      const keyClass = classifyFinishKey(entry.key);
      if (keyClass.kind === "ignored") return;

      if (keyClass.kind === "rejected") {
        issues.push({
          path: `${keyPath}.key`,
          message: `Finish key "${entry.key}" is not accepted. The only accepted finish keys are ${FINISH_SLOTS.join(", ")} (aliases: fabric_sku→fabric, frame_material→frame). Use: ${keyClass.use}.`,
        });
        return;
      }

      const raw = scalarValue(entry.value);
      if (!raw) {
        issues.push({
          path: `${keyPath}.value`,
          message: `Finish "${keyClass.slot}" is empty. A finish value must be a hub SKU.`,
        });
        return;
      }

      // Accept bare Hub SKUs, embedded `(FAB-*)` / `- PWD-*`, or Phase 1 display names.
      const sku = resolveFinishValueToSku(raw, keyClass.slot);
      if (!sku) {
        issues.push({
          path: `${keyPath}.value`,
          message: `Finish "${keyClass.slot}" is empty. A finish value must be a hub SKU.`,
        });
        return;
      }
      const existing = finishes[keyClass.slot];
      if (existing !== undefined && existing !== sku) {
        issues.push({
          path: `${keyPath}.value`,
          message: `Finish "${keyClass.slot}" is given twice with different values (${existing} and ${sku}).`,
        });
        return;
      }
      finishes[keyClass.slot] = sku;
    });

    specs.push({
      index,
      wooLineItemId: typeof item.id === "number" ? item.id : null,
      sku: normalizeSku(item.sku),
      quantity: item.quantity,
      finishes,
      addons,
    });
  });

  return { specs, issues };
}
