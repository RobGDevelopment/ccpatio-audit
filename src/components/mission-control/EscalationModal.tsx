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
        className="rounded-full bg-rose-50 px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-rose-700 ring-1 ring-rose-100 transition hover:bg-rose-100"
      >
        Raise alert
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="mission-control-escalation-title"
        className="m-auto w-full max-w-md rounded-2xl bg-white p-0 text-slate-900 shadow-[0_24px_60px_rgb(0,0,0,0.12)] backdrop:bg-slate-900/30 backdrop:backdrop-blur-sm"
        onClose={() => buttonRef.current?.focus()}
      >
        <form onSubmit={onSubmit} className="space-y-4 p-5">
          <h2 id="mission-control-escalation-title" className="text-sm font-semibold">
            Raise an ops alert
          </h2>
          <label className="block text-xs font-medium uppercase tracking-widest text-slate-500" htmlFor="mission-control-escalation-message">
            Message
            <textarea
              id="mission-control-escalation-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              maxLength={500}
              className="mt-1.5 w-full rounded-xl border-0 bg-slate-50 px-3.5 py-2.5 text-sm normal-case tracking-normal text-slate-900 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-[#C5A059]"
            />
          </label>
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDialog}
              className="rounded-full bg-white px-4 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-60"
            >
              {pending ? "Sending" : "Send"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
