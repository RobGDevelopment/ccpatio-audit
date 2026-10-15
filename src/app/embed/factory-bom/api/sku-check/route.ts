export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, like } from "drizzle-orm";
import { getPimSession } from "@/lib/pim-audit";
import { getDb } from "@/server/db/client";
import { sku_mappings } from "@/server/db/schema";
import { loadProjectStatus } from "@/server/factory-bom/intake/project-status";
import { deriveItemCode, nextVariantIndex, roundInchesForCode } from "@/lib/intake/naming";
import { previewSku } from "@/server/master-catalog/sku-preview";
import { toIntakeFailure } from "@/server/factory-bom/intake/errors";

const ClientQuerySchema = z.object({
  mode: z.literal("client"),
  opp: z.string().min(1),
  piece: z.string().min(1),
});

const CatalogQuerySchema = z.object({
  mode: z.literal("catalog"),
  col: z.string().min(1),
  colLabel: z.string().min(1),
  cat: z.string().min(1),
  catLabel: z.string().optional(),
  l: z.string().min(1),
  d: z.string().min(1),
  name: z.string().min(1),
});

const QuerySchema = z.discriminatedUnion("mode", [
  ClientQuerySchema,
  CatalogQuerySchema,
]);

export async function GET(request: Request) {
  const session = await getPimSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, code: "NOT_SIGNED_IN" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { searchParams } = new URL(request.url);
  const rawQuery = {
    mode: searchParams.get("mode"),
    opp: searchParams.get("opp") ?? undefined,
    piece: searchParams.get("piece") ?? undefined,
    col: searchParams.get("col") ?? undefined,
    colLabel: searchParams.get("colLabel") ?? undefined,
    cat: searchParams.get("cat") ?? undefined,
    catLabel: searchParams.get("catLabel") ?? undefined,
    l: searchParams.get("l") ?? undefined,
    d: searchParams.get("d") ?? undefined,
    name: searchParams.get("name") ?? undefined,
  };

  const parsed = QuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const db = getDb();

  try {
    if (parsed.data.mode === "client") {
      const project = await loadProjectStatus(parsed.data.opp);
      const itemCode = deriveItemCode(parsed.data.piece);

      let duplicate: { sku: string; pieceName: string } | undefined;
      let suggestedVariantSku: string | undefined;

      if (project.jobExists && project.clientCode) {
        const baseSku = `JOB-${project.clientCode}-${itemCode}`;
        const existingPieces = project.pieces.map((p) => p.name);
        const hasDuplicate = existingPieces.some(
          (name) => deriveItemCode(name) === itemCode
        );

        if (hasDuplicate) {
          duplicate = {
            sku: baseSku,
            pieceName: parsed.data.piece,
          };

          const existingRows = await db.query.sku_mappings.findMany({
            where: like(sku_mappings.global_sku, `${baseSku}%`),
          });
          const existingSkus = existingRows.map((r) => r.global_sku);
          const nextIdx = nextVariantIndex(existingSkus, baseSku);
          suggestedVariantSku = `${baseSku}-V${nextIdx}`;
        }
      }

      return NextResponse.json(
        {
          ok: true,
          project,
          itemCode,
          duplicate,
          suggestedVariantSku,
        },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    } else {
      const lengthRounded = roundInchesForCode(Number(parsed.data.l));
      const depthRounded = roundInchesForCode(Number(parsed.data.d));

      const preview = await previewSku(
        parsed.data.name,
        parsed.data.colLabel,
        parsed.data.cat,
        String(lengthRounded),
        String(depthRounded),
        null,
        "manufactured",
        undefined,
        parsed.data.col,
        parsed.data.catLabel
      );

      let suggestedVariantSku: string | undefined;
      if (preview.isCollision) {
        const existingRows = await db.query.sku_mappings.findMany({
          where: like(sku_mappings.global_sku, `${preview.sku}%`),
        });
        const existingSkus = existingRows.map((r) => r.global_sku);
        const nextIdx = nextVariantIndex(existingSkus, preview.sku);
        suggestedVariantSku = `${preview.sku}-V${nextIdx}`;
      }

      return NextResponse.json(
        {
          ok: true,
          sku: preview.sku,
          collision: preview.isCollision,
          suggestedVariantSku,
          existingProductName: preview.existingProductName,
        },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }
  } catch (err: unknown) {
    const failure = toIntakeFailure(err, "sku_check_route", {
      actorEmail: session.email,
    });
    return NextResponse.json(failure, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
