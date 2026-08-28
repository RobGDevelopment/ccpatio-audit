import { getPimSession } from "@/lib/pim-audit";
import { fetchAllRawMaterials } from "./actions";
import { RawMaterialsPageClient } from "./RawMaterialsPageClient";

export const dynamic = "force-dynamic";

export default async function RawMaterialsPage() {
  const session = await getPimSession();
  const rows = await fetchAllRawMaterials();

  return (
    <main className="pim-carbon-shell min-h-screen text-slate-50">
      <RawMaterialsPageClient
        rows={rows}
        operatorEmail={session?.email ?? null}
      />
    </main>
  );
}
