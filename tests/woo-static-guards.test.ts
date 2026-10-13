import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { globalDlqHandler } from "@/inngest/dlq";
import {
  inngestFunctions,
  processWooCommerceOrder,
  publishApprovedProduct,
  pushApprovedFactoryOrder,
  releaseCustomJob,
  archiveKatanaVariant,
  syncGhlOpportunity,
  systemHealthPing,
} from "@/inngest/functions";
import { KATANA_TENANT_CONCURRENCY } from "@/server/sre/katana-throttle";
import { autoReleaseExpiredHolds } from "@/server/inngest/inventory-holds";
import { sweepExpiredInventoryHolds } from "@/server/stock/sweep-expired-holds";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

/** Every Phase 10 Woo module. None of them may reach QBO (step 8 owns that). */
const WOO_MODULES = [
  "src/server/woocommerce/ingress.ts",
  "src/server/woocommerce/order-state.ts",
  "src/server/woocommerce/ledger-leg.ts",
  "src/server/woocommerce/katana-deps.ts",
  "src/server/sre/saga-store.ts",
  "src/inngest/woo-order.ts",
  "src/app/api/webhooks/woocommerce/route.ts",
];

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function importSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const specs: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;
  for (let m = re.exec(code); m; m = re.exec(code)) specs.push(m[1]!);
  return specs;
}

function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // external package
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), base]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

describe("Woo modules cannot reach QBO", () => {
  it.each(WOO_MODULES)("%s has no QBO import and no pushToQBO", (rel) => {
    const source = read(rel);
    for (const spec of importSpecifiers(source)) {
      expect(spec, `${rel} imports ${spec}`).not.toMatch(/qbo/i);
    }
    const code = stripComments(source);
    expect(code).not.toMatch(/pushToQBO/);
    expect(code).not.toMatch(/qbo\/client/);
    expect(code).not.toMatch(/integrations\/qbo/);
  });

  it("no module in the TRANSITIVE import graph of the Woo modules is a QBO module", () => {
    const seen = new Set<string>();
    const offenders: string[] = [];
    const queue = WOO_MODULES.map((rel) => path.join(ROOT, rel));
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const normalized = file.replace(/\\/g, "/");
      if (/\/integrations\/qbo\//.test(normalized)) offenders.push(normalized);
      const source = fs.readFileSync(file, "utf8");
      for (const spec of importSpecifiers(source)) {
        const resolved = resolveLocal(spec, file);
        if (resolved) queue.push(resolved);
      }
    }
    expect(offenders).toEqual([]);
    expect(seen.size).toBeGreaterThan(WOO_MODULES.length); // the walk actually walked
  });
});

describe("Woo route source", () => {
  const route = read("src/app/api/webhooks/woocommerce/route.ts");

  it("reads the body once as text and never as json", () => {
    expect(route).not.toMatch(/\breq\.json\s*\(/);
    expect(route.match(/\breq\.text\s*\(/g) ?? []).toHaveLength(1);
  });

  it("keeps the nodejs runtime and force-dynamic", () => {
    expect(route).toMatch(/export const runtime = "nodejs"/);
    expect(route).toMatch(/export const dynamic = "force-dynamic"/);
  });

  it("does no Katana or Clover I/O", () => {
    const code = stripComments(route);
    expect(code).not.toMatch(/@\/lib\/katana/);
    expect(code).not.toMatch(/integrations\/clover/);
    expect(code).not.toMatch(/katanaFetch/);
  });
});

describe("Inngest registration", () => {
  it("registers the Woo saga and the global DLQ handler, and NOT syncGhlOpportunity", () => {
    expect(inngestFunctions).toContain(processWooCommerceOrder);
    expect(inngestFunctions).toContain(globalDlqHandler);
    expect(inngestFunctions).not.toContain(syncGhlOpportunity);
  });

  it("has no duplicate function ids", () => {
    const ids = inngestFunctions.map((fn) => (fn as unknown as { id: (p?: string) => string }).id());
    expect(new Set(ids).size).toBe(ids.length);
  });
});

function optsOf(fn: unknown): Record<string, unknown> {
  return ((fn as { opts?: Record<string, unknown> }).opts ?? {}) as Record<string, unknown>;
}

function concurrencyEntries(fn: unknown): Array<Record<string, unknown>> {
  const c = optsOf(fn).concurrency;
  return (Array.isArray(c) ? c : [c]) as Array<Record<string, unknown>>;
}

describe("Katana-calling registered functions carry the tenant concurrency limit", () => {
  it.each([
    ["processWooCommerceOrder", processWooCommerceOrder],
    ["publishApprovedProduct", publishApprovedProduct],
    ["archiveKatanaVariant", archiveKatanaVariant],
    ["releaseCustomJob", releaseCustomJob],
    ["pushApprovedFactoryOrder", pushApprovedFactoryOrder],
    ["autoReleaseExpiredHolds", autoReleaseExpiredHolds],
    ["sweepExpiredInventoryHolds", sweepExpiredInventoryHolds],
    ["systemHealthPing", systemHealthPing],
  ])("%s", (_name, fn) => {
    expect(concurrencyEntries(fn)).toContainEqual(KATANA_TENANT_CONCURRENCY);
  });

  it("the Woo saga also serializes per order, retries modestly and dedupes by event id", () => {
    const opts = optsOf(processWooCommerceOrder);
    expect(concurrencyEntries(processWooCommerceOrder)).toContainEqual({ limit: 1, key: "event.data.id" });
    expect(opts.retries).toBe(3);
    expect(opts.idempotency).toBe("event.id");
  });

  it("no registered function's onFailure calls sendOhCrapAlert (the DLQ is the single alert authority)", () => {
    for (const fn of inngestFunctions) {
      const onFailure = optsOf(fn).onFailure;
      if (typeof onFailure === "function") {
        expect(String(onFailure)).not.toMatch(/sendOhCrapAlert|alertPipelineFailure/);
      }
    }
    expect(optsOf(processWooCommerceOrder).onFailure).toBeUndefined();
  });
});
