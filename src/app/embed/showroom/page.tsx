import { getPimSession } from "@/lib/pim-audit";
import { readActorFromSearchRecord } from "@/lib/embed-actor-params";
import { SalesStockView } from "@/app/showroom/stock/SalesStockView";
import { loadShowroomSalesInventory } from "@/server/showroom/stock";
import type { SalesStockCard } from "@/server/showroom/sales-projection";

export const dynamic = "force-dynamic";

export default async function EmbedShowroomPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getPimSession();
  if (!session) {
    return (
      <main className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#FAFAFA] px-6 text-sm text-slate-700">
        This embed link is missing a valid access key.
      </main>
    );
  }

  const actor = readActorFromSearchRecord(await searchParams);

  let initialCards: SalesStockCard[] = [];
  let initialSyncedAt: string | null = null;
  try {
    const snapshot = await loadShowroomSalesInventory({
      tab: "floor_ready",
      inStockOnly: true,
    });
    if (snapshot.ok) {
      initialCards = snapshot.cards;
      initialSyncedAt = snapshot.syncedAt;
    }
  } catch {
    // Client reload still available.
  }

  return (
    <div className="h-full min-h-0 flex-1 overflow-auto bg-[#FAFAFA] text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <SalesStockView
          initialCards={initialCards}
          initialSyncedAt={initialSyncedAt}
          ghlUserId={actor.ghlUserId}
          ghlUserEmail={actor.ghlUserEmail}
        />
      </div>
    </div>
  );
}
