"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  overrideDesignAction,
  retryReleaseAction,
  resyncGhlAction,
} from "./actions";

export type PathARowItem = {
  id: string;
  global_sku: string;
  quantity: string | number;
  status: string;
  finalized_dossier_hash: string | null;
  finalized_by: string | null;
  katana_sales_order_row_id: number | null;
  katana_mo_id: number | null;
};

export type PathADashboardRow = {
  opportunityId: string;
  opportunityName: string | null;
  customerLabel: string | null;
  saga: {
    status: string;
    current_step: string | null;
    created_at: string;
    updated_at: string;
    release_requested_at: string | null;
    release_requested_by: string | null;
    release_requested_source: string | null;
    release_requested_reason: string | null;
    deposit_amount_cents: number | null;
    deposit_ref: string | null;
    last_error: string | null;
  };
  job: {
    id: string;
    katana_sales_order_id: string | null;
    katana_order_no: string | null;
    katana_mo_ids: number[] | null;
    ghl_sync_hash: string | null;
    ghl_synced_at: string | null;
  };
  items: PathARowItem[];
};

export function PathAStatusTable({
  rows,
  canOverride,
}: {
  rows: PathADashboardRow[];
  canOverride: boolean;
}) {
  const router = useRouter();
  const [selectedOpp, setSelectedOpp] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // 15-second document-visibility polling
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [router]);

  const handleOverrideSubmit = async () => {
    if (!selectedOpp) return;
    if (overrideReason.trim().length < 10 || overrideReason.trim().length > 500) {
      setActionError("Reason must be between 10 and 500 characters.");
      return;
    }

    setLoadingAction(`override-${selectedOpp}`);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await overrideDesignAction({
        ghlOpportunityId: selectedOpp,
        reason: overrideReason.trim(),
      });
      if (res.ok) {
        setActionSuccess("Override recorded and release event dispatched.");
        setSelectedOpp(null);
        setOverrideReason("");
        router.refresh();
      } else {
        setActionError(res.error || "Override request failed.");
      }
    } catch (err: any) {
      setActionError(err?.message || "An unexpected error occurred.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRetry = async (oppId: string) => {
    setLoadingAction(`retry-${oppId}`);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await retryReleaseAction({ ghlOpportunityId: oppId });
      if (res.ok) {
        setActionSuccess(`Release retry attempt #${res.attempt} dispatched.`);
        router.refresh();
      } else {
        setActionError(res.error || "Retry release failed.");
      }
    } catch (err: any) {
      setActionError(err?.message || "An unexpected error occurred.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleResyncGhl = async (oppId: string) => {
    setLoadingAction(`resync-${oppId}`);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await resyncGhlAction({ ghlOpportunityId: oppId });
      if (res.ok) {
        setActionSuccess("GHL sync requested.");
        router.refresh();
      } else {
        setActionError(res.error || "GHL sync request failed.");
      }
    } catch (err: any) {
      setActionError(err?.message || "An unexpected error occurred.");
    } finally {
      setLoadingAction(null);
    }
  };

  const formatAge = (createdAt: string, updatedAt: string, status: string) => {
    const timestamp = status === "AWAITING_DEPOSIT" ? updatedAt : createdAt;
    const diff = Math.max(0, Date.now() - new Date(timestamp).getTime());
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    if (status === "AWAITING_DEPOSIT") {
      return `awaiting deposit for ${days}d ${hours}h`;
    }
    return `${days}d ${hours}h ago`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "AWAITING_DEPOSIT":
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">AWAITING DEPOSIT</span>;
      case "COMPLETED":
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">RELEASED</span>;
      case "IN_PROGRESS":
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">RELEASING</span>;
      case "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION":
      case "FAILED":
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">MANUAL FAIL</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">DESIGNING</span>;
    }
  };

  return (
    <div className="space-y-4">
      {actionSuccess && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded text-sm flex justify-between">
          <span>{actionSuccess}</span>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-400 font-bold ml-2">&times;</button>
        </div>
      )}
      {actionError && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded text-sm flex justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-rose-400 font-bold ml-2">&times;</button>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 text-xs uppercase tracking-wider">
              <th className="py-3 px-4">Opportunity / Customer</th>
              <th className="py-3 px-4">Status & Step</th>
              <th className="py-3 px-4">Age</th>
              <th className="py-3 px-4">Release Request</th>
              <th className="py-3 px-4">Katana Orders</th>
              <th className="py-3 px-4">GHL Sync</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500">
                  No Path A custom build sagas found.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isManualFailed =
                  (row.saga.status === "FAILED" ||
                    row.saga.status === "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION") &&
                  ((row.saga.current_step?.startsWith("manual:") ||
                    row.saga.current_step?.startsWith("release_failed:")) ??
                    false);
                const canRetry = canOverride && isManualFailed && Boolean(row.saga.release_requested_at);
                const canOverrideNow =
                  canOverride &&
                  row.saga.status === "AWAITING_DEPOSIT" &&
                  !row.saga.release_requested_at;

                return (
                  <React.Fragment key={row.opportunityId}>
                    <tr className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-200">
                          {row.opportunityName || row.opportunityId}
                        </div>
                        <div className="text-xs text-slate-400">
                          {row.customerLabel || "No customer contact"}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2 mb-1">
                          {getStatusBadge(row.saga.status)}
                        </div>
                        <div className="text-xs text-slate-400 font-mono">
                          {row.saga.current_step || "—"}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-300">
                        {formatAge(row.saga.created_at, row.saga.updated_at, row.saga.status)}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {row.saga.release_requested_at ? (
                          <div>
                            <span className="font-semibold text-slate-200">
                              {row.saga.release_requested_source === "management_override"
                                ? "Override"
                                : "Deposit"}
                            </span>{" "}
                            by {row.saga.release_requested_by || "system"}
                            {row.saga.deposit_amount_cents != null && (
                              <div className="text-slate-400">
                                ${(row.saga.deposit_amount_cents / 100).toFixed(2)} (Ref: {row.saga.deposit_ref || "—"})
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-500">None</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {row.job.katana_order_no ? (
                          <div>
                            <div className="font-mono text-slate-200 font-medium">
                              {row.job.katana_order_no}
                            </div>
                            <div className="text-slate-400">
                              MOs: {row.job.katana_mo_ids?.join(", ") || "None"}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {row.job.ghl_synced_at ? (
                          <span className="text-emerald-400">
                            Synced {new Date(row.job.ghl_synced_at).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-slate-500">Not synced</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          {canOverrideNow && (
                            <button
                              id={`override-btn-${row.opportunityId}`}
                              onClick={() => {
                                setSelectedOpp(row.opportunityId);
                                setOverrideReason("");
                                setActionError(null);
                              }}
                              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-medium transition"
                            >
                              Override
                            </button>
                          )}
                          {canRetry && (
                            <button
                              id={`retry-btn-${row.opportunityId}`}
                              disabled={loadingAction === `retry-${row.opportunityId}`}
                              onClick={() => handleRetry(row.opportunityId)}
                              className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-medium transition disabled:opacity-50"
                            >
                              Retry
                            </button>
                          )}
                          {canOverride && (
                            <button
                              id={`resync-btn-${row.opportunityId}`}
                              disabled={loadingAction === `resync-${row.opportunityId}`}
                              onClick={() => handleResyncGhl(row.opportunityId)}
                              className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-xs font-medium transition disabled:opacity-50"
                            >
                              Re-sync GHL
                            </button>
                          )}
                          {!canOverride && (
                            <span className="text-xs text-slate-500 italic">
                              Awaiting deposit
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Nested SKUs Row */}
                    <tr className="bg-slate-950/40 text-xs">
                      <td colSpan={7} className="py-2 px-6">
                        <div className="flex flex-wrap gap-4 text-slate-400">
                          <span className="font-semibold text-slate-300">Custom SKUs:</span>
                          {row.items.map((item) => (
                            <div key={item.id} className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                              <span className="font-mono text-slate-200 font-medium">{item.global_sku}</span>
                              <span className="text-slate-500">x{item.quantity}</span>
                              <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-300 font-semibold">{item.status}</span>
                              {item.finalized_dossier_hash && (
                                <span className="font-mono text-slate-500 text-[10px]" title={item.finalized_dossier_hash}>
                                  [{item.finalized_dossier_hash.slice(0, 8)}]
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                        {row.saga.last_error && (
                          <div className="mt-1 text-rose-400 font-mono text-[11px]">
                            Last Error: {row.saga.last_error}
                          </div>
                        )}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Confirmation Dialog for Override */}
      {selectedOpp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-100">
              Management Override (Release to Katana)
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              This will bypass the customer deposit gate and release the custom order for opportunity{" "}
              <span className="font-mono text-amber-300">{selectedOpp}</span> into Katana production.
              An audit log entry will be permanently recorded.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Reason for Override (10 to 500 characters, required):
              </label>
              <textarea
                id="override-reason-textarea"
                rows={4}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Explain the business reason for releasing without deposit..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
              <div className="text-right text-[11px] text-slate-500 mt-1">
                {overrideReason.trim().length} / 500
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedOpp(null);
                  setOverrideReason("");
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                id="confirm-override-btn"
                type="button"
                disabled={
                  loadingAction !== null ||
                  overrideReason.trim().length < 10 ||
                  overrideReason.trim().length > 500
                }
                onClick={handleOverrideSubmit}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
              >
                {loadingAction ? "Releasing..." : "Confirm & Release"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
