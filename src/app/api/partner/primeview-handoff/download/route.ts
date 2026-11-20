import { NextResponse } from "next/server";
import {
  authenticatePrimeviewHandoffToken,
} from "@/lib/primeview-handoff-auth";
import { generateLiveHandoffBundle } from "@/server/woocommerce/handoff-spec-generator";
import { buildFullFinishesManifest } from "@/server/assets/finish-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Artifact = "csv" | "spec" | "swatches" | "finishes";

function parseArtifact(raw: string | null): Artifact | null {
  if (raw === "csv" || raw === "spec" || raw === "swatches") return raw;
  // `swatches-full` is an accepted alias of `finishes` (FAB + PWD + DEC manifest).
  if (raw === "finishes" || raw === "swatches-full") return "finishes";
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const auth = authenticatePrimeviewHandoffToken(url.searchParams.get("token"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const artifact = parseArtifact(url.searchParams.get("artifact"));
  if (!artifact) {
    return NextResponse.json(
      { error: "artifact must be csv | spec | swatches | finishes" },
      { status: 400 },
    );
  }

  try {
    if (artifact === "finishes") {
      // Full FAB + PWD + DEC manifest straight from ecommerce_finish_assets (no handoff bundle needed).
      const manifest = await buildFullFinishesManifest();
      return NextResponse.json(
        {
          generatedAtUtc: new Date().toISOString(),
          counts: {
            fabrics: manifest.fabrics.length,
            powders: manifest.powders.length,
            dektons: manifest.dektons.length,
          },
          ...manifest,
        },
        {
          status: 200,
          headers: {
            "content-disposition":
              'attachment; filename="primeview-phase1-finishes-and-swatches.json"',
            "cache-control": "no-store",
          },
        },
      );
    }

    const bundle = await generateLiveHandoffBundle();

    if (artifact === "csv") {
      return new NextResponse(bundle.csvText, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${bundle.csvFilename}"`,
          "cache-control": "no-store",
        },
      });
    }

    if (artifact === "spec") {
      return new NextResponse(bundle.handoffMarkdown, {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition":
            'attachment; filename="PRIMEVIEW_PHASE1_HANDOFF_SPEC.md"',
          "cache-control": "no-store",
        },
      });
    }

    return NextResponse.json(
      {
        generatedAtUtc: bundle.generatedAtUtc,
        count: bundle.swatchesManifest.length,
        swatches: bundle.swatchesManifest,
      },
      {
        status: 200,
        headers: {
          "content-disposition":
            'attachment; filename="primeview-phase1-fabric-swatches.json"',
          "cache-control": "no-store",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Handoff generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
