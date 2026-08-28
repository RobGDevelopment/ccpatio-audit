"use client";

import { forwardRef } from "react";
import type { HybridRow } from "./hybridTypes";
import { HYBRID_HEADER_H, HYBRID_ROW_H } from "./hybridTypes";

type Props = {
  rows: HybridRow[];
  onToggleZone?: (projectId: string) => void;
  collapsed: Set<string>;
};

export const TouchpointList = forwardRef<HTMLDivElement, Props>(
  function TouchpointList({ rows, onToggleZone, collapsed }, ref) {
    return (
      <div
        ref={ref}
        className="touchpoint-list h-full min-h-0 overflow-y-auto overflow-x-hidden bg-slate-950"
      >
        <div
          className="sticky top-0 z-20 flex items-center border-b border-slate-800 bg-slate-950 px-3"
          style={{ height: HYBRID_HEADER_H, boxSizing: "border-box" }}
        >
          <span className="font-[family-name:var(--font-plex-mono)] text-[9px] font-semibold uppercase tracking-[0.16em] text-cyan-500/90">
            Topology Zones · Touchpoints
          </span>
        </div>

        <ul className="m-0 list-none p-0">
          {rows.map((row) => {
            const isZone = row.type === "project";
            const isCollapsed = isZone && collapsed.has(row.id);
            const label = row.name.replace(/^\d+(\.\d+)*\s+/, "");

            return (
              <li
                key={row.id}
                className="flex items-center gap-2 border-b border-slate-900/80 px-2 hover:bg-slate-900/40"
                style={{
                  height: HYBRID_ROW_H,
                  minHeight: HYBRID_ROW_H,
                  maxHeight: HYBRID_ROW_H,
                  boxSizing: "border-box",
                  borderLeft: isZone
                    ? `3px solid ${row.zoneColor}`
                    : `3px solid transparent`,
                  background: isZone
                    ? `linear-gradient(90deg, ${row.zoneColor}18, transparent 70%)`
                    : undefined,
                }}
              >
                {isZone ? (
                  <button
                    type="button"
                    onClick={() => onToggleZone?.(row.id)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-700 text-[10px] text-slate-400 hover:border-slate-500"
                    aria-label={isCollapsed ? "Expand zone" : "Collapse zone"}
                  >
                    {isCollapsed ? "+" : "−"}
                  </button>
                ) : (
                  <span
                    className="ml-1 h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: row.zoneColor,
                      marginLeft: 8 + row.depth * 8,
                      boxShadow: `0 0 6px ${row.zoneColor}88`,
                    }}
                  />
                )}

                <span className="shrink-0 font-[family-name:var(--font-plex-mono)] text-[10px] text-cyan-500/90">
                  {row.wbsCode}
                </span>

                <span
                  className={`min-w-0 flex-1 text-[12px] leading-tight ${
                    isZone ? "font-semibold text-slate-100" : "text-slate-300"
                  }`}
                  title={label}
                >
                  {label}
                </span>

                {!isZone ? (
                  <span
                    className="shrink-0 font-[family-name:var(--font-plex-mono)] text-[8px] uppercase tracking-wider"
                    style={{
                      color:
                        row.touchClass === "System"
                          ? "#a78bfa"
                          : row.touchClass === "Milestone"
                            ? "#fbbf24"
                            : "#38bdf8",
                    }}
                  >
                    {row.touchClass}
                  </span>
                ) : (
                  <span className="shrink-0 font-[family-name:var(--font-plex-mono)] text-[8px] uppercase tracking-wider text-slate-500">
                    Zone
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
);
