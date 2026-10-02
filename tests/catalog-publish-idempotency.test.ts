import { describe, expect, it } from "vitest";
import {
  canMutateKatanaCatalog,
  getCatalogPublishMode,
} from "@/server/pipeline/catalog-mode";
import {
  channelSyncIsCurrent,
  hashChannelPayload,
} from "@/server/mdm/channel-sync";

describe("catalog publish mode (Tier 1.2)", () => {
  it("defaults to log when no catalog or order live flag", () => {
    const prevCatalog = process.env.CATALOG_PUBLISH_MODE;
    const prevOrder = process.env.ORDER_PIPELINE_MODE;
    const prevMirror = process.env.KATANA_E2E_MIRROR;
    delete process.env.CATALOG_PUBLISH_MODE;
    process.env.ORDER_PIPELINE_MODE = "log";
    delete process.env.KATANA_E2E_MIRROR;
    expect(getCatalogPublishMode()).toBe("log");
    expect(canMutateKatanaCatalog()).toBe(false);
    process.env.CATALOG_PUBLISH_MODE = prevCatalog;
    process.env.ORDER_PIPELINE_MODE = prevOrder;
    process.env.KATANA_E2E_MIRROR = prevMirror;
  });

  it("honors CATALOG_PUBLISH_MODE=live over order log", () => {
    const prevCatalog = process.env.CATALOG_PUBLISH_MODE;
    const prevOrder = process.env.ORDER_PIPELINE_MODE;
    const prevMirror = process.env.KATANA_E2E_MIRROR;
    process.env.CATALOG_PUBLISH_MODE = "live";
    process.env.ORDER_PIPELINE_MODE = "log";
    delete process.env.KATANA_E2E_MIRROR;
    expect(getCatalogPublishMode()).toBe("live");
    expect(canMutateKatanaCatalog()).toBe(true);
    process.env.CATALOG_PUBLISH_MODE = prevCatalog;
    process.env.ORDER_PIPELINE_MODE = prevOrder;
    process.env.KATANA_E2E_MIRROR = prevMirror;
  });

  it("falls back to ORDER_PIPELINE_MODE=live when catalog unset", () => {
    const prevCatalog = process.env.CATALOG_PUBLISH_MODE;
    const prevOrder = process.env.ORDER_PIPELINE_MODE;
    const prevMirror = process.env.KATANA_E2E_MIRROR;
    delete process.env.CATALOG_PUBLISH_MODE;
    process.env.ORDER_PIPELINE_MODE = "live";
    delete process.env.KATANA_E2E_MIRROR;
    expect(getCatalogPublishMode()).toBe("live");
    expect(canMutateKatanaCatalog()).toBe(true);
    process.env.CATALOG_PUBLISH_MODE = prevCatalog;
    process.env.ORDER_PIPELINE_MODE = prevOrder;
    process.env.KATANA_E2E_MIRROR = prevMirror;
  });
});

describe("channel_sync payload hash (Tier 1.3)", () => {
  it("hashes stably and matches current success rows", () => {
    const a = hashChannelPayload({ sku: "FIN-X", rows: 2 });
    const b = hashChannelPayload({ sku: "FIN-X", rows: 2 });
    const c = hashChannelPayload({ sku: "FIN-X", rows: 3 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(channelSyncIsCurrent({ status: "success", payload_hash: a }, a)).toBe(
      true,
    );
    expect(channelSyncIsCurrent({ status: "success", payload_hash: a }, c)).toBe(
      false,
    );
    expect(channelSyncIsCurrent({ status: "failed", payload_hash: a }, a)).toBe(
      false,
    );
  });
});
