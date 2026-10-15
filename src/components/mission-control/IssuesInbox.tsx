"use client";

import { useEffect, useState } from "react";
import {
  getIssuesInboxAction,
  retryInboxRunAction,
} from "@/app/mission-control/inbox-action";
import { GoldBeam } from "@/components/ui/GoldBeam";
import type { InboxIssue } from "@/server/mission-control/issue-copy";
import { btnQuiet, card, eyebrow, heading, muted, noticeError, noticeSuccess } from "./soft-ui";

function formatWhen(value: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

export function IssuesInbox() {
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
    <div className={card} data-testid="issues-inbox">
      <GoldBeam active={loading} />
      <div className={eyebrow}>Needs a human</div>
      <h2 className={heading}>Active Issues Inbox</h2>
      <p className={`mt-1 ${muted}`}>
        Failed catalog syncs, publish runs, and showroom holds. Marking a row seen hides it on this screen only.
      </p>

      {notice && (
        <p className={`mt-4 ${noticeSuccess}`}>
          {notice}
        </p>
      )}

      {error && (
        <p className={`mt-4 ${noticeError}`}>
          {error}
        </p>
      )}

      {loading && !issues ? (
        <p className="mt-6 text-sm text-slate-500">Loading failed syncs.</p>
      ) : visible.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No failed syncs are waiting.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="border-b border-slate-100 text-xs font-medium uppercase tracking-wider text-slate-400">
              <tr>
                <th className="pb-3 pr-4 font-medium">When</th>
                <th className="pb-3 pr-4 font-medium">Issue</th>
                <th className="pb-3 pr-4 font-medium">Spoke</th>
                <th className="pb-3 pr-4 font-medium">SKU</th>
                <th className="pb-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-slate-50">
                  <td className="whitespace-nowrap py-4 pr-4">{formatWhen(row.at)}</td>
                  <td className="py-4 pr-4">
                    <div className="font-medium text-slate-900">{row.title}</div>
                    <div className="mt-1 max-w-xs text-rose-600">{row.summary}</div>
                  </td>
                  <td className="py-4 pr-4 font-medium text-slate-700">{row.spoke}</td>
                  <td className="py-4 pr-4">{row.sku ?? "—"}</td>
                  <td className="py-4 text-right">
                    {row.runId ? (
                      <button
                        type="button"
                        onClick={() => void handleRetry(row)}
                        disabled={retryingId === row.id}
                        className="rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                      >
                        {retryingId === row.id ? "Retrying..." : "Retry"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => markSeen(row.id)}
                        className={`rounded-full bg-slate-100 px-3.5 py-1.5 ${btnQuiet}`}
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
