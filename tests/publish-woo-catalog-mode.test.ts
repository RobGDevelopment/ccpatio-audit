import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canMutateWooCommerceCatalog,
  getWooCatalogPublishMode,
} from "@/server/pipeline/woo-catalog-mode";

describe("WOO_CATALOG_PUBLISH_MODE gate", () => {
  it("defaults to unset (legacy allow) when missing", () => {
    expect(getWooCatalogPublishMode({})).toBe("unset");
    expect(canMutateWooCommerceCatalog("unset")).toBe(true);
    expect(canMutateWooCommerceCatalog("live")).toBe(true);
    expect(canMutateWooCommerceCatalog("log")).toBe(false);
  });

  it("treats garbage as unset (legacy allow)", () => {
    expect(getWooCatalogPublishMode({ WOO_CATALOG_PUBLISH_MODE: "garbage" })).toBe("unset");
    expect(getWooCatalogPublishMode({ WOO_CATALOG_PUBLISH_MODE: " LOG " })).toBe("log");
  });
});

describe("publishToWooCommerce honors WOO_CATALOG_PUBLISH_MODE=log", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("skips Woo REST upsert in log mode", async () => {
    const upsertWoo = vi.fn();
    vi.doMock("@/lib/woocommerce-catalog", () => ({
      upsertWooCommerceProduct: upsertWoo,
      WooCommerceApiError: class extends Error {},
    }));
    vi.doMock("@/mappers/woocommerce", () => ({
      mapFinishedGoodToWooCommerce: () => ({
        skip: false,
        payload: { sku: "FIN-TEST", name: "Test" },
      }),
    }));
    vi.doMock("@/server/mdm/channel-sync", () => ({
      channelSyncIsCurrent: () => false,
      getChannelSyncRow: async () => null,
      hashChannelPayload: () => "hash",
      upsertChannelSync: vi.fn().mockResolvedValue(undefined),
    }));

    process.env.WOO_CATALOG_PUBLISH_MODE = "log";
    const { publishToWooCommerce } = await import("@/server/mdm/publish-channels");
    const result = await publishToWooCommerce({
      rootSku: "FIN-TEST",
      commerce: {} as never,
    } as never);

    expect(result).toEqual({ skipped: true, externalId: "dry_run" });
    expect(upsertWoo).not.toHaveBeenCalled();
    delete process.env.WOO_CATALOG_PUBLISH_MODE;
  });

  it("allows Woo REST upsert when mode is unset (legacy)", async () => {
    const upsertWoo = vi.fn().mockResolvedValue({ externalId: "woo-99" });
    vi.doMock("@/lib/woocommerce-catalog", () => ({
      upsertWooCommerceProduct: upsertWoo,
      WooCommerceApiError: class extends Error {},
    }));
    vi.doMock("@/mappers/woocommerce", () => ({
      mapFinishedGoodToWooCommerce: () => ({
        skip: false,
        payload: { sku: "FIN-TEST", name: "Test" },
      }),
    }));
    const upsertChannelSync = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/server/mdm/channel-sync", () => ({
      channelSyncIsCurrent: () => false,
      getChannelSyncRow: async () => null,
      hashChannelPayload: () => "hash",
      upsertChannelSync,
    }));

    delete process.env.WOO_CATALOG_PUBLISH_MODE;
    const { publishToWooCommerce } = await import("@/server/mdm/publish-channels");
    const result = await publishToWooCommerce({
      rootSku: "FIN-TEST",
      commerce: {} as never,
    } as never);

    expect(upsertWoo).toHaveBeenCalledOnce();
    expect(result).toEqual({ skipped: false, externalId: "woo-99" });
  });
});
