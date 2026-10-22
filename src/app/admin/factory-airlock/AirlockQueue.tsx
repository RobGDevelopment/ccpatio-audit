"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Step2Materials } from "@/app/embed/factory-bom/steps/Step2Materials";
import { Step3Operations } from "@/app/embed/factory-bom/steps/Step3Operations";
import { releaseButton } from "@/app/admin/factory-bom/factory-bom-ui";
import {
  approveAirlockAction,
  rejectAirlockAction,
  type PendingAirlockBuild,
} from "@/server/factory-bom/airlock-actions";
import type { IntakeSnapshot } from "@/server/factory-bom/load-airlock-snapshot";
import type { ChildMeta } from "@/server/factory-bom/intake/child-meta";

function actionMessage(error: string): string {
  if (error === "not_authorized") return "Your session cannot approve or reject factory designs.";
  if (error === "comment_required") return "A rejection comment must be between 10 and 2000 characters.";
  if (error === "illegal_transition") return "This design is no longer waiting for review. Refresh the queue.";
  if (error === "airlock_schema_pending") return "Factory review tracking is not in the database yet.";
  if (error === "missing_opportunity") return "This build has no GoHighLevel opportunity, so it cannot be approved.";
  if (error === "conflict") return "Someone else updated this design. Refresh and try again.";
  if (error.startsWith("event_dispatch_failed")) {
    return "The design was approved, but the release event did not send. Do not approve again. Retry the event from Inngest.";
  }
  return "The review action failed. Refresh and try again.";
}

export function AirlockQueue({
  builds,
  schemaPending,
  selected,
  snapshot,
  products,
}: {
  builds: PendingAirlockBuild[];
  schemaPending: boolean;
  selected: PendingAirlockBuild | null;
  snapshot: IntakeSnapshot | null;
  products: ChildMeta[];
}) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const trimmed = comment.trim();
  const commentReady = trimmed.length >= 10 && trimmed.length <= 2000;

  function run(action: "approve" | "reject") {
    if (!selected) return;
    setMessage(null);
    startTransition(async () => {
      const result =
        action === "approve"
          ? await approveAirlockAction({ buildId: selected.id, version: selected.version })
          : await rejectAirlockAction({
              buildId: selected.id,
              version: selected.version,
              comment,
            });
      if (!result.ok) {
        setMessage(actionMessage(result.error));
        return;
      }
      setComment("");
      setMessage(
        result.status === "approved"
          ? "Approved. The release event was sent. Katana is not called from this screen."
          : "Rejected. The design is back with the designer as a draft.",
      );
      router.refresh();
    });
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-800">Pending manager review</h2>
        {schemaPending ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            The airlock tables are not in the database yet. Migration 0059 has not been applied, so
            this queue is empty.
          </p>
        ) : null}
        {builds.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
            No designs are waiting for factory review.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {builds.map((build) => {
              const active = selected?.id === build.id;
              return (
                <li key={build.id}>
                  <Link
                    href={`/admin/factory-airlock?sku=${encodeURIComponent(build.rootSku)}`}
                    className={`block rounded-xl border px-3 py-3 ${
                      active ? "border-slate-800 bg-white" : "border-slate-200 bg-white hover:border-slate-400"
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-900">{build.displayName}</p>
                    <p className="font-mono text-xs text-slate-500">{build.rootSku}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {build.submittedBy || "Unknown designer"}
                      {build.submittedAt
                        ? ` · ${new Date(build.submittedAt).toLocaleString()}`
                        : ""}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
        {!selected || !snapshot ? (
          <p className="text-sm text-slate-500">Select a design to inspect the extracted materials and build steps.</p>
        ) : (
          <div className="flex flex-col gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Read only</p>
              <h2 className="text-lg font-semibold text-slate-900">{selected.displayName}</h2>
              <p className="font-mono text-xs text-slate-500">{selected.rootSku}</p>
            </div>
            <Step2Materials snapshot={snapshot} products={products} readOnly />
            <Step3Operations snapshot={snapshot} readOnly />
            <div className="flex flex-col gap-3 border-t border-slate-200 pt-4">
              <label className="text-sm font-medium text-slate-800" htmlFor="airlock-reject-comment">
                Reject (Requires Comment)
              </label>
              <textarea
                id="airlock-reject-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="Tell the designer what to fix (10–2000 characters)."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
              />
              <p className="text-xs text-slate-500">{trimmed.length} / 2000</p>
              {message ? <p className="text-sm text-slate-700">{message}</p> : null}
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={!commentReady || isPending}
                  onClick={() => run("reject")}
                  className="min-h-11 rounded-lg bg-rose-700 px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Reject (Requires Comment)
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run("approve")}
                  className={releaseButton}
                >
                  Approve & Push to Katana
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
