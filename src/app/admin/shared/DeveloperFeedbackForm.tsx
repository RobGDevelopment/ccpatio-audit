"use client";

import { useState } from "react";
import { submitStaffNote } from "./actions";

export function DeveloperFeedbackForm({
  globalSku,
  panelLocation,
  operatorEmail = "operator@ccpatio.com",
}: {
  globalSku?: string;
  panelLocation: string;
  operatorEmail?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [note, setNote] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="text-xs font-medium text-emerald-400 hover:text-emerald-300 transition underline underline-offset-4 decoration-emerald-900/50"
      >
        Send Developer Feedback
      </button>
    );
  }

  const handleSubmit = async () => {
    if (!note.trim()) return;
    setIsSubmitting(true);
    try {
      await submitStaffNote({
        globalSku,
        panelLocation,
        note,
        isUrgent,
        operatorEmail,
      });
      setIsOpen(false);
      setNote("");
      setIsUrgent(false);
      // Optional: Fire a local toast here
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-900/50 p-4 shadow-sm">
      <div className="mb-2 text-sm font-semibold text-zinc-100">Request Improvement or Report Issue</div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="E.g., The base cost field is disabled and I can't edit it."
        className="w-full rounded-sm border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        rows={3}
      />
      <div className="mt-3 flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={isUrgent}
            onChange={(e) => setIsUrgent(e.target.checked)}
            className="rounded border-zinc-700 bg-zinc-900 text-red-500 focus:ring-red-500 focus:ring-offset-zinc-900"
          />
          <span className={isUrgent ? "text-red-400 font-medium" : ""}>Urgent Blocker (Alert instantly)</span>
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-100 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !note.trim()}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-zinc-50 transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {isSubmitting ? "Sending..." : "Send Note"}
          </button>
        </div>
      </div>
    </div>
  );
}
