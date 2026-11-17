import { describe, expect, it } from "vitest";
import {
  buildManifestPath,
  evaluateServerFreshness,
  htmlReferencesBuildId,
} from "../scripts/qa/server-freshness";

describe("server-freshness", () => {
  it("builds the Next static manifest path for a BUILD_ID", () => {
    expect(buildManifestPath("abc123")).toBe("/_next/static/abc123/_buildManifest.js");
  });

  it("detects BUILD_ID references inside home HTML", () => {
    const html = `<script src="/_next/static/build-xyz/_buildManifest.js"></script>`;
    expect(htmlReferencesBuildId(html, "build-xyz")).toBe(true);
    expect(htmlReferencesBuildId(html, "other")).toBe(false);
  });

  it("rejects reuse when BUILD_ID is missing (post qa:clean)", () => {
    const v = evaluateServerFreshness({
      buildId: null,
      homeHtml: "<html>ok</html>",
      manifestStatus: null,
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/No \.next\/BUILD_ID/);
  });

  it("rejects crash HTML even when BUILD_ID is present", () => {
    const v = evaluateServerFreshness({
      buildId: "fresh",
      homeHtml: "This page couldn’t load",
      manifestStatus: 200,
      crashHtml: true,
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/crash HTML/);
  });

  it("accepts a live server when the build manifest returns 200", () => {
    const v = evaluateServerFreshness({
      buildId: "fresh",
      homeHtml: "<html>no id</html>",
      manifestStatus: 200,
    });
    expect(v.ok).toBe(true);
    expect(v.reason).toMatch(/Build manifest 200/);
  });

  it("accepts home HTML that embeds the current BUILD_ID", () => {
    const v = evaluateServerFreshness({
      buildId: "fresh",
      homeHtml: `<link rel="preload" href="/_next/static/fresh/css.css"/>`,
      manifestStatus: 404,
    });
    expect(v.ok).toBe(true);
    expect(v.reason).toMatch(/Home HTML references BUILD_ID/);
  });

  it("rejects a stale listener that serves a different build", () => {
    const v = evaluateServerFreshness({
      buildId: "new-build",
      homeHtml: `<script src="/_next/static/old-build/_buildManifest.js"></script>`,
      manifestStatus: 404,
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/does not serve current BUILD_ID/);
  });
});
