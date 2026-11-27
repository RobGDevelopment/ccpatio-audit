import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ECOMMERCE_32_FINISHES,
  ecommercePowderSkus,
  isLegacyShowroomFinishSku,
  resolveEcommerceFinishSku,
} from "@/server/ecommerce/ecommerce-32-finish-roster";
import {
  activePowderCoatCount,
  bridgeDektonSku,
  computeKatanaAlignmentSummary,
  finishSkuLookupKeys,
  isAllCapsFactoryTitle,
  isFreestandingNonSectionalProduct,
  isStalePowderFactoryDisplayName,
  powderFactorySubtitle,
} from "@/server/ecommerce/katana-ssot-bridge";
import { isStaleFinishDisplayName } from "@/server/assets/finish-assets";
import {
  buildWooDiagnosticReport,
  storefrontTitlePreserveAcronyms,
} from "@/server/ecommerce/executive-stack-health";
import {
  formatVariationsFacing,
  storefrontDisplayTitle,
} from "@/server/ecommerce/portal-readiness";
import { PHASE1_SOW_ITEM_COUNT } from "@/server/ecommerce/phase1-portal";
import {
  getSanitizedQboConfig,
  probeQboCredentialPair,
} from "@/server/integrations/qbo/oauth";
import {
  HUB_SYNC_FRESH_MS,
  resolveHubSyncBadge,
} from "@/server/stock/hub-sync-freshness";
import { SHOWROOM_SYNC_META_ID } from "@/server/stock/showroom-snapshot";

describe("A1 — Powder Coats 6/6 + PWD-BEIGE alias + factory subtitles", () => {
  it("locks active powder coats to exactly 6 with PWD-BEIGE retired into aliases", () => {
    expect(activePowderCoatCount()).toBe(6);
    expect(ecommercePowderSkus()).toHaveLength(6);
    expect(resolveEcommerceFinishSku("PWD-BEIGE")).toBe("PWD-LITE-BEIGE");
    expect(isLegacyShowroomFinishSku("PWD-BEIGE")).toBe(true);
    expect(ECOMMERCE_32_FINISHES.some((f) => f.sku === "PWD-BEIGE")).toBe(false);
  });

  it("soft-patches Fanuc Gray / Lite Beige / Oil Rubbed Bronze but not Mia-custom names", () => {
    expect(isStaleFinishDisplayName("PWD-FANUC-GRAY", "Fanuc Gray")).toBe(true);
    expect(isStalePowderFactoryDisplayName("PWD-LITE-BEIGE", "Lite Beige")).toBe(true);
    expect(isStaleFinishDisplayName("PWD-OIL-RUB-BRONZE", "Oil Rubbed Bronze")).toBe(true);
    expect(isStaleFinishDisplayName("PWD-FANUC-GRAY", "Gray")).toBe(false);
    expect(isStaleFinishDisplayName("PWD-FANUC-GRAY", "Mia Custom Slate")).toBe(false);
    expect(powderFactorySubtitle("PWD-FANUC-GRAY")).toBe("Fanuc Gray");
    expect(powderFactorySubtitle("PWD-LITE-BEIGE")).toBe("Lite Beige");
    expect(powderFactorySubtitle("PWD-OIL-RUB-BRONZE")).toBe("Oil Rubbed Bronze");
  });
});

describe("A2 — DKT ↔ STN-DKT bridge + Rue Coastal solid repeat", () => {
  it("bridges STN-DKT-* and roster aliases to canonical DKT-*", () => {
    expect(bridgeDektonSku("STN-DKT-ALD")).toBe("DKT-ALDEM");
    expect(resolveEcommerceFinishSku("STN-DKT-AUR")).toBe("DKT-AURA");
    expect(finishSkuLookupKeys("STN-DKT-NIL2.0")).toContain("DKT-NILIUM");
    expect(finishSkuLookupKeys("DKT-STRATO")).toContain("STN-DKT-STR");
  });

  it("Rue Coastal roster is solid (null repeat)", () => {
    const rue = ECOMMERCE_32_FINISHES.find((f) => f.sku === "FAB-RUE-COS");
    expect(rue?.patternRepeatIn).toBeNull();
  });
});

describe("A4 — Katana alignment summary (staged rename, no create)", () => {
  it("computes linked / aligned / stagedRename with Safe Hold label", () => {
    const summary = computeKatanaAlignmentSummary(
      [
        {
          ecommerceSku: "PWD-BLACK",
          ecommerceName: "Black",
          katanaVariantId: 1,
          katanaSku: "PWD-BLACK",
          katanaName: "Black",
        },
        {
          ecommerceSku: "PWD-FANUC-GRAY",
          ecommerceName: "Gray",
          katanaVariantId: 2,
          katanaSku: "PWD-FANUC-GRAY",
          katanaName: "Fanuc Gray",
        },
        {
          ecommerceSku: "FAB-CAN-WHI",
          ecommerceName: "Canvas White",
          katanaVariantId: null,
          katanaSku: null,
          katanaName: null,
        },
      ],
      false,
    );
    expect(summary.linkedCount).toBe(2);
    expect(summary.alignedCount).toBe(1);
    expect(summary.stagedRenameCount).toBe(1);
    expect(summary.label).toContain("Katana Alignment:");
    expect(summary.label).toContain("Safe Hold until DOWNSTREAM_MUTATIONS=true");
  });
});

describe("A5 — Unified katana_sync_meta watermark + fresh badge", () => {
  it("exports canonical SHOWROOM_SYNC_META_ID and green when <30m", () => {
    expect(SHOWROOM_SYNC_META_ID).toBe("showroom_inventory");
    const now = new Date().toISOString();
    const badge = resolveHubSyncBadge(now);
    expect(badge.tone).toBe("green");
    expect(badge.shouldQueueBackgroundSync).toBe(false);
    expect(HUB_SYNC_FRESH_MS).toBe(30 * 60 * 1000);
  });

  it("stack katana-sync route and showroom share SHOWROOM_SYNC_META_ID", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/stack/katana-sync/route.ts"),
      "utf8",
    );
    const actions = readFileSync(
      join(process.cwd(), "src/app/embed/admin/master-catalog/actions.ts"),
      "utf8",
    );
    expect(route).toMatch(/SHOWROOM_SYNC_META_ID|syncKatanaInventoryNow/);
    expect(actions).toContain("SHOWROOM_SYNC_META_ID");
  });
});

describe("A6 — Formal PrimeView diagnostic report", () => {
  it("emits Document ID, Generated UTC, Severity P1, 5 sections, attestation", () => {
    const report = buildWooDiagnosticReport({
      host: "ccpatiodev2.primeview.com",
      httpStatus: 500,
      label: "WordPress PHP Critical Error",
      snippet: "There has been a critical error on this website.",
      checkedAt: "2026-11-27T12:00:00.000Z",
    });
    expect(report).toContain("Document ID: CCP-DIAG-WOO-20261127");
    expect(report).toContain("Generated UTC:");
    expect(report).toContain("Severity: P1 BLOCKER");
    expect(report).toContain("Executive Summary");
    expect(report).toContain("Live Telemetry & Probe Evidence");
    expect(report).toContain("Isolation & Change-Control Attestation");
    expect(report).toContain("Required PrimeView Engineering Actions");
    expect(report).toContain("Staged Payload Summary");
    expect(report).toMatch(/DOWNSTREAM_MUTATIONS=/);
    expect(report).toMatch(/WOO_LEDGER_MODE=/);
    expect(report).toContain("Finishes staged (certified roster): 32");
    expect(report).toContain("Aluminum SKUs staged (purchasable): 107");
  });
});

describe("A8 — QBO_OAUTH_REDIRECT_URI + RFC 6749 + secretSha256Prefix8", () => {
  it("prefers QBO_OAUTH_REDIRECT_URI over QBO_REDIRECT_URI and normalizes environment", () => {
    const cfg = getSanitizedQboConfig({
      QBO_CLIENT_ID: "cid123",
      QBO_CLIENT_SECRET: "sec-secret-value",
      QBO_OAUTH_REDIRECT_URI: "https://hub.ccpatio.com/api/auth/qbo/callback",
      QBO_REDIRECT_URI: "https://wrong.example/api/auth/qbo/callback",
      QBO_ENVIRONMENT: "Production",
    });
    expect(cfg.redirectUri).toBe("https://hub.ccpatio.com/api/auth/qbo/callback");
    expect(cfg.environment).toBe("production");
    expect(cfg.secretSha256Prefix8).toBe(
      createHash("sha256").update("sec-secret-value", "utf8").digest("hex").slice(0, 8),
    );
  });

  it("probeQboCredentialPair maps invalid_grant → valid pair and invalid_client → mismatch", async () => {
    const grantFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );
    const grant = await probeQboCredentialPair(
      {
        QBO_CLIENT_ID: "cid",
        QBO_CLIENT_SECRET: "sec",
        QBO_OAUTH_REDIRECT_URI: "https://hub.ccpatio.com/api/auth/qbo/callback",
      },
      null,
      grantFetch as unknown as typeof fetch,
    );
    expect(grant.verdict).toBe("valid_pair");
    expect(grant.label).toContain("Credentials Pair Valid");

    const firstCall = grantFetch.mock.calls[0] as unknown as [
      string,
      { body?: string; headers?: Record<string, string> },
    ];
    const body = firstCall?.[1];
    expect(body?.body).toContain("grant_type=authorization_code");
    expect(body?.body).not.toContain("client_secret");
    expect(body?.headers?.Authorization).toMatch(/^Basic /);

    const mismatch = await probeQboCredentialPair(
      {
        QBO_CLIENT_ID: "cid",
        QBO_CLIENT_SECRET: "sec",
        QBO_OAUTH_REDIRECT_URI: "https://hub.ccpatio.com/api/auth/qbo/callback",
      },
      null,
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }),
      ) as unknown as typeof fetch,
    );
    expect(mismatch.verdict).toBe("mismatch");
    expect(mismatch.label).toContain("Client ID / Secret Mismatch");
  });

  it("reconnect opens named popup and connect preserves embed key", () => {
    const strip = readFileSync(
      join(process.cwd(), "src/app/embed/admin/master-catalog/ecommerce/ExecutiveStackHealthStrip.tsx"),
      "utf8",
    );
    expect(strip).toContain('"ccpatio_qbo_oauth"');
    expect(strip).toContain("popup,width=680,height=780");
    const connect = readFileSync(
      join(process.cwd(), "src/app/api/auth/qbo/connect/route.ts"),
      "utf8",
    );
    expect(connect).toContain("qbo_oauth_embed_key");
  });
});

describe("A9/A10 — KPI Simple heaters, Title Case, Mia 102", () => {
  it("freestanding heaters/lamps/loungers are Simple (never -LS/-RS)", () => {
    expect(
      formatVariationsFacing({
        globalSku: "FIN-KINDLE-HEATER",
        productName: 'KINDLE LIVING HEATER (d15cm)',
        hasLsRsPair: true,
        variationCount: 2,
      }),
    ).toBe("Simple");
    expect(
      formatVariationsFacing({
        globalSku: "FIN-KINDLE-LAMP",
        productName: "KINDLE LIVING LAMP (d15cm)",
        hasLsRsPair: true,
      }),
    ).toBe("Simple");
    expect(
      formatVariationsFacing({
        globalSku: "FIN-LAYD-LOUNGER",
        productName: "LAY'D LOUNGER",
        hasLsRsPair: true,
      }),
    ).toBe("Simple");
    expect(
      isFreestandingNonSectionalProduct({ productName: "Malibu Sectional Corner" }),
    ).toBe(false);
  });

  it("Title Case preserves BH/SH/OD/LED/d15cm and detects ALL-CAPS factory titles", () => {
    expect(storefrontDisplayTitle('KINDLE LIVING HEATER (d15cm)')).toMatch(/Kindle Living Heater/i);
    expect(storefrontTitlePreserveAcronyms("BRAVADA CLUB CHAIR BH OD")).toContain("BH");
    expect(storefrontTitlePreserveAcronyms("BRAVADA CLUB CHAIR BH OD")).toContain("OD");
    expect(isAllCapsFactoryTitle("KINDLE LIVING HEATER (d15cm)")).toBe(true);
    expect(isAllCapsFactoryTitle("Kindle Living Heater (d15cm)")).toBe(false);
  });

  it("Mia Approved SOW parity is 102", () => {
    expect(PHASE1_SOW_ITEM_COUNT).toBe(102);
  });
});

describe("UI source contracts (Stage New / Website filter / Stage Media)", () => {
  it("portal + showroom source contain required operator affordances", () => {
    const portal = readFileSync(
      join(process.cwd(), "src/app/embed/admin/master-catalog/ecommerce/EcommerceCertificationPortal.tsx"),
      "utf8",
    );
    expect(portal).toMatch(/Stage New .+ in Intake/);
    expect(portal).not.toContain("Download Full 38 Finishes");
    expect(portal).not.toContain("download-finishes-manifest");
    expect(portal).toContain("Copy Diagnostic Report for PrimeView");
    expect(portal).toContain("Model3dCell");

    const phase1 = readFileSync(
      join(process.cwd(), "src/app/embed/admin/master-catalog/ecommerce/Phase1PortalViews.tsx"),
      "utf8",
    );
    expect(phase1).toContain("Stage Media / 3D");

    const showroom = readFileSync(
      join(process.cwd(), "src/app/showroom/stock/SalesStockView.tsx"),
      "utf8",
    );
    expect(showroom).toContain("ecommerce-website-filter");
    expect(showroom).toContain("E-Commerce Website");
  });
});
