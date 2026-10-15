import { getPimSession } from "@/lib/pim-audit";
import { canvas } from "@/app/admin/factory-bom/factory-bom-ui";
import { loadIntakeSubject } from "@/server/factory-bom/intake/load-subject";
import { loadIntakeSnapshot } from "@/server/factory-bom/load-airlock-snapshot";
import { loadIntakeTaxonomy } from "@/server/factory-bom/intake/taxonomy";
import { loadChildMeta } from "@/server/factory-bom/intake/child-meta";
import { IntakeWizard } from "./intake/IntakeWizard";
import { DesignWizard } from "./DesignWizard";

export const dynamic = "force-dynamic";

export default async function EmbedFactoryBomPage({
  searchParams,
}: {
  searchParams: Promise<{
    sku?: string;
    opportunityId?: string;
    ghlUserEmail?: string;
  }>;
}) {
  const session = await getPimSession();
  const params = await searchParams;

  if (!session) {
    return (
      <main
        className={`flex h-full min-h-0 flex-1 items-center justify-center px-6 text-sm text-zinc-500 ${canvas}`}
      >
        This embed link is missing a valid access key.
      </main>
    );
  }

  const initialSku = params.sku?.trim().toUpperCase() || undefined;
  const opportunityId = params.opportunityId?.trim() || undefined;
  const reportedUserEmail = params.ghlUserEmail?.trim().toLowerCase() || undefined;

  // If no piece is selected, render the 3-step IntakeWizard
  if (!initialSku) {
    const taxonomy = await loadIntakeTaxonomy();
    return (
      <main
        className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden font-sans ${canvas}`}
      >
        <IntakeWizard
          collections={taxonomy.collections}
          categories={taxonomy.categories}
          reportedUserEmail={reportedUserEmail}
          initialOpportunityId={opportunityId}
        />
      </main>
    );
  }

  // A piece is selected: load subject, snapshot, and targeted child metadata
  const subject = await loadIntakeSubject(initialSku);
  const snapshot = await loadIntakeSnapshot(initialSku);

  const allSkus = Array.from(
    new Set([
      snapshot.rootSku,
      ...snapshot.lines.map((l) => l.child_sku),
      ...snapshot.lines.map((l) => l.parent_sku),
    ])
  );
  const products = await loadChildMeta(allSkus);

  return (
    <main
      className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden font-sans ${canvas}`}
    >
      <DesignWizard
        subject={subject}
        snapshot={snapshot}
        products={products}
        reportedUserEmail={reportedUserEmail}
        opportunityId={opportunityId}
      />
    </main>
  );
}
