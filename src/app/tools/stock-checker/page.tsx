import { stockCheckerAuthorized, stockCheckerConfigured } from "@/lib/stock-checker-token";
import type { StockRow } from "@/lib/stock-display";
import { searchKatanaStock } from "@/server/stock/search-katana-stock";
import { StockChecker } from "./StockChecker";

export const dynamic = "force-dynamic";

export default async function StockCheckerPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; q?: string }>;
}) {
  const params = await searchParams;
  const token = params.token ?? "";
  const query = params.q?.trim() ?? "";

  if (!stockCheckerConfigured()) {
    return (
      <main className="min-h-screen bg-white px-3 py-6 text-sm text-zinc-700">
        Stock checker is not configured.
      </main>
    );
  }

  if (!stockCheckerAuthorized(token)) {
    return (
      <main className="min-h-screen bg-white px-3 py-6 text-sm text-zinc-700">
        This link is not authorized.
      </main>
    );
  }

  let rows: StockRow[] = [];
  let initialError: string | null = null;
  if (query) {
    try {
      const result = await searchKatanaStock({ query });
      if (result.ok) rows = result.rows;
      else initialError = result.error;
    } catch {
      initialError = "Inventory lookup failed.";
    }
  }

  return (
    <main className="min-h-screen bg-white">
      <StockChecker
        token={token}
        initialQuery={query}
        initialRows={rows}
        initialError={initialError}
      />
    </main>
  );
}
