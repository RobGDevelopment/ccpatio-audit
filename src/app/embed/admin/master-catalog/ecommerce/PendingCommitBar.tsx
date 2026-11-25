"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";

export type StagedPortalChange =
  | {
      id: string;
      kind: "archive_finish";
      sku: string;
      label: string;
      stagedAt: string;
    }
  | {
      id: string;
      kind: "restore_finish";
      sku: string;
      label: string;
      stagedAt: string;
    };

type Props = {
  changes: StagedPortalChange[];
  committing: boolean;
  onCommit: () => void;
  onDiscard: () => void;
};

export default function PendingCommitBar({ changes, committing, onCommit, onDiscard }: Props) {
  const visible = changes.length > 0;
  const summary = useMemo(
    () =>
      `${changes.length} Uncommitted Roster/Catalog Change${changes.length === 1 ? "" : "s"}`,
    [changes.length],
  );

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-amber-500/30 bg-[#0b0f17]/95 px-4 py-3 backdrop-blur"
      data-testid="pending-commit-bar"
    >
      <div className="mx-auto flex w-full max-w-none flex-wrap items-center justify-between gap-3 xl:px-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-100">{summary}</p>
          <ul className="mt-1 max-h-20 overflow-y-auto text-[11px] text-slate-400">
            {changes.map((c) => (
              <li key={c.id}>
                {c.kind === "archive_finish" ? "Archive finish" : "Restore finish"} · {c.sku} ·{" "}
                {new Date(c.stagedAt).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={committing}
            data-testid="pending-commit-discard"
            className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onCommit}
            disabled={committing}
            data-testid="pending-commit-review"
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
          >
            {committing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Review &amp; Commit Changes
          </button>
        </div>
      </div>
    </div>
  );
}