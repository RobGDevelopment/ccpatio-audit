import Link from "next/link";
import { redirect } from "next/navigation";
import { LandingRegisterForm } from "./LandingRegisterForm";
import { getPimSession } from "@/lib/pim-audit";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const nextPath =
    params.next?.startsWith("/admin") && !params.next.includes("//")
      ? params.next
      : "/admin/dictionary";

  const session = await getPimSession();
  if (session) {
    redirect(nextPath);
  }

  return (
    <main className="pim-carbon-shell min-h-screen text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-10 sm:px-6 lg:flex-row lg:items-center lg:gap-16 lg:py-16">
        <section className="flex-1 space-y-6">
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">
            CC Patio · Enterprise PIM
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-50 sm:text-5xl">
            Global E2E SKU Dictionary
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-slate-400">
            The live spreadsheet your team uses to complete product data before
            it flows to Katana, WooCommerce, GHL, and QuickBooks. Edit inline —
            changes autosave to Postgres and sync across open browsers.
          </p>
          <ul className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
            <li className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-4 py-3">
              <span className="font-medium text-emerald-300">Finished Goods</span>
              <p className="mt-1 text-slate-400">
                MSRP, dimensions, integrations, and multi-level BOM.
              </p>
            </li>
            <li className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-4 py-3">
              <span className="font-medium text-emerald-300">Raw Materials</span>
              <p className="mt-1 text-slate-400">
                Category attributes for metal, fabric, powder, and more.
              </p>
            </li>
            <li className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-4 py-3">
              <span className="font-medium text-emerald-300">Health checks</span>
              <p className="mt-1 text-slate-400">
                Red alerts show missing integration fields — not images.
              </p>
            </li>
            <li className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-4 py-3">
              <span className="font-medium text-emerald-300">Audit trail</span>
              <p className="mt-1 text-slate-400">
                Every save is logged with your @ccpatio.com identity.
              </p>
            </li>
          </ul>
        </section>

        <section className="mt-10 w-full max-w-md shrink-0 lg:mt-0">
          <div className="pim-glass rounded-xl p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-slate-100">
              Team access
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Register with your CC Patio email to open the dictionary and
              begin data completion.
            </p>
            <div className="mt-6">
              <LandingRegisterForm nextPath={nextPath} />
            </div>
            <p className="mt-6 text-center text-xs text-slate-600">
              <Link href="/api/health" className="hover:text-slate-400">
                System health
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
