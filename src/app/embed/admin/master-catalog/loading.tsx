export default function MasterCatalogLoading() {
  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center bg-[#0b0f17] text-slate-400"
      data-testid="master-catalog-loading"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-400/30 border-t-amber-400" />
        <p className="text-sm">Loading E-Commerce Portal…</p>
      </div>
    </div>
  );
}
