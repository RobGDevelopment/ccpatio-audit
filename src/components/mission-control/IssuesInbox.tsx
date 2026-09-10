"use client";

import { useState } from "react";
import { retryJobAction } from "@/app/mission-control/actions";

type InngestJob = {
  run_id: string;
  function_id: string;
  status: string;
  started_at: string;
  error?: {
    name: string;
    message: string;
  };
  event?: {
    name: string;
    data: any;
  };
};

export function IssuesInbox({ initialJobs }: { initialJobs: InngestJob[] }) {
  const [jobs, setJobs] = useState<InngestJob[]>(initialJobs);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleRetry(runId: string) {
    setRetryingId(runId);
    setMessage(null);
    const res = await retryJobAction(runId);
    
    if (res.ok) {
      setMessage({ type: "success", text: "Retry queued successfully." });
      setJobs((prev) => prev.filter((j) => j.run_id !== runId));
    } else {
      setMessage({ type: "error", text: res.error || "Failed to retry job." });
    }
    
    setRetryingId(null);
  }

  // Translates complex function IDs or errors into plain English
  function translateSystem(functionId: string) {
    if (functionId.includes("publish-approved-product")) return "Global Publish";
    if (functionId.includes("archive-katana-variant")) return "Katana (Archive)";
    return functionId;
  }

  function translateError(errorMsg?: string) {
    if (!errorMsg) return "Unknown system error";
    if (errorMsg.includes("401") || errorMsg.includes("403")) return "Access denied (Check Password)";
    if (errorMsg.includes("timeout")) return "System timed out during sync";
    return errorMsg;
  }

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-6">
      <h2 className="text-lg font-semibold text-zinc-100">Active Issues Inbox</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Review and retry failed background synchronization tasks.
      </p>

      {message && (
        <div className={`mt-4 rounded-md px-4 py-3 text-sm ${message.type === "success" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/10 text-rose-400 border border-rose-500/30"}`}>
          {message.text}
        </div>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm text-zinc-400">
          <thead className="border-b border-zinc-800/80 text-xs font-medium uppercase text-zinc-500">
            <tr>
              <th className="pb-3 pr-4 font-medium">Date</th>
              <th className="pb-3 pr-4 font-medium">Product / Target</th>
              <th className="pb-3 pr-4 font-medium">Affected System</th>
              <th className="pb-3 pr-4 font-medium">Reason</th>
              <th className="pb-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-zinc-500">
                  No active issues. Everything is running smoothly.
                </td>
              </tr>
            ) : (
              jobs.map((job) => (
                <tr key={job.run_id} className="hover:bg-zinc-900/30 transition-colors">
                  <td className="py-4 pr-4 whitespace-nowrap">
                    {new Date(job.started_at).toLocaleString()}
                  </td>
                  <td className="py-4 pr-4">
                    {job.event?.data?.global_sku || "Multiple / System"}
                  </td>
                  <td className="py-4 pr-4 font-medium text-zinc-300">
                    {translateSystem(job.function_id)}
                  </td>
                  <td className="py-4 pr-4 text-rose-400 max-w-xs truncate" title={job.error?.message}>
                    {translateError(job.error?.message)}
                  </td>
                  <td className="py-4 text-right">
                    <button
                      onClick={() => handleRetry(job.run_id)}
                      disabled={retryingId === job.run_id}
                      className="rounded bg-emerald-600/20 px-3 py-1.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-600/30 disabled:opacity-50"
                    >
                      {retryingId === job.run_id ? "Retrying..." : "Retry"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
