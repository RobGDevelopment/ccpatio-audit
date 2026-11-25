/**
 * Single-price Aluminum storefront truth.
 * Precedence: explicit storefront override → Mia Aluminum PDF → base Aluminum MSRP.
 * Never returns steel MSRP or +10% steel upcharges.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MIA_PDF_FIXTURE_REL,
  resolveWebsitePriceFromFixture,
  type MiaPdfFixture,
} from "@/server/ecommerce/mia-aluminum-pricing";

export type CanonicalStorefrontPriceSource =
  | "override"
  | "mia_pdf"
  | "aluminum_msrp"
  | "none";

export type CanonicalStorefrontPriceResult = {
  price: number | null;
  source: CanonicalStorefrontPriceSource;
};

export type ResolveCanonicalStorefrontPriceInput = {
  sku: string;
  wooSku?: string | null;
  sowName?: string | null;
  /** Operator-explicit storefront Aluminum override (dollars). */
  storefrontAluminumOverride?: number | null;
  /** Base Aluminum MSRP from Hub — never steel. */
  aluminumMsrp?: number | null;
  /** Pre-resolved Mia PDF price (skips fixture lookup when set). */
  miaAluminumPdfPrice?: number | null;
  fixture?: MiaPdfFixture | null;
};

function positiveMoney(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Parse money from DB/text into a positive dollar amount. */
export function parseStorefrontMoney(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return positiveMoney(raw);
  const n = Number(String(raw).replace(/[^0-9.-]+/g, ""));
  return positiveMoney(n);
}

/**
 * Read operator override from sku_mappings.attributes when present.
 * Keys: storefront_aluminum_override | storefrontAluminumOverride
 */
export function readStorefrontAluminumOverride(
  attributes: Record<string, unknown> | null | undefined,
): number | null {
  if (!attributes) return null;
  const raw =
    attributes.storefront_aluminum_override ?? attributes.storefrontAluminumOverride;
  return parseStorefrontMoney(raw);
}

let cachedFixture: MiaPdfFixture | null | undefined;

/** Load (and memoize) the Mia Aluminum PDF fixture from disk. */
export function loadMiaAluminumFixture(): MiaPdfFixture | null {
  if (cachedFixture !== undefined) return cachedFixture;
  try {
    const path = join(/*turbopackIgnore: true*/ process.cwd(), MIA_PDF_FIXTURE_REL);
    if (!existsSync(path)) {
      cachedFixture = null;
      return null;
    }
    cachedFixture = JSON.parse(readFileSync(path, "utf8")) as MiaPdfFixture;
    return cachedFixture;
  } catch {
    cachedFixture = null;
    return null;
  }
}

/** Test-only: clear fixture memo. */
export function resetMiaAluminumFixtureCache(): void {
  cachedFixture = undefined;
}

/**
 * Canonical Aluminum storefront Regular price — shared by Tab 2, Dark Drawer,
 * Partner Handoff, CSV export, and Woo REST / Dry-Run payloads.
 */
export function resolveCanonicalStorefrontPrice(
  input: ResolveCanonicalStorefrontPriceInput,
): CanonicalStorefrontPriceResult {
  const override = positiveMoney(input.storefrontAluminumOverride);
  if (override != null) {
    return { price: override, source: "override" };
  }

  let mia = positiveMoney(input.miaAluminumPdfPrice);
  if (mia == null) {
    const fixture = input.fixture === undefined ? loadMiaAluminumFixture() : input.fixture;
    if (fixture) {
      mia = positiveMoney(
        resolveWebsitePriceFromFixture(fixture, {
          sku: input.sku,
          wooSku: input.wooSku ?? undefined,
          sowName: input.sowName ?? undefined,
        }),
      );
    }
  }
  if (mia != null) {
    return { price: mia, source: "mia_pdf" };
  }

  const baseAlu = positiveMoney(input.aluminumMsrp);
  if (baseAlu != null) {
    return { price: baseAlu, source: "aluminum_msrp" };
  }

  return { price: null, source: "none" };
}

/** Format canonical dollars for UI / CSV (`2080` → `$2,080.00`). */
export function formatCanonicalStorefrontPrice(price: number | null): string | null {
  if (price == null) return null;
  return `$${price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Money string for Woo `regular_price` (`2530` → `"2530.00"`). */
export function canonicalPriceToWooString(price: number | null): string {
  if (price == null || !Number.isFinite(price)) return "";
  return price.toFixed(2);
}
