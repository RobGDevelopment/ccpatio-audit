import { getPimSession } from "@/lib/pim-audit";
import { LiveStockView } from "@/app/showroom/stock/LiveStockView";

export const dynamic = "force-dynamic";

export default async function EmbedShowroomPage() {
  const session = await getPimSession();
  if (!session) {
    return (
      <main className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#FAFAFA] px-6 text-sm text-slate-700">
        Sign in to open live stock.
      </main>
    );
  }

  return (
    <div className="h-full min-h-0 flex-1 overflow-auto bg-[#FAFAFA] text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <LiveStockView defaultViewMode="grid" persistViewMode={false} />
      </div>
    </div>
  );
}
