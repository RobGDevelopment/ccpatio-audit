"use client";

import { useRef, useState, type FormEvent } from "react";
import { raiseEscalationAction } from "@/app/mission-control/escalation-action";

export function EscalationModal() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function closeDialog() {
    dialogRef.current?.close();
    buttonRef.current?.focus();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await raiseEscalationAction(message);
    setPending(false);
    if (result.ok) {
      setMessage("");
      closeDialog();
      return;
    }
    setError(result.error);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setError(null);
          dialogRef.current?.showModal();
        }}
        className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-rose-300 hover:bg-rose-500/20"
      >
        Raise alert
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="mission-control-escalation-title"
        className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-950 p-0 text-zinc-50 backdrop:bg-black/70"
        onClose={() => buttonRef.current?.focus()}
      >
        <form onSubmit={onSubmit} className="space-y-4 p-5">
          <h2 id="mission-control-escalation-title" className="text-sm font-semibold">
            Raise an ops alert
          </h2>
          <label className="block text-xs text-zinc-400" htmlFor="mission-control-escalation-message">
            Message
            <textarea
              id="mission-control-escalation-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              maxLength={500}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDialog}
              className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              {pending ? "Sending" : "Send"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
