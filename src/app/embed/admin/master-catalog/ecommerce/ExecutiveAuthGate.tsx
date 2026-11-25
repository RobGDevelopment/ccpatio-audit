/**
 * Clean dark Executive Auth Gate — never render a half-loaded portal shell.
 */
export default function ExecutiveAuthGate({
  message,
  setupUrl,
}: {
  message: string;
  setupUrl: string;
}) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#0b0f17] px-4 py-10 text-slate-100">
      <div
        className="mx-auto max-w-lg rounded-2xl border border-amber-500/30 bg-[#111827] p-8 text-sm text-amber-100 ring-1 ring-amber-500/20"
        data-testid="executive-auth-gate"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/90">
          Executive Auth Gate
        </p>
        <p className="mt-3 text-base font-semibold text-white">
          Executive Control Center
        </p>
        <p className="mt-2 text-slate-300" data-testid="executive-auth-gate-message">
          {message}
        </p>
        <p className="mt-4 text-xs leading-relaxed text-slate-400">
          Configure the GHL custom menu iframe URL as:
        </p>
        <code
          className="mt-2 block break-all rounded-lg bg-black/40 px-3 py-2 font-mono text-[11px] text-amber-100/90"
          data-testid="executive-auth-gate-setup"
        >
          {setupUrl}
        </code>
        <p className="mt-3 text-[11px] text-slate-500">
          Accepted key aliases: <span className="font-mono">key</span>,{" "}
          <span className="font-mono">access_key</span>,{" "}
          <span className="font-mono">embedKey</span>. Email aliases:{" "}
          <span className="font-mono">email</span>,{" "}
          <span className="font-mono">user_email</span>,{" "}
          <span className="font-mono">ghlUserEmail</span>.
        </p>
      </div>
    </div>
  );
}
