import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  saga_runs,
  custom_build_jobs,
  custom_build_job_items,
  order_intake,
} from "@/server/db/schema";
import { getPimSession } from "@/lib/pim-audit";
import { hasOverrideAuthority } from "@/server/path-a/authz";
import { PathAStatusTable, type PathADashboardRow } from "./PathAStatusTable";

export const dynamic = "force-dynamic";

export default async function PathADashboardPage() {
  const session = await getPimSession();

  if (!session) {
    return (
      <main className="pim-carbon-shell min-h-screen text-zinc-50 flex items-center justify-center p-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 max-w-md w-full text-center shadow-2xl">
          <h1 className="text-xl font-bold text-slate-100 mb-2">Authentication Required</h1>
          <p className="text-sm text-slate-400 mb-6">
            Please log in to CC Patio PIM to access the Path A CAD / Katana release dashboard.
          </p>
          <Link
            href="/"
            className="inline-block px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition"
          >
            ← Back to Launchpad
          </Link>
        </div>
      </main>
    );
  }

  const canOverride = hasOverrideAuthority(session);

  let migrationPending = false;
  let rows: PathADashboardRow[] = [];

  try {
    const db = getDb();

    // Query path_a_cad sagas, newest first
    const sagas = await db
      .select()
      .from(saga_runs)
      .where(eq(saga_runs.saga_type, "path_a_cad"))
      .orderBy(desc(saga_runs.created_at));

    if (sagas.length > 0) {
      const oppIds = sagas.map((s) => s.correlation_key);

      const jobs = await db
        .select()
        .from(custom_build_jobs)
        .where(inArray(custom_build_jobs.ghl_opportunity_id, oppIds));

      const jobMap = new Map(jobs.map((j) => [j.ghl_opportunity_id, j]));

      const jobIds = jobs.map((j) => j.id);
      let itemsByJobId = new Map<string, Array<typeof custom_build_job_items.$inferSelect>>();

      if (jobIds.length > 0) {
        const items = await db
          .select()
          .from(custom_build_job_items)
          .where(inArray(custom_build_job_items.job_id, jobIds))
          .orderBy(custom_build_job_items.global_sku);

        for (const item of items) {
          const list = itemsByJobId.get(item.job_id) || [];
          list.push(item);
          itemsByJobId.set(item.job_id, list);
        }
      }

      const intakes = await db
        .select({
          ghl_opportunity_id: order_intake.ghl_opportunity_id,
          contact_name: order_intake.contact_name,
          contact_email: order_intake.contact_email,
        })
        .from(order_intake)
        .where(inArray(order_intake.ghl_opportunity_id, oppIds));

      const intakeMap = new Map(intakes.map((i) => [i.ghl_opportunity_id, i]));

      rows = sagas.map((saga) => {
        const oppId = saga.correlation_key;
        const job = jobMap.get(oppId);
        const childItems = job ? itemsByJobId.get(job.id) || [] : [];
        const intake = intakeMap.get(oppId);

        const customerLabel = intake?.contact_name
          ? `${intake.contact_name}${intake.contact_email ? ` (${intake.contact_email})` : ""}`
          : null;

        return {
          opportunityId: oppId,
          opportunityName: null,
          customerLabel,
          saga: {
            status: saga.status,
            current_step: saga.current_step,
            created_at: saga.created_at.toISOString(),
            updated_at: saga.updated_at.toISOString(),
            release_requested_at: saga.release_requested_at
              ? saga.release_requested_at.toISOString()
              : null,
            release_requested_by: saga.release_requested_by,
            release_requested_source: saga.release_source,
            release_requested_reason: saga.release_reason,
            deposit_amount_cents: saga.deposit_cents,
            deposit_ref: saga.deposit_ref,
            last_error: saga.last_error,
          },
          job: {
            id: job?.id || "",
            katana_sales_order_id: job?.katana_sales_order_id
              ? String(job.katana_sales_order_id)
              : null,
            katana_order_no: job?.katana_order_no || null,
            katana_mo_ids: (job?.katana_mo_ids as number[] | null) || null,
            ghl_sync_hash: job?.ghl_sync_hash || null,
            ghl_synced_at: job?.ghl_synced_at ? job.ghl_synced_at.toISOString() : null,
          },
          items: childItems.map((item) => ({
            id: item.id,
            global_sku: item.global_sku,
            quantity: item.quantity,
            status: item.design_status,
            finalized_dossier_hash: item.finalized_dossier_hash,
            finalized_by: item.finalized_by,
            katana_sales_order_row_id: item.katana_sales_order_row_id,
            katana_mo_id: item.katana_mo_id,
          })),
        };
      });
    }
  } catch (err: any) {
    const code = err?.code;
    const msg = String(err?.message || "");
    if (
      code === "42P01" ||
      code === "42703" ||
      msg.includes("42P01") ||
      msg.includes("42703") ||
      msg.includes("does not exist") ||
      msg.includes("undefined_table") ||
      msg.includes("undefined_column")
    ) {
      migrationPending = true;
      rows = [];
    } else {
      throw err;
    }
  }

  return (
    <main className="pim-carbon-shell min-h-screen text-zinc-50">
      <div className="w-full px-4 py-6 sm:px-6 max-w-7xl mx-auto">
        <header className="pim-glass mb-6 rounded-xl p-6 border border-slate-800 bg-slate-900/60 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-400">
              CC Patio · Path A Custom Builds
            </p>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-zinc-500">
                Signed in as <span className="font-mono text-emerald-300">{session.email}</span>
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                  canOverride
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : "bg-slate-800 text-slate-400 border border-slate-700"
                }`}
              >
                {canOverride ? "Override Authority" : "Read-Only Viewer"}
              </span>
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
            Path A CAD &amp; Katana Release Dashboard
          </h1>
          <p className="mt-2 text-sm text-zinc-400 max-w-3xl leading-relaxed">
            Stateless tracking of custom build opportunities from async CAD conversion through design
            finalization, pre-Katana deposit pause, and multi-SKU production release. Unpaid orders
            never enter Katana.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
            <Link
              href="/"
              className="text-emerald-400/90 transition hover:text-emerald-300 flex items-center gap-1"
            >
              ← Back to Launchpad
            </Link>
          </div>
        </header>

        {migrationPending && (
          <div
            id="migration-pending-banner"
            className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 shadow-lg"
          >
            <div className="flex items-center gap-2 font-semibold">
              <span className="text-amber-400">⚠️</span>
              <span>Migration 0055 pending</span>
            </div>
            <p className="mt-1 text-xs text-amber-300/80 leading-relaxed">
              The database schema for Path A stateless release (migration 0055) has not been applied to
              the live database host. Custom SKU Katana write fences remain fail-closed and action
              buttons are disabled.
            </p>
          </div>
        )}

        <PathAStatusTable
          rows={rows}
          canOverride={migrationPending ? false : canOverride}
        />
      </div>
    </main>
  );
}
