export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getPimSession } from "@/lib/pim-audit";
import { searchOpportunities } from "@/server/ghl/search-opportunities";
import { toIntakeFailure } from "@/server/factory-bom/intake/errors";

const QuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
});

export async function GET(request: Request) {
  const session = await getPimSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, code: "NOT_SIGNED_IN" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({ q: searchParams.get("q") ?? "" });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const results = await searchOpportunities(parsed.data.q);
    return NextResponse.json(
      { ok: true, results },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=30",
          Vary: "Cookie",
        },
      }
    );
  } catch (err: unknown) {
    const failure = toIntakeFailure(err, "opportunities_route", {
      actorEmail: session.email,
    });
    const status = failure.code === "UPSTREAM_BUSY" ? 503 : 500;
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (status === 503) {
      headers["Retry-After"] = "5";
    }
    return NextResponse.json(failure, { status, headers });
  }
}
