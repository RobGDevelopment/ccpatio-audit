"use client";

import React from "react";

export function GoldBeam({
  className = "",
  active = true,
}: {
  className?: string;
  active?: boolean;
}) {
  if (!active) return null;
  return (
    <span
      className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px] overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <span className="animate-beam-glide-lux absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[#C5A059] to-transparent" />
    </span>
  );
}
