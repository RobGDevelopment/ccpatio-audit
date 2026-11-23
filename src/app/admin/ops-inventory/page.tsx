import { LiveStockView } from "@/app/showroom/stock/LiveStockView";
import { loadOpsKatanaInventory } from "@/server/showroom/stock";
import type { StockRow } from "@/lib/stock-display";

export const dynamic = "force-dynamic";

/** Admin mirror of the raw Katana ops inventory dump. */
export default async function AdminOpsInventoryPage() {
  let initialRows: StockRow[] = [];
  let initialSyncedAt: string | null = null;
  try {
    const snapshot = await loadOpsKatanaInventory({ force: false });
    if (snapshot.ok) {
      initialRows = snapshot.rows;
      initialSyncedAt = snapshot.syncedAt;
    }
  } catch {
    // Client sync still available.
  }

  return (
    <main className="min-h-screen bg-[#FAFAFA] text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <LiveStockView
          defaultViewMode="grid"
          persistViewMode={false}
          inventoryMode="katana-ops"
          initialRows={initialRows}
          initialSyncedAt={initialSyncedAt}
        />
      </div>
    </main>
  );
}
