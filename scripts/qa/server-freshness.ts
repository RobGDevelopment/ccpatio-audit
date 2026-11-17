import fs from "node:fs";
import path from "node:path";

/**
 * Pure helpers for detecting a stale `next start` process after `qa:clean`
 * deletes `.next` and a new production build writes a new BUILD_ID.
 */

export function readBuildId(nextDir = path.join(process.cwd(), ".next")): string | null {
  try {
    const raw = fs.readFileSync(path.join(nextDir, "BUILD_ID"), "utf8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function buildManifestPath(buildId: string): string {
  return `/_next/static/${buildId}/_buildManifest.js`;
}

/** True when HTML from `/` embeds the current Next build id in static asset URLs. */
export function htmlReferencesBuildId(html: string, buildId: string): boolean {
  if (!buildId) return false;
  return (
    html.includes(`/_next/static/${buildId}/`) ||
    html.includes(`/_next/static/${buildId}"`) ||
    html.includes(`/_next/static/${buildId}'`)
  );
}

export type FreshnessInput = {
  /** BUILD_ID from disk after the latest production build. */
  buildId: string | null;
  /** Home HTML when fetch succeeded; null when unreachable. */
  homeHtml: string | null;
  /** HTTP status of GET /_next/static/<BUILD_ID>/_buildManifest.js; null if not probed. */
  manifestStatus: number | null;
  /** Crash-page markers already used by proof-of-life. */
  crashHtml?: boolean;
};

export type FreshnessVerdict =
  | { ok: true; reason: string }
  | { ok: false; reason: string };

/**
 * Decide whether an already-listening :3000 server is safe to reuse.
 * Missing BUILD_ID after qa:clean means any leftover listener is stale.
 */
export function evaluateServerFreshness(input: FreshnessInput): FreshnessVerdict {
  if (input.crashHtml) {
    return { ok: false, reason: "Server returned Next.js crash HTML (stale after qa:clean)." };
  }
  if (!input.buildId) {
    return {
      ok: false,
      reason: "No .next/BUILD_ID on disk; refusing to reuse port 3000 (likely stale after qa:clean).",
    };
  }
  if (input.homeHtml == null && input.manifestStatus == null) {
    return { ok: false, reason: "Server on port 3000 did not respond to freshness probes." };
  }
  if (input.manifestStatus === 200) {
    return { ok: true, reason: `Build manifest 200 for BUILD_ID ${input.buildId}.` };
  }
  if (input.homeHtml && htmlReferencesBuildId(input.homeHtml, input.buildId)) {
    return { ok: true, reason: `Home HTML references BUILD_ID ${input.buildId}.` };
  }
  return {
    ok: false,
    reason: `Port 3000 server does not serve current BUILD_ID ${input.buildId} (stale next start).`,
  };
}

export async function probeServerFreshness(
  baseUrl: string,
  buildId: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<FreshnessVerdict> {
  let homeHtml: string | null = null;
  let crashHtml = false;
  let manifestStatus: number | null = null;

  try {
    const home = await fetchImpl(baseUrl);
    if (home.ok) {
      homeHtml = await home.text();
      crashHtml =
        homeHtml.includes("This page couldn’t load") ||
        homeHtml.includes("This page couldn't load");
    }
  } catch {
    homeHtml = null;
  }

  if (buildId) {
    try {
      const manifest = await fetchImpl(`${baseUrl}${buildManifestPath(buildId)}`);
      manifestStatus = manifest.status;
    } catch {
      manifestStatus = null;
    }
  }

  return evaluateServerFreshness({ buildId, homeHtml, manifestStatus, crashHtml });
}
