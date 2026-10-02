import { DispatchPortal } from "@/components/dispatch/DispatchPortal";
import { getPimSession } from "@/lib/pim-audit";

export const dynamic = "force-dynamic";

export default async function EmbedDispatchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await searchParams;
  const session = await getPimSession();
  if (!session) {
    return (
      <main className="flex h-full min-h-0 flex-1 items-center justify-center bg-zinc-100 px-6">
        <p
          role="alert"
          data-testid="dispatch-unauthorized"
          className="max-w-md rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-medium text-rose-700 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
        >
          This embed link is missing a valid access key.
        </p>
      </main>
    );
  }

  return (
    <div className="h-full min-h-0 flex-1 overflow-auto bg-zinc-100 text-zinc-900">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <DispatchPortal />
      </div>
    </div>
  );
}
