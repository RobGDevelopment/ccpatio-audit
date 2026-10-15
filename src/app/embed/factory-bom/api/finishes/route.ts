export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getPimSession } from "@/lib/pim-audit";
import { searchFinishes } from "@/server/factory-bom/intake/finishes";
import { toIntakeFailure } from "@/server/factory-bom/intake/errors";

const QuerySchema = z.object({
  kind: z.enum(["frame", "powder", "fabric"]),
  q: z.string().max(80).optional(),
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
  const parsed = QuerySchema.safeParse({
    kind: searchParams.get("kind"),
    q: searchParams.get("q") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const results = await searchFinishes(parsed.data.kind, parsed.data.q);
    return NextResponse.json(
      { ok: true, results },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=300",
          Vary: "Cookie",
        },
      }
    );
  } catch (err: unknown) {
    const failure = toIntakeFailure(err, "finishes_route", {
      actorEmail: session.email,
    });
    return NextResponse.json(failure, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
