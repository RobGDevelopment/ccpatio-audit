import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HealthPayload = {
  status: "ok" | "degraded";
  db: "connected" | "disconnected";
  inngest: "configured" | "missing";
};

/**
 * Public liveness probe — infrastructure only.
 * Never include tokens, connection strings, or secret presence details beyond boolean flags.
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 5.
 */
async function buildHealthPayload(): Promise<{
  payload: HealthPayload;
  httpStatus: number;
}> {
  let db: HealthPayload["db"] = "disconnected";
  try {
    const { getDb } = await import("@/server/db/client");
    const database = getDb();
    await database.execute(sql`select 1`);
    db = "connected";
  } catch {
    db = "disconnected";
  }

  const inngestConfigured = Boolean(
    process.env.INNGEST_EVENT_KEY?.trim() ||
      process.env.INNGEST_SIGNING_KEY?.trim(),
  );
  const inngest: HealthPayload["inngest"] = inngestConfigured
    ? "configured"
    : "missing";

  const ok = db === "connected" && inngest === "configured";
  return {
    payload: {
      status: ok ? "ok" : "degraded",
      db,
      inngest,
    },
    httpStatus: ok ? 200 : 503,
  };
}

function renderHtml(payload: HealthPayload): string {
  const json = JSON.stringify(payload, null, 2);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>ccpatio-middleware health</title>
    <style>
      body { margin: 2rem; font: 16px/1.4 ui-monospace, monospace; background: #111; color: #e8e8e8; }
      h1 { font-size: 0.85rem; font-weight: 600; color: #9ad; letter-spacing: 0.04em; text-transform: uppercase; }
      pre { margin: 1rem 0 0; padding: 1rem; background: #1c1c1c; border: 1px solid #333; }
    </style>
  </head>
  <body>
    <h1>GET /api/health</h1>
    <pre>${json}</pre>
  </body>
</html>`;
}

export async function GET(request: Request) {
  const { payload, httpStatus } = await buildHealthPayload();
  const accept = request.headers.get("accept") ?? "";
  const wantsHtml = accept.includes("text/html");

  if (wantsHtml) {
    return new NextResponse(renderHtml(payload), {
      status: httpStatus,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return NextResponse.json(payload, { status: httpStatus });
}
