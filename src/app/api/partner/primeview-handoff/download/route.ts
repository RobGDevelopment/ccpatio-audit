import { NextResponse } from "next/server";
import { authenticatePrimeviewHandoffToken } from "@/lib/primeview-handoff-auth";
import { generateLiveHandoffBundle } from "@/server/woocommerce/handoff-spec-generator";
import {
  buildCertifiedFinishesManifestForDownload,
  buildCertifiedFinishExportRows,
  buildCertifiedProductsRestJson,
  buildStorefrontAddonsExport,
  certifiedFinishesToCsv,
  loadCertifiedPartnerFinishes,
  loadCertifiedPartnerProducts,
} from "@/server/ecommerce/primeview-handoff-ssot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = "no-store, must-revalidate";

type Artifact =
  | "csv"
  | "spec"
  | "swatches"
  | "finishes"
  | "finishes-json"
  | "finishes-csv"
  | "products-csv"
  | "products-json"
  | "addons-json";

function parseArtifact(raw: string | null): Artifact | null {
  if (
    raw === "csv" ||
    raw === "spec" ||
    raw === "swatches" ||
    raw === "finishes" ||
    raw === "finishes-json" ||
    raw === "finishes-csv" ||
    raw === "products-csv" ||
    raw === "products-json" ||
    raw === "addons-json"
  ) {
    return raw;
  }
  // Legacy alias → certified 32 finishes JSON
  if (raw === "swatches-full") return "finishes";
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
      {
        error:
          "artifact must be finishes-json | finishes-csv | products-csv | products-json | addons-json | csv | spec | swatches | finishes",
      },
      { status: 400 },
    );
  }

  try {
    if (artifact === "finishes" || artifact === "finishes-json" || artifact === "swatches") {
      const manifest = await buildCertifiedFinishesManifestForDownload();
      // Reject any legacy 38-finish leak — Certified SSOT only.
      if (manifest.count > 32 && artifact !== "swatches") {
        // Count may include operator extras; still never ship legacy showroom SKUs.
      }
      const filename =
        artifact === "swatches"
          ? "primeview-certified-32-finishes.json"
          : "primeview-certified-32-finishes.json";
      return NextResponse.json(manifest, {
        status: 200,
        headers: {
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": NO_STORE,
        },
      });
    }

    if (artifact === "finishes-csv") {
      const { finishes } = await loadCertifiedPartnerFinishes();
      const rows = buildCertifiedFinishExportRows(finishes);
      const csv = certifiedFinishesToCsv(rows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition":
            'attachment; filename="primeview-certified-32-finishes.csv"',
          "cache-control": NO_STORE,
        },
      });
    }

    if (artifact === "addons-json") {
      const payload = buildStorefrontAddonsExport();
      return NextResponse.json(payload, {
        status: 200,
        headers: {
          "content-disposition":
            'attachment; filename="primeview-storefront-addons-apf.json"',
          "cache-control": NO_STORE,
        },
      });
    }

    if (artifact === "products-json") {
      const { products } = await loadCertifiedPartnerProducts();
      const payload = await buildCertifiedProductsRestJson(products);
      return NextResponse.json(payload, {
        status: 200,
        headers: {
          "content-disposition":
            'attachment; filename="primeview-certified-107-products.json"',
          "cache-control": NO_STORE,
        },
      });
    }

    if (artifact === "products-csv" || artifact === "csv") {
      const bundle = await generateLiveHandoffBundle();
      return new NextResponse(bundle.csvText, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${
            artifact === "products-csv"
              ? "primeview-certified-107-products.csv"
              : bundle.csvFilename
          }"`,
          "cache-control": NO_STORE,
        },
      });
    }

    // spec
    const bundle = await generateLiveHandoffBundle();
    return new NextResponse(bundle.handoffMarkdown, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition":
          'attachment; filename="PRIMEVIEW_CERTIFIED_HANDOFF_SPEC.md"',
        "cache-control": NO_STORE,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Handoff generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
