"use client";

import { useEffect, useState } from "react";
import {
  getIssuesInboxAction,
  retryInboxRunAction,
} from "@/app/mission-control/inbox-action";
import type { InboxIssue } from "@/server/mission-control/issue-copy";

function formatWhen(value: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

export function IssuesInbox({ initialJobs }: { initialJobs?: readonly unknown[] }) {
  void initialJobs;

  const [issues, setIssues] = useState<InboxIssue[] | null>(null);
  const [seenIds, setSeenIds] = useState<string[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadInbox() {
    setLoading(true);
    const result = await getIssuesInboxAction();
    if (result.ok) {
      setIssues(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadInbox();
  }, []);

  async function handleRetry(row: InboxIssue) {
    if (!row.runId) return;
    setRetryingId(row.id);
    setNotice(null);
    const result = await retryInboxRunAction(row.runId);
    if (result.ok) {
      setNotice("Retry queued.");
      setIssues((current) => (current ?? []).filter((item) => item.id !== row.id));
    } else {
      setError(result.error);
    }
    setRetryingId(null);
  }

  function markSeen(id: string) {
    setSeenIds((current) => (current.includes(id) ? current : [...current, id]));
  }

  const visible = (issues ?? []).filter((row) => !seenIds.includes(row.id));

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-6">
      <h2 className="text-lg font-semibold text-zinc-100">Active Issues Inbox</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Failed catalog syncs, publish runs, and showroom holds. Marking a row seen hides it on this screen only.
      </p>

      {notice && (
        <p className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          {notice}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          {error}
        </p>
      )}

      {loading && !issues ? (
        <p className="mt-6 text-sm text-zinc-400">Loading failed syncs.</p>
      ) : visible.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-400">No failed syncs are waiting.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-400">
            <thead className="border-b border-zinc-800/80 text-xs font-medium uppercase text-zinc-500">
              <tr>
                <th className="pb-3 pr-4 font-medium">When</th>
                <th className="pb-3 pr-4 font-medium">Issue</th>
                <th className="pb-3 pr-4 font-medium">Spoke</th>
                <th className="pb-3 pr-4 font-medium">SKU</th>
                <th className="pb-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {visible.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-zinc-900/30">
                  <td className="whitespace-nowrap py-4 pr-4">{formatWhen(row.at)}</td>
                  <td className="py-4 pr-4">
                    <div className="font-medium text-zinc-200">{row.title}</div>
                    <div className="mt-1 max-w-xs text-rose-400">{row.summary}</div>
                  </td>
                  <td className="py-4 pr-4 font-medium text-zinc-300">{row.spoke}</td>
                  <td className="py-4 pr-4">{row.sku ?? "—"}</td>
                  <td className="py-4 text-right">
                    {row.runId ? (
                      <button
                        type="button"
                        onClick={() => void handleRetry(row)}
                        disabled={retryingId === row.id}
                        className="rounded bg-emerald-600/20 px-3 py-1.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-600/30 disabled:opacity-50"
                      >
                        {retryingId === row.id ? "Retrying..." : "Retry"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => markSeen(row.id)}
                        className="rounded bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700"
                      >
                        Mark seen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
