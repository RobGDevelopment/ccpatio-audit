import { NextResponse } from "next/server";
import {
  EMBED_TOKEN_HEADER,
  getGhlEmbedSecret,
  verifyEmbedSessionToken,
} from "@/lib/embed-auth";
import { getPimSession } from "@/lib/pim-audit";
import { getKatanaInventorySnapshot } from "@/server/stock/katana-inventory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authorized(request: Request): Promise<boolean> {
  const session = await getPimSession();
  if (session) return true;
  const token =
    request.headers.get(EMBED_TOKEN_HEADER) ??
    new URL(request.url).searchParams.get("embedToken");
  return Boolean(await verifyEmbedSessionToken(token, getGhlEmbedSecret()));
}

export async function GET(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized embed session." }, { status: 401 });
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    const snapshot = await getKatanaInventorySnapshot({ force });
    return NextResponse.json({
      ok: true,
      rows: snapshot.rows,
      syncedAt: snapshot.syncedAt,
      stale: snapshot.stale,
      error: snapshot.error,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not read Katana inventory.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
