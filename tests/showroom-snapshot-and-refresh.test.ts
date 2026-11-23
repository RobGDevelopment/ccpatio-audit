import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("showroom snapshot + embed refresh auth", () => {
  it("proxy preserves inbound x-ccpatio-embed-token on non-embed /api paths", () => {
    const src = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");
    expect(src).toContain("inboundToken");
    expect(src).toContain("embedToken || inboundToken");
    // Must not unconditionally delete the header when embedToken arg is null.
    expect(src).not.toMatch(
      /if \(embedToken\) headers\.set\(EMBED_TOKEN_HEADER, embedToken\);\s*else headers\.delete\(EMBED_TOKEN_HEADER\);/,
    );
  });

  it("showroom-inventory route is Hub-only on GET and dual-auth", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/katana/showroom-inventory/route.ts"),
      "utf8",
    );
    expect(route).toContain("readShowroomSnapshotFromHub");
    expect(route).toContain("refreshShowroomSnapshotFromKatana");
    expect(route).toContain("authorizeEmbedRequest");
    expect(route).toContain("lastSyncedAt");
    expect(route).not.toMatch(/getKatanaInventorySnapshot/);
  });

  it("embed showroom SSR loads sales projection (not live Katana / not ops dump)", () => {
    const page = readFileSync(join(process.cwd(), "src/app/embed/showroom/page.tsx"), "utf8");
    expect(page).toContain("loadShowroomSalesInventory");
    expect(page).toContain("SalesStockView");
    expect(page).not.toContain('inventoryMode="katana-ops"');
    const ops = readFileSync(join(process.cwd(), "src/app/embed/ops-inventory/page.tsx"), "utf8");
    expect(ops).toContain('inventoryMode="katana-ops"');
    const stock = readFileSync(join(process.cwd(), "src/server/showroom/stock.ts"), "utf8");
    expect(stock).toContain("readShowroomSnapshotFromHub");
    expect(stock).toContain("projectShowroomSalesView");
    expect(stock).not.toMatch(/import\s*\{[^}]*ecommerce_listings/);
    expect(stock).not.toMatch(/\.from\(\s*ecommerce_listings\s*\)/);
    expect(stock).not.toMatch(/getKatanaInventorySnapshot\(\s*\{\s*force/);
  });

  it("EmbedSessionProvider exposes getEmbedHeaders + mutable tokenRef", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/embed/EmbedSessionProvider.tsx"),
      "utf8",
    );
    expect(src).toContain("getEmbedHeaders");
    expect(src).toContain("tokenRef");
    expect(src).toContain("tokenRef.current");
  });

  it("refresh-token accepts header OR cookie (incl. mirrored session cookie)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/embed/refresh-token/route.ts"),
      "utf8",
    );
    expect(src).toContain("EMBED_TOKEN_HEADER");
    expect(src).toContain("EMBED_AUTH_COOKIE");
    expect(src).toContain("verifyEmbedSessionToken");
    expect(src).toContain("embedCookieIsValid");
    expect(src).toContain("mirroredSessionCookie");
  });

  it("schema + migration define katana_showroom_snapshot and katana_sync_meta", () => {
    const schema = readFileSync(join(process.cwd(), "src/server/db/schema.ts"), "utf8");
    expect(schema).toContain('pgTable(\n  "katana_showroom_snapshot"');
    expect(schema).toContain('pgTable("katana_sync_meta"');
    const migration = readFileSync(
      join(process.cwd(), "src/server/db/migrations/0061_katana_showroom_snapshot.sql"),
      "utf8",
    );
    expect(migration).toContain("katana_showroom_snapshot");
    expect(migration).toContain("last_synced_at");
    const journal = readFileSync(
      join(process.cwd(), "src/server/db/migrations/meta/_journal.json"),
      "utf8",
    );
    expect(journal).toContain("0061_katana_showroom_snapshot");
  });

  it("LiveStockView Sync Live posts to /api/katana/showroom-inventory", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/showroom/stock/LiveStockView.tsx"),
      "utf8",
    );
    expect(src).toContain("/api/katana/showroom-inventory");
    expect(src).toContain('method: "POST"');
    expect(src).toContain("lastSyncedAt");
  });

  it("CSV headers include Meta: acf_fabric_swatches_json", () => {
    const headers = readFileSync(
      join(process.cwd(), "data_migration/Primeview/product_export_import_headers.csv"),
      "utf8",
    );
    expect(headers).toContain("Meta: acf_fabric_swatches_json");
    expect(headers).not.toMatch(/(?<!Meta: )acf_fabric_swatches_json/);
  });
});

describe("authorizeEmbedRequest dual path", () => {
  it("module exports authorizeEmbedRequest", async () => {
    const mod = await import("@/server/showroom/embed-route-auth");
    expect(typeof mod.authorizeEmbedRequest).toBe("function");
  });
});

// Keep vitest from complaining about unused vi in static-only suites.
void vi;
