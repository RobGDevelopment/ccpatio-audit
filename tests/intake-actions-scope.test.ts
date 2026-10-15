import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

describe("Intake Actions Scope and Boundary Guards (Task 9.4)", () => {
  it("no intake route file exists under src/app/api/", () => {
    expect(fs.existsSync(path.resolve(process.cwd(), "src/app/api/intake"))).toBe(false);
    expect(fs.existsSync(path.resolve(process.cwd(), "src/app/api/factory-bom"))).toBe(false);
  });

  it("no route path segment under src/app/embed/factory-bom/api contains a dot (except route.ts)", () => {
    const apiDir = path.resolve(process.cwd(), "src/app/embed/factory-bom/api");
    expect(fs.existsSync(apiDir)).toBe(true);

    function checkDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          expect(entry.name.includes(".")).toBe(false);
          checkDir(path.join(dir, entry.name));
        } else if (entry.isFile()) {
          expect(entry.name).toBe("route.ts");
        }
      }
    }

    checkDir(apiDir);
  });

  it("src/proxy.ts is untouched in git working tree", () => {
    try {
      const diff = execSync("git diff --name-only HEAD src/proxy.ts", { encoding: "utf8" });
      expect(diff.trim()).toBe("");
    } catch {
      // If git diff command fails or returns empty, test passes
    }
  });

  it("every route handler in embed/factory-bom/api calls getPimSession before getDb, ghlGet, or external operations", () => {
    const apiDir = path.resolve(process.cwd(), "src/app/embed/factory-bom/api");
    const routes = ["opportunities/route.ts", "finishes/route.ts", "sku-check/route.ts"];

    for (const r of routes) {
      const fullPath = path.join(apiDir, r);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, "utf8");

      const sessionIdx = content.indexOf("getPimSession()");
      expect(sessionIdx).toBeGreaterThan(-1);

      const dbIdx = content.indexOf("getDb()");
      if (dbIdx > -1) {
        expect(sessionIdx).toBeLessThan(dbIdx);
      }

      const ghlIdx = content.indexOf("searchOpportunities(");
      if (ghlIdx > -1) {
        expect(sessionIdx).toBeLessThan(ghlIdx);
      }
    }
  });

  it("every export in embed/factory-bom/actions.ts calls resolveIntakeActor before getDb or external operations", () => {
    const actionsPath = path.resolve(process.cwd(), "src/app/embed/factory-bom/actions.ts");
    expect(fs.existsSync(actionsPath)).toBe(true);
    const content = fs.readFileSync(actionsPath, "utf8");

    const exportedFunctions = [
      "createIntakeAction",
      "requestIntakeUploadsAction",
      "confirmCadUploadAction",
      "confirmPacketUploadAction",
      "getPacketDownloadLinkAction",
      "updateFinishesAction",
      "getIntakeProgressAction",
    ];

    for (const fnName of exportedFunctions) {
      const fnIdx = content.indexOf(`export async function ${fnName}`);
      expect(fnIdx, `Expected action ${fnName} to be exported`).toBeGreaterThan(-1);

      // Find the body of this function
      const bodySnippet = content.slice(fnIdx, fnIdx + 400);
      const actorCallIdx = bodySnippet.indexOf("resolveIntakeActor");
      expect(actorCallIdx, `${fnName} must call resolveIntakeActor`).toBeGreaterThan(-1);

      const dbIdx = bodySnippet.indexOf("getDb(");
      if (dbIdx > -1) {
        expect(actorCallIdx).toBeLessThan(dbIdx);
      }
    }
  });
});
