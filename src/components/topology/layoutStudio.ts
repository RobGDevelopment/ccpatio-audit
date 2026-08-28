/**
 * Layout Studio — drag nodes, auto-separate overlaps, export positions for bake-in.
 */

import type { Node } from "@xyflow/react";

export const LAYOUT_STORAGE_KEY = "ccpatio-topology-layout-v6";

export type LayoutPositions = Record<string, { x: number; y: number }>;

type Box = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

function nodeBox(n: Node, pad = 0): Box | null {
  if (n.parentId) return null; // stage children move with parent
  if (n.type === "zone" || n.type === "gridTie") return null;
  const styleH =
    typeof n.style?.height === "number"
      ? n.style.height
      : typeof n.style?.height === "string"
        ? Number.parseFloat(n.style.height)
        : NaN;
  const styleW =
    typeof n.style?.width === "number"
      ? n.style.width
      : typeof n.style?.width === "string"
        ? Number.parseFloat(n.style.width)
        : NaN;
  const w = (n.measured?.width ?? n.width ?? styleW ?? 220) as number;
  const h = (n.measured?.height ?? n.height ?? styleH ?? 80) as number;
  return {
    id: n.id!,
    x: n.position.x - pad,
    y: n.position.y - pad,
    w: w + pad * 2,
    h: h + pad * 2,
  };
}

function overlaps(a: Box, b: Box): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

/**
 * Push overlapping top-level nodes apart on the Y-axis (stable, multi-pass).
 * Prefer moving the lower node down so stacks grow downward.
 */
export function autoSeparateNodes(
  nodes: Node[],
  gap = 48,
  maxPasses = 24
): Node[] {
  const next = nodes.map((n) => ({
    ...n,
    position: { ...n.position },
  }));

  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    const boxes = next
      .map((n) => nodeBox(n, gap / 2))
      .filter((b): b is Box => b != null);

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!overlaps(a, b)) continue;

        const aNode = next.find((n) => n.id === a.id)!;
        const bNode = next.find((n) => n.id === b.id)!;
        const aBottom = aNode.position.y + (a.h - gap);
        const bBottom = bNode.position.y + (b.h - gap);

        /* Move the one whose center is lower further down */
        const aCy = aNode.position.y + a.h / 2;
        const bCy = bNode.position.y + b.h / 2;
        if (aCy <= bCy) {
          const targetY = aBottom + gap;
          if (bNode.position.y < targetY) {
            bNode.position.y = targetY;
            moved = true;
          }
        } else {
          const targetY = bBottom + gap;
          if (aNode.position.y < targetY) {
            aNode.position.y = targetY;
            moved = true;
          }
        }
      }
    }
    if (!moved) break;
  }

  return next;
}

/** Top-level positions only — paste this JSON back to Cursor to bake into topologyData */
export function exportLayoutPositions(nodes: Node[]): LayoutPositions {
  const out: LayoutPositions = {};
  for (const n of nodes) {
    if (!n.id || n.parentId || n.type === "zone") continue;
    out[n.id] = {
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
    };
  }
  return out;
}

export function formatLayoutExport(nodes: Node[]): string {
  const positions = exportLayoutPositions(nodes);
  return JSON.stringify(
    {
      meta: {
        purpose: "CCPatio topology layout bake-in",
        instruction:
          "Paste this JSON to Cursor and ask to apply positions into topologyData.ts",
        generated_at: new Date().toISOString(),
      },
      positions,
    },
    null,
    2
  );
}

export function applyLayoutPositions(
  nodes: Node[],
  positions: LayoutPositions
): Node[] {
  return nodes.map((n) => {
    if (!n.id || !positions[n.id]) return n;
    return {
      ...n,
      position: { ...positions[n.id] },
    };
  });
}

export function loadSavedLayout(): LayoutPositions | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { positions?: LayoutPositions };
    return parsed.positions ?? (parsed as LayoutPositions);
  } catch {
    return null;
  }
}

export function saveLayout(nodes: Node[]): void {
  if (typeof window === "undefined") return;
  const payload = {
    positions: exportLayoutPositions(nodes),
    saved_at: new Date().toISOString(),
  };
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload));
}

export function clearSavedLayout(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LAYOUT_STORAGE_KEY);
}
