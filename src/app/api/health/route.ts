import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payload = { ok: true } as const;

export async function GET(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  const wantsHtml = accept.includes("text/html");

  if (wantsHtml) {
    const json = JSON.stringify(payload, null, 2);
    return new NextResponse(
      `<!DOCTYPE html>
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
</html>`,
      {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }

  return NextResponse.json(payload, { status: 200 });
}
