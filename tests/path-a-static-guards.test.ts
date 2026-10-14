import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { inngestFunctions, unregisteredTransactionalFunctions } from "@/inngest/functions";

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

function scanDir(relDir: string): string[] {
  const fullDir = path.resolve(process.cwd(), relDir);
  if (!fs.existsSync(fullDir)) return [];
  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(fullDir, entry.name);
    if (entry.isDirectory()) {
      const sub = scanDir(path.relative(process.cwd(), fullPath));
      files.push(...sub);
    } else if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(path.relative(process.cwd(), fullPath).replace(/\\/g, "/"));
    }
  }
  return files;
}

/** Resolve an import specifier to a repo-relative source file, or null (node_modules / unresolved). */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = path.join("src", spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = path.join(path.dirname(fromFile), spec);
  } else {
    return null;
  }
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    base,
  ]) {
    const full = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return path.relative(process.cwd(), full).replace(/\\/g, "/");
    }
  }
  return null;
}

/** Value imports only (`import type` / `export type` are erased and cannot execute anything). */
function importedSpecifiers(src: string): string[] {
  const out: string[] = [];
  const staticRe = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/g;
  const bareRe = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  const dynRe = /import\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [staticRe, bareRe, dynRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
  }
  return out;
}

/** Every repo source file reachable from `entry` through value imports (static + dynamic). */
function reachableFrom(entry: string, stopAt: ReadonlySet<string> = new Set()): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (stopAt.has(file)) continue;
    for (const spec of importedSpecifiers(readSource(file))) {
      const resolved = resolveSpecifier(file, spec);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

/** Body text of a top-level function declaration (up to the next top-level declaration). */
function functionBody(src: string, name: string): string {
  const start = src.search(new RegExp(`(^|\\n)(export\\s+)?(async\\s+)?function\\s+${name}\\b`));
  if (start < 0) throw new Error(`function ${name} not found`);
  const rest = src.slice(start + 1);
  const next = rest.slice(1).search(/\n(export\s+)?(async\s+)?function\s+\w+|\nexport\s+(const|class|type)\s/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** String literals + import specifiers only (so comments and prose cannot satisfy a guard). */
function codeWithoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("Phase 11 Path A Static Guards", () => {
  it("guard 1: no Path A, CAD-callback, handoff or GHL-sync module imports QBO", () => {
    const targetFiles = [
      ...scanDir("src/server/path-a"),
      ...scanDir("src/app/admin/path-a"),
      "src/server/cad/callback.ts",
      "src/inngest/cad-handoff.ts",
      "src/inngest/path-a-release.ts",
      "src/inngest/path-a-ghl-sync.ts",
      "src/server/ghl/opportunity-writeback.ts",
      "src/app/api/webhooks/cad-callback/route.ts",
    ];

    for (const f of targetFiles) {
      const src = readSource(f);
      expect(src, `${f} must not import QBO`).not.toMatch(/integrations\/qbo/);
      expect(src, `${f} must not import pushToQBO`).not.toMatch(/pushToQBO/);
      expect(src, `${f} must not import qbo\/client`).not.toMatch(/qbo\/client/);
    }
  });

  it("guard 2: NO Katana DELETE anywhere in Path A", () => {
    const targetFiles = [
      ...scanDir("src/server/path-a"),
      "src/inngest/path-a-release.ts",
      "src/inngest/path-a-ghl-sync.ts",
      "src/server/ghl/opportunity-writeback.ts",
    ];

    for (const f of targetFiles) {
      const src = readSource(f);
      expect(src, `${f} must not contain method: "DELETE"`).not.toMatch(/method:\s*["']DELETE["']/i);
      expect(src, `${f} must not contain delete_so or delete_mo`).not.toMatch(/delete_so|delete_mo/i);
      expect(src, `${f} must not call planCompensation`).not.toMatch(/planCompensation/);
      expect(src, `${f} must not use COMPENSATING, COMPENSATED, or SAGA_COMPENSATION_MODE`).not.toMatch(
        /COMPENSATING|COMPENSATED|SAGA_COMPENSATION_MODE/,
      );
    }
  });

  it("guard 3: NO wait primitive in Function 2 or GHL sync; only wait is wait-cad-callback in cad-handoff.ts (clamp <= 120)", () => {
    const function2Src = readSource("src/inngest/path-a-release.ts");
    const ghlSyncSrc = readSource("src/inngest/path-a-ghl-sync.ts");

    for (const [name, src] of [["path-a-release.ts", function2Src], ["path-a-ghl-sync.ts", ghlSyncSrc]] as const) {
      expect(src, `${name} must not contain waitForEvent`).not.toMatch(/waitForEvent/);
      expect(src, `${name} must not contain sleep`).not.toMatch(/step\.sleep/);
      expect(src, `${name} must not contain sleepUntil`).not.toMatch(/step\.sleepUntil/);
      expect(src, `${name} must not contain timeouts`).not.toMatch(/timeouts/);
      expect(src, `${name} must not contain cancelOn`).not.toMatch(/cancelOn/);
    }

    const handoffSrc = readSource("src/inngest/cad-handoff.ts");
    expect(handoffSrc).toContain('"wait-cad-callback"');
    // Ensure timeout clamp exists and max is 120
    expect(handoffSrc).toContain("Math.min");
    expect(handoffSrc).toContain("120");
  });

  it("guard 4: pre-release modules import ZERO Katana HTTP paths or mutations", () => {
    const preReleaseFiles = [
      "src/app/admin/path-a/actions.ts",
      "src/server/path-a/release-request.ts",
      "src/server/factory-bom/finalize-design.ts",
      "src/server/ghl/opportunity-writeback.ts",
      "src/inngest/path-a-ghl-sync.ts",
    ];

    for (const f of preReleaseFiles) {
      const src = readSource(f);
      expect(src, `${f} must not import katanaFetch`).not.toMatch(/katanaFetch/);
      expect(src, `${f} must not import runKatanaStep`).not.toMatch(/runKatanaStep/);
      expect(src, `${f} must not import @/lib/katana`).not.toMatch(/@\/lib\/katana/);
      expect(src, `${f} must not import push-factory-order`).not.toMatch(/push-factory-order/);
      expect(src, `${f} must not import syncBOMToKatana`).not.toMatch(/syncBOMToKatana/);
      expect(src, `${f} must not import publishRecipeToKatanaCore`).not.toMatch(/publishRecipeToKatanaCore/);
    }
  });

  it("guard 4b (M6): pre-release modules reach ZERO Katana writers even TRANSITIVELY", () => {
    const entries = [
      "src/app/admin/path-a/actions.ts",
      "src/server/path-a/release-request.ts",
      "src/server/factory-bom/finalize-design.ts",
      "src/server/ghl/opportunity-writeback.ts",
      "src/inngest/path-a-ghl-sync.ts",
    ];
    const forbidden = [
      "src/lib/katana.ts",
      "src/lib/katana/client.ts",
      "src/server/ghl/push-factory-order.ts",
      "src/server/factory-bom/publish-recipe-katana.ts",
      "src/server/mdm/publish-channels.ts",
    ];
    for (const entry of entries) {
      const reach = reachableFrom(entry);
      for (const bad of forbidden) {
        expect(reach.has(bad), `${entry} transitively imports ${bad}`).toBe(false);
      }
    }
  });

  it("guard 4c (M6): no 'use server' file exports a session-free core, and finalize-design depends on no action file", () => {
    const actions = readSource("src/app/admin/factory-bom/actions.ts");
    expect(actions).not.toMatch(/export\s+async\s+function\s+publishRecipeToKatanaCore/);
    // `actor` as an option would let any Server Action caller impersonate an operator.
    // (word-boundary match: "revalidateFactory" contains the substring "actor" and is legitimate.)
    expect(functionBody(actions, "approveDraftRecipe")).not.toMatch(/\bactor\b/);

    const finalize = readSource("src/server/factory-bom/finalize-design.ts");
    expect(finalize).not.toMatch(/@\/app\/admin\//);

    for (const f of [
      ...scanDir("src/server/path-a"),
      "src/inngest/path-a-release.ts",
      "src/inngest/path-a-ghl-sync.ts",
      "src/server/ghl/opportunity-writeback.ts",
    ]) {
      expect(readSource(f), `${f} must not import a Server Action module`).not.toMatch(
        /@\/app\/admin\/[\w/-]*\/actions/,
      );
    }
  });

  it("guard 5 (B3): every exported Katana writer that can reach a custom SKU consults the fence BEFORE its first write", () => {
    const katanaSrc = readSource("src/lib/katana.ts");

    const mustFenceBeforeNetwork: Array<[string, string]> = [
      ["ensureKatanaVariantForSku", "assertKatanaWriteAllowed("],
      ["syncBOMToKatana", "assertKatanaWriteAllowed("],
      ["syncFinishedGoodToKatana", "assertKatanaWriteAllowed("],
      ["createKatanaSalesOrder", "assertKatanaWriteAllowedForSkus("],
      ["createMakeToOrderManufacturingOrders", "assertKatanaWriteAllowedForSalesOrderRows("],
    ];
    for (const [fn, token] of mustFenceBeforeNetwork) {
      const body = functionBody(katanaSrc, fn);
      const fenceAt = body.indexOf(token);
      expect(fenceAt, `${fn} must call ${token}`).toBeGreaterThan(-1);
      for (const sink of ["katanaFetch(", "upsertProductInKatana(", "resolveKatanaCustomerId(", "getDb()"]) {
        const sinkAt = body.indexOf(sink);
        if (sinkAt >= 0) {
          expect(fenceAt, `${fn}: fence must precede ${sink}`).toBeLessThan(sinkAt);
        }
      }
    }

    // syncFinishedGoodToKatana's body is wrapped in try/catch that turns errors into { ok: false };
    // a fence refusal must not be swallowed by it.
    const fg = functionBody(katanaSrc, "syncFinishedGoodToKatana");
    expect(fg.indexOf("assertKatanaWriteAllowed(")).toBeLessThan(fg.indexOf("try {"));

    const publishChannelsSrc = readSource("src/server/mdm/publish-channels.ts");
    expect(publishChannelsSrc).toContain("assertKatanaWriteAllowed(globalSku)");

    const releaseCustomBuildSrc = readSource("src/server/factory-bom/release-custom-build.ts");
    expect(releaseCustomBuildSrc).toContain("assertKatanaWriteAllowed(globalSku)");

    const dictionaryActions = readSource("src/app/admin/dictionary/actions.ts");
    expect(functionBody(dictionaryActions, "syncBOMToKatanaAction")).toContain("assertKatanaWriteAllowed(");
    expect(functionBody(dictionaryActions, "syncFinishedGoodToKatanaAction")).toContain("getPimSession(");
  });

  it("guard 6: authz.ts contains no env, headers, cookies, email literals, or allowlist (code, not prose)", () => {
    const authzSrc = readSource("src/server/path-a/authz.ts");
    const code = codeWithoutComments(authzSrc);
    expect(code).not.toContain("process.env");
    expect(code).not.toContain("headers(");
    expect(code).not.toContain("cookies(");
    expect(code).not.toMatch(/["'`][^"'`]*@[^"'`]*["'`]/); // no string literal containing '@'
    expect(code).not.toContain("ccpatio");
    expect(code).not.toMatch(/allow-?list/i);
    expect(code).not.toMatch(/\bimport\b[^;]*\b(env|process|next\/headers)\b/);
    // the only dependency is the pure session helper from pim-audit
    expect(importedSpecifiers(authzSrc)).toEqual(["../../lib/pim-audit"]);

    const allSrc = scanDir("src");
    for (const f of allSrc) {
      const src = readSource(f);
      expect(src, `${f} must not define PATH_A_OVERRIDE_APPROVERS`).not.toContain("PATH_A_OVERRIDE_APPROVERS");
    }
  });

  it("guard 7: callback route has exactly one req.text(), no req.json(), exports maxDuration, no Katana; route.ts exports maxDuration", () => {
    const callbackRoute = readSource("src/app/api/webhooks/cad-callback/route.ts");
    const matchesText = callbackRoute.match(/req\.text\(\)/g);
    expect(matchesText?.length).toBe(1);
    expect(callbackRoute).not.toContain("req.json()");
    expect(callbackRoute).toMatch(/export const maxDuration\s*=\s*\d+/);
    expect(callbackRoute).not.toMatch(/@\/lib\/katana|katanaFetch|runKatanaStep/);

    const inngestRoute = readSource("src/app/api/inngest/route.ts");
    expect(inngestRoute).toMatch(/export const maxDuration\s*=\s*\d+/);
  });

  it("guard 8: Function 2 config carries KATANA_TENANT_CONCURRENCY, per-opportunity concurrency, no idempotency, no onFailure", () => {
    const releaseSrc = readSource("src/inngest/path-a-release.ts");
    expect(releaseSrc).toContain("KATANA_TENANT_CONCURRENCY");
    expect(releaseSrc).toContain('key: "event.data.ghlOpportunityId"');
    expect(releaseSrc).not.toMatch(/idempotency:\s*["']/);
    expect(releaseSrc).not.toMatch(/onFailure:\s*async/);
  });

  it("guard 9: convertBlendToGlb is not imported anywhere under src/inngest/", () => {
    const inngestFiles = scanDir("src/inngest");
    for (const f of inngestFiles) {
      const src = readSource(f);
      expect(src, `${f} must not import convertBlendToGlb`).not.toContain("convertBlendToGlb");
    }
  });

  it("guard 10: inngestFunctions contains pathAReleaseToProduction, pathAGhlSync, globalDlqHandler, not syncGhlOpportunity", () => {
    const fnNames = inngestFunctions.map((fn: any) => fn.name || fn.id || fn._fn?.id);
    expect(inngestFunctions).toBeDefined();

    // Check by inspecting the functions array and the file source
    const funcsSrc = readSource("src/inngest/functions.ts");
    const arrayMatch = funcsSrc.match(/export const inngestFunctions\s*=\s*\[([\s\S]*?)\];/);
    const arrayBody = arrayMatch ? arrayMatch[1] : "";

    expect(arrayBody).toContain("pathAReleaseToProduction");
    expect(arrayBody).toContain("pathAGhlSync");
    expect(arrayBody).toContain("globalDlqHandler");
    expect(arrayBody).not.toContain("syncGhlOpportunity");

    expect(unregisteredTransactionalFunctions.length).toBeGreaterThan(0);
    expect(unregisteredTransactionalFunctions[0]).toBeDefined();
  });

  it("guard 11: the ONLY clock read in Function 2 / GHL sync is the injectable `now` default (any Date.now()/new Date() form)", () => {
    for (const f of ["src/inngest/path-a-release.ts", "src/inngest/path-a-ghl-sync.ts"]) {
      const code = codeWithoutComments(readSource(f));
      const hits = [...code.matchAll(/new\s+Date\s*\(|Date\.now\s*\(|performance\.now\s*\(/g)];
      expect(hits.length, `${f} reads the clock ${hits.length} times`).toBeLessThanOrEqual(1);
      if (hits.length === 1) {
        expect(code, `${f}: the single clock read must be the injectable default`).toMatch(
          /deps\.now\s*\?\?\s*\(\(\)\s*=>\s*new\s+Date\s*\(\)\)/,
        );
      }
    }
  });

  it("guard 12: src/app/admin/path-a/** does not reference dlq_events or redrive", () => {
    const adminPathAFiles = scanDir("src/app/admin/path-a");
    for (const f of adminPathAFiles) {
      const src = readSource(f);
      expect(src, `${f} must not contain dlq_events`).not.toContain("dlq_events");
      expect(src, `${f} must not contain redrive`).not.toContain("redrive");
    }
  });

  const PATH_A_MODULES = () => [
    ...scanDir("src/server/path-a"),
    ...scanDir("src/app/admin/path-a"),
    "src/inngest/path-a-release.ts",
    "src/inngest/path-a-ghl-sync.ts",
    "src/inngest/cad-handoff.ts",
    "src/inngest/cad-failure.ts",
    "src/server/ghl/opportunity-writeback.ts",
  ];

  it("guard 13 (B1/D1): Path A is gated by GHL_FACTORY_ORDERS only, never ORDER_PIPELINE_MODE even transitively", () => {
    for (const f of PATH_A_MODULES()) {
      const directCode = codeWithoutComments(readSource(f));
      expect(directCode, `${f} must not read KATANA_E2E_MIRROR`).not.toMatch(/KATANA_E2E_MIRROR/);

      const stopAt = new Set(["src/lib/katana.ts", "src/server/pipeline/catalog-mode.ts"]);
      const reach = reachableFrom(f, stopAt);
      expect(reach.has("src/server/pipeline/mode.ts"), `${f} transitively imports src/server/pipeline/mode.ts`).toBe(false);
      for (const reached of reach) {
        if (stopAt.has(reached)) continue;
        const code = codeWithoutComments(readSource(reached));
        expect(code, `${f} -> ${reached} must not read ORDER_PIPELINE_MODE`).not.toMatch(/ORDER_PIPELINE_MODE/);
        expect(code, `${f} -> ${reached} must not import the Woo pipeline mode`).not.toMatch(/pipeline\/mode["']/);
        expect(code, `${f} -> ${reached} must not call getOrderPipelineMode`).not.toMatch(/getOrderPipelineMode/);
      }
    }
    const release = codeWithoutComments(readSource("src/inngest/path-a-release.ts"));
    expect(release).toMatch(/getGhlFactoryOrderMode|canPushGhlFactoryOrders/);
  });

  it("guard 14 (m1): no empty or comment-only catch block in any Path A module or in processCadUpload", () => {
    const emptyCatch = /catch\s*(\([^)]*\))?\s*\{\s*(\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)?\s*\}/;
    for (const f of [...PATH_A_MODULES(), "src/server/factory-bom/release-gate.ts", "src/server/factory-bom/finalize-design.ts"]) {
      expect(readSource(f), `${f} swallows an error in an empty catch`).not.toMatch(emptyCatch);
    }
    const fnSrc = readSource("src/inngest/functions.ts");
    const from = fnSrc.indexOf("export const processCadUpload");
    const to = fnSrc.indexOf("export const releaseCustomJob");
    expect(from).toBeGreaterThan(-1);
    expect(fnSrc.slice(from, to), "processCadUpload swallows an error in an empty catch").not.toMatch(emptyCatch);
  });

  it("guard 15 (m3): no hard-coded production host in Path A modules", () => {
    for (const f of PATH_A_MODULES()) {
      expect(codeWithoutComments(readSource(f)), `${f} hard-codes a host`).not.toMatch(/app\.ccpatio\.com/);
    }
  });

  it("guard 16 (type safety): Function 2, GHL write-back, store and fence modules declare no `any` (DB handles are typed)", () => {
    for (const f of [
      "src/inngest/path-a-release.ts",
      "src/server/ghl/opportunity-writeback.ts",
      "src/server/path-a/item-store.ts",
      "src/server/path-a/release-store.ts",
      "src/server/path-a/katana-fence.ts",
      "src/server/path-a/release-request.ts",
    ]) {
      const code = codeWithoutComments(readSource(f));
      expect(code, `${f} contains an 'any' type`).not.toMatch(/:\s*any\b|\bas\s+any\b|<any>|\bany\[\]|Record<string,\s*any>/);
    }
  });

  it("guard 17 (B5): no Path A module reads the phantom `item.status` column (design_status is the column)", () => {
    for (const f of ["src/inngest/path-a-release.ts", "src/server/ghl/opportunity-writeback.ts"]) {
      const code = codeWithoutComments(readSource(f));
      expect(code, `${f} reads item.status`).not.toMatch(/\bitem\.status\b/);
    }
  });
});
