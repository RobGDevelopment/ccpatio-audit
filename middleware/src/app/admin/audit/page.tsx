import Link from "next/link";
import { fetchRecentAuditLog } from "@/lib/pim-audit";
import { getPimSession } from "@/lib/pim-audit";
import { LogoutButton } from "../LogoutButton";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const session = await getPimSession();
  const rows = await fetchRecentAuditLog(300);

  return (
    <main className="pim-carbon-shell min-h-screen text-slate-50">
      <div className="w-full px-2 py-4 sm:px-3">
        <header className="pim-glass mb-4 flex flex-wrap items-center justify-between gap-4 rounded-lg px-4 py-4 sm:px-5">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">
              CC Patio · PIM Audit
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Change log
            </h1>
            {session ? (
              <p className="mt-1 text-sm text-slate-400">
                Signed in as{" "}
                <span className="font-mono text-emerald-300">{session.email}</span>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/admin/dictionary"
              className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
            >
              ← Dictionary
            </Link>
            <LogoutButton />
          </div>
        </header>

        <div className="pim-glass overflow-hidden rounded-lg">
          <div className="max-h-[min(80vh,56rem)] overflow-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 border-b border-slate-800/80 bg-slate-950/95 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-3 font-medium">When</th>
                  <th className="px-3 py-3 font-medium">Operator</th>
                  <th className="px-3 py-3 font-medium">SKU</th>
                  <th className="px-3 py-3 font-medium">Action</th>
                  <th className="px-3 py-3 font-medium">Field</th>
                  <th className="px-3 py-3 font-medium">New value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/70">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-slate-500"
                    >
                      No audit entries yet. Edits in the dictionary will appear
                      here.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-900/30">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-300">
                        {row.operatorEmail}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {row.globalSku ? (
                          <Link
                            href={`/admin/dictionary?sku=${encodeURIComponent(row.globalSku)}`}
                            className="text-emerald-400 hover:text-emerald-300"
                          >
                            {row.globalSku}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-300">
                        {row.action}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-400">
                        {row.field ?? "—"}
                      </td>
                      <td className="max-w-[16rem] truncate px-3 py-2 text-xs text-slate-400">
                        {row.newValue ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
