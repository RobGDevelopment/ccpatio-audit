/**
 * phase1-redteam-closeout — unit proofs for the 7 red-team punch-list items.
 */
import { describe, expect, it } from "vitest";
import {
  buildSurgicalWooPayload,
  mapWithConcurrency,
  parseWooStoreUnits,
} from "@/server/woocommerce/woo-catalog-sync";
import {
  resolveFinishValueToSku,
  stripApfPriceSuffix,
} from "@/server/woocommerce/finish-keys";
import { extractWooLineSpecs } from "@/server/woocommerce/line-specs";
import { wooLine, wooOrder } from "./helpers/woo-fakes";
import { mintEmbedSessionToken, verifyEmbedSessionToken } from "@/lib/embed-auth";

describe("FIX 4 — Brizy-safe Woo payload", () => {
  const units = parseWooStoreUnits([
    { id: "woocommerce_weight_unit", value: "lb" },
    { id: "woocommerce_dimension_unit", value: "in" },
  ]);
  const parent = {
    sku: "FIN-BRV-CLB-CHA-34X34",
    name: "Bravada Club Chair",
    shortDescription: "HUB MARKETING",
    description: "HUB BRIZY SHOULD NOT OVERWRITE",
    status: "publish" as const,
    variations: [
      {
        sku: "FIN-BRV-CLB-CHA-34X34",
        regularPrice: 2530,
        weightLb: 40,
        lengthIn: 34,
        widthIn: 34,
        heightIn: 31,
      },
    ],
  };

  it("omits description/short_description by default (includeCopy=false)", () => {
    const built = buildSurgicalWooPayload(parent, units);
    expect(built.product).not.toHaveProperty("description");
    expect(built.product).not.toHaveProperty("short_description");
  });

  it("includes copy only when includeCopy=true", () => {
    const built = buildSurgicalWooPayload(parent, units, { includeCopy: true });
    expect(built.product.description).toBe("HUB BRIZY SHOULD NOT OVERWRITE");
    expect(built.product.short_description).toBe("HUB MARKETING");
  });

  it("mapWithConcurrency respects bound of 4", async () => {
    let live = 0;
    let maxLive = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapWithConcurrency(items, 4, async (n) => {
      live += 1;
      maxLive = Math.max(maxLive, live);
      await new Promise((r) => setTimeout(r, 10));
      live -= 1;
      return n * 2;
    });
    expect(maxLive).toBeLessThanOrEqual(4);
  });
});

describe("FIX 5 — APF price suffixes", () => {
  it("resolves Black/Ash/Yes with (+$…) suffixes", () => {
    expect(stripApfPriceSuffix("Black (+$0.00)")).toBe("Black");
    expect(resolveFinishValueToSku("Black (+$0.00)", "powder_coat")).toBe("PWD-BLACK");
    expect(resolveFinishValueToSku("Ash (+$0.00)", "fabric")).toBe("FAB-ACT-ASH");
    const { specs, issues } = extractWooLineSpecs(
      wooOrder({
        line_items: [
          wooLine({
            meta_data: [
              { key: "powder_coat", value: "Black (+$0.00)" },
              { key: "umbrella_cover", value: "Yes (+$100.00)" },
            ],
          }),
        ],
      }),
    );
    expect(issues).toEqual([]);
    expect(specs[0]!.finishes.powder_coat).toBe("PWD-BLACK");
    expect(specs[0]!.addons[0]?.key).toBe("umbrella_cover");
  });
});

describe("FIX 6 — embed token mint/verify round-trip", () => {
  it("mints a verifiable 2h token", async () => {
    const secret = "test-embed-secret-for-redteam";
    const token = await mintEmbedSessionToken(secret, 1_700_000_000);
    const claims = await verifyEmbedSessionToken(token, secret, 1_700_000_000);
    expect(claims?.iat).toBe(1_700_000_000);
    expect(claims?.exp).toBe(1_700_000_000 + 60 * 60 * 2);
  });
});
