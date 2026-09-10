"use client";

import type { ReactNode } from "react";

type Props = {
  open: boolean;
  onToggle: () => void;
  onActivate?: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  buttonTestId?: string;
};

export function PimDisclosure({
  open,
  onToggle,
  onActivate,
  title,
  subtitle,
  badge,
  children,
  className = "",
  buttonTestId,
}: Props) {
  return (
    <div className={className}>
      <div className="flex w-full items-start gap-1 px-2 py-2">
        <button
          type="button"
          aria-label={open ? "Collapse" : "Expand"}
          aria-expanded={open}
          onClick={onToggle}
          className="mt-1 rounded px-2 py-1 text-zinc-500 transition hover:bg-zinc-900/60 hover:text-zinc-300"
        >
          <span
            aria-hidden
            className={`inline-block transition ${open ? "rotate-90" : ""}`}
          >
            ▸
          </span>
        </button>
        <button
          type="button"
          data-testid={buttonTestId}
          aria-expanded={open}
          onClick={() => {
            onActivate?.();
            if (!open) onToggle();
          }}
          className="flex min-w-0 flex-1 items-start justify-between gap-3 rounded-md px-2 py-1 text-left transition hover:bg-zinc-900/40"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0">{title}</div>
              {badge}
            </div>
            {subtitle ? <div className="mt-1">{subtitle}</div> : null}
          </div>
        </button>
      </div>
      {open ? (
        <div className="border-t border-zinc-800/80 px-4 pb-4 pt-3">{children}</div>
      ) : null}
    </div>
  );
}
