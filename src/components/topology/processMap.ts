/**
 * Canonical real-world process connections for each walkthrough.
 * Lifecycle snake + GHL/software satellite pings + visible branches.
 * User edits live in topologyStore.processLinksByWalkthrough.
 */

import type { Edge } from "@xyflow/react";
import {
  LIFECYCLE_SNAKE_ORDER,
  MIDDLE_VISIBLE_BY_WALKTHROUGH,
  SATELLITE_TARGETS,
  ghlChipId,
  railStagesForWalkthrough,
  type WalkthroughId,
} from "./ghlPipelines";
import type { BeamEdgeData } from "./BeamEdge";
import type { SequenceStep } from "./sequences";

export type ProcessLinkKind = "lifecycle" | "satellite" | "branch";

/** Bump to re-seed persisted maps when the blueprint starting graph changes. */
export const PROCESS_MAP_REVISION = 1;

export type ProcessLink = {
  id: string;
  source: string;
  target: string;
  kind: ProcessLinkKind;
};

const SOFTWARE_IDS = new Set<string>([
  "ghl-hub",
  "sketchup",
  "katana",
  "qbo",
  "clover",
  "payment-gateway",
  "qbo-deposit-link",
  "clover-showroom",
  "sys-woo",
  "ingress",
  "redis",
  "postgres",
  "inngest",
]);

/** Visible cards that sit off the happy-path snake but are real process branches. */
const BRANCH_LINKS: Array<{ source: string; target: string }> = [
  { source: "lead-new", target: "lead-contacted-no-response" },
  { source: "lead-contacted-no-response", target: "lead-nurture" },
];

/** Extra real-world pings not listed on every SATELLITE_TARGETS row. */
const EXTRA_SATELLITES: Array<{ source: string; target: string }> = [
  { source: "traffic-meta", target: "ghl-hub" },
  { source: "traffic-google", target: "ghl-hub" },
  { source: "chan-phone", target: "ghl-hub" },
  { source: "chan-email", target: "ghl-hub" },
  { source: "showroom-walkin", target: ghlChipId("lead-new") },
];

export function processLinkId(
  source: string,
  target: string,
  kind: ProcessLinkKind
): string {
  if (kind === "satellite") return `sat-${source}-${target}`;
  if (kind === "branch") return `branch-${source}-${target}`;
  return `snake-${source}-${target}`;
}

export function inferProcessLinkKind(
  source: string,
  target: string
): ProcessLinkKind {
  if (
    target.startsWith("ghlchip-") ||
    source.startsWith("ghlchip-") ||
    SOFTWARE_IDS.has(target) ||
    SOFTWARE_IDS.has(source)
  ) {
    return "satellite";
  }
  return "lifecycle";
}

export function isSoftwareOrChip(id: string): boolean {
  return id.startsWith("ghlchip-") || SOFTWARE_IDS.has(id);
}

export function isEditableProcessEdgeId(id: string): boolean {
  return (
    id.startsWith("snake-") ||
    id.startsWith("sat-") ||
    id.startsWith("branch-")
  );
}

export function isMappableNodeId(id: string): boolean {
  if (!id) return false;
  if (id === "rail-ghl" || id === "rail-software") return false;
  if (id.startsWith("blank-slot-")) return false;
  if (id.startsWith("gt-in-") || id.startsWith("gt-out-")) return false;
  if (/^z[0-8]$/.test(id)) return false;
  return true;
}

export function sanitizeProcessLinks(raw: unknown): ProcessLink[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ProcessLink[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const source = typeof rec.source === "string" ? rec.source : "";
    const target = typeof rec.target === "string" ? rec.target : "";
    if (!source || !target || source === target) continue;
    const kind: ProcessLinkKind =
      rec.kind === "satellite" || rec.kind === "branch" || rec.kind === "lifecycle"
        ? rec.kind
        : inferProcessLinkKind(source, target);
    const id =
      typeof rec.id === "string" && rec.id
        ? rec.id
        : processLinkId(source, target, kind);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, source, target, kind });
  }
  return out;
}

export function sanitizeProcessLinkMap(
  raw: unknown
): Partial<Record<WalkthroughId, ProcessLink[]>> {
  if (!raw || typeof raw !== "object") return {};
  const rec = raw as Record<string, unknown>;
  const out: Partial<Record<WalkthroughId, ProcessLink[]>> = {};
  for (const id of ["scottsdale", "solana", "trade", "warranty"] as const) {
    const list = sanitizeProcessLinks(rec[id]);
    if (list) out[id] = list;
  }
  return out;
}

/**
 * Play / Step follow the live process map so unplug/plug changes the path.
 * Satellite pings are listed on each dwell; branches are not auto-followed.
 */
export function buildPlaybackStepsFromProcessMap(
  walkthroughId: WalkthroughId,
  links: ProcessLink[],
  mountedIds: Set<string>
): SequenceStep[] {
  const hops = links.filter(
    (l) =>
      l.kind === "lifecycle" &&
      mountedIds.has(l.source) &&
      mountedIds.has(l.target)
  );
  const outs = new Map<string, ProcessLink[]>();
  for (const link of hops) {
    const list = outs.get(link.source) ?? [];
    list.push(link);
    outs.set(link.source, list);
  }

  const order = LIFECYCLE_SNAKE_ORDER[walkthroughId] ?? [];
  const start = order.find((id) => mountedIds.has(id));
  if (!start) return [];

  const visited = new Set<string>();
  const path: string[] = [];
  const used: ProcessLink[] = [];
  let cur: string | undefined = start;
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    path.push(cur);
    const options: ProcessLink[] = (outs.get(cur) ?? []).filter(
      (l: ProcessLink) => mountedIds.has(l.target) && !visited.has(l.target)
    );
    if (options.length === 0) break;
    const nextId: string | undefined = order.find((id) =>
      options.some((l) => l.target === id)
    );
    const preferred: ProcessLink =
      (nextId
        ? options.find((l) => l.target === nextId)
        : options[0]) ?? options[0]!;
    used.push(preferred);
    cur = preferred.target;
  }

  return path.map((id, i) => {
    const hop = i > 0 ? used[i - 1] : undefined;
    const sats = links
      .filter(
        (l) =>
          l.kind === "satellite" &&
          l.source === id &&
          mountedIds.has(l.target)
      )
      .map((l) => l.target);
    return {
      nodeId: id,
      travelEdges: hop ? [hop.id] : [],
      pings: sats.length > 0 ? sats : undefined,
    };
  });
}

export type ProcessMapAuditIssue = {
  walkthroughId: WalkthroughId;
  severity: "error" | "warn";
  message: string;
};

export function auditSeededProcessMaps(): ProcessMapAuditIssue[] {
  const issues: ProcessMapAuditIssue[] = [];
  for (const id of ["scottsdale", "solana", "trade", "warranty"] as const) {
    const links = seedProcessLinks(id);
    const visible = new Set(MIDDLE_VISIBLE_BY_WALKTHROUGH[id] ?? []);
    const chips = new Set(
      railStagesForWalkthrough(id).map((s) => ghlChipId(s.stageId))
    );
    const order = LIFECYCLE_SNAKE_ORDER[id] ?? [];
    const ids = new Set(links.map((l) => l.id));
    if (ids.size !== links.length) {
      issues.push({
        walkthroughId: id,
        severity: "error",
        message: "Duplicate process link ids in seed",
      });
    }
    for (let i = 0; i < order.length - 1; i++) {
      const a = order[i]!;
      const b = order[i + 1]!;
      const found = links.some(
        (l) => l.kind === "lifecycle" && l.source === a && l.target === b
      );
      if (!found) {
        issues.push({
          walkthroughId: id,
          severity: "error",
          message: `Missing snake hop ${a} → ${b}`,
        });
      }
    }
    for (const link of links) {
      if (link.source === link.target) {
        issues.push({
          walkthroughId: id,
          severity: "error",
          message: `Self-loop ${link.id}`,
        });
      }
      if (link.kind === "satellite") {
        if (!visible.has(link.source) && !chips.has(link.source) && !SOFTWARE_IDS.has(link.source)) {
          issues.push({
            walkthroughId: id,
            severity: "warn",
            message: `Satellite source not on walkthrough: ${link.source}`,
          });
        }
        const tgtOk =
          chips.has(link.target) ||
          SOFTWARE_IDS.has(link.target) ||
          visible.has(link.target);
        if (!tgtOk) {
          issues.push({
            walkthroughId: id,
            severity: "error",
            message: `Satellite target not mounted for ${id}: ${link.source} → ${link.target}`,
          });
        }
      }
    }
    const golden = links.filter(
      (l) => l.kind === "satellite" && l.target === "katana"
    );
    if (golden.length === 0) {
      issues.push({
        walkthroughId: id,
        severity: "error",
        message: "No Katana golden-handoff ping in seed",
      });
    }
  }
  return issues;
}

export function seedProcessLinks(walkthroughId: WalkthroughId): ProcessLink[] {
  const seen = new Set<string>();
  const out: ProcessLink[] = [];
  const visible = new Set(
    MIDDLE_VISIBLE_BY_WALKTHROUGH[walkthroughId] ?? []
  );
  const order = LIFECYCLE_SNAKE_ORDER[walkthroughId] ?? [];
  const onPath = (id: string) => visible.has(id);

  const push = (
    source: string,
    target: string,
    kind: ProcessLinkKind
  ) => {
    const id = processLinkId(source, target, kind);
    if (seen.has(id) || source === target) return;
    seen.add(id);
    out.push({ id, source, target, kind });
  };

  for (let i = 0; i < order.length - 1; i++) {
    push(order[i]!, order[i + 1]!, "lifecycle");
  }

  for (const [source, targets] of Object.entries(SATELLITE_TARGETS)) {
    if (!onPath(source)) continue;
    /* Warranty delivery does not invoice via QBO on the happy path. */
    if (source === "delivery" && walkthroughId === "warranty") continue;
    for (const target of targets) {
      if (target) push(source, target, "satellite");
    }
  }

  for (const { source, target } of BRANCH_LINKS) {
    if (onPath(source) && onPath(target)) push(source, target, "branch");
  }
  for (const { source, target } of EXTRA_SATELLITES) {
    if (onPath(source)) push(source, target, "satellite");
  }

  return out;
}

export function processLinksToEdges(
  links: ProcessLink[],
  mountedIds: Set<string>
): Edge[] {
  const edges: Edge[] = [];
  for (const link of links) {
    if (!mountedIds.has(link.source) || !mountedIds.has(link.target)) continue;
    const satellite = link.kind === "satellite";
    const data: BeamEdgeData = {
      gridLevel: satellite ? "branch" : "local",
      satellite,
      mapKind: link.kind,
    };
    edges.push({
      id: link.id,
      source: link.source,
      target: link.target,
      sourceHandle: "right",
      targetHandle: "left",
      type: satellite ? "ping" : "beam",
      zIndex: satellite ? 2 : 1,
      data,
    });
  }
  return edges;
}

export function kindLabel(kind: ProcessLinkKind): string {
  if (kind === "satellite") return "GHL / software ping";
  if (kind === "branch") return "Process branch";
  return "Lifecycle next";
}
