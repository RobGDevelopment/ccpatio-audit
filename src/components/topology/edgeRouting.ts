/**
 * Global PCB beam routing — Architect overlay:
 *   Card OUTPUT (Right) → rise in an empty gutter → parent box TOP door
 *   → overhead trunk / snake tray → next parent TOP door → drop in a
 *   gutter → Card INPUT (Top).
 * Beams never cross a card's text; the only time they enter a box is the
 * labeled input / output opening.
 */

import { type EdgeProps, type Node, Position } from "@xyflow/react";
import { CARD_W, COL_GAP, PLUG_GUTTER_L, RAIL_LANE_H, WIRE_GUTTER_R, ZONE_HEADER_H } from "./humanCanvasLayout";
import {
  LEVEL_GAP_PX,
  trunkLaneIndex,
  type GridLevel,
} from "./utilityTypes";

type PathParams = Pick<
  EdgeProps,
  | "sourceX"
  | "sourceY"
  | "targetX"
  | "targetY"
  | "sourcePosition"
  | "targetPosition"
>;

type Rect = { id: string; x: number; y: number; w: number; h: number; type?: string };

const STUB = 22;
const RAIL_STUB = 12;
const BUS_CLEARANCE = 28;
const WRAP_MARGIN = 48;
const LANE_PITCH = 14;
const HIT_PAD = 8;
const APPROACH = 22;
const DOOR_X_SLACK = 32;

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function absRect(n: Node, byId: Map<string, Node>): Rect {
  /* Prefer parent walk — positionAbsolute is not always present on store nodes. */
  let x = n.position.x;
  let y = n.position.y;
  if (n.parentId) {
    let parent = byId.get(n.parentId);
    while (parent) {
      x += parent.position.x;
      y += parent.position.y;
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
  } else {
    const stored = (
      n as Node & { positionAbsolute?: { x: number; y: number } }
    ).positionAbsolute;
    if (stored) {
      x = stored.x;
      y = stored.y;
    }
  }
  return {
    id: n.id,
    type: n.type,
    x,
    y,
    w: num(n.width ?? n.style?.width ?? n.measured?.width, 160),
    h: num(n.height ?? n.style?.height ?? n.measured?.height, 72),
  };
}

function segmentHitsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: Rect,
  pad: number
): boolean {
  const left = r.x - pad;
  const right = r.x + r.w + pad;
  const top = r.y - pad;
  const bottom = r.y + r.h + pad;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  if (maxX < left || minX > right || maxY < top || minY > bottom) return false;
  if (Math.abs(y2 - y1) < 1.5) {
    return y1 >= top && y1 <= bottom && maxX >= left && minX <= right;
  }
  if (Math.abs(x2 - x1) < 1.5) {
    return x1 >= left && x1 <= right && maxY >= top && minY <= bottom;
  }
  return true;
}

function polylineHits(
  pts: Array<[number, number]>,
  rects: Rect[],
  pad: number,
  endIds: Set<string>
): boolean {
  const lastSeg = pts.length - 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const skip =
      i === 0 || i === lastSeg ? endIds : new Set<string>();
    for (const r of rects) {
      if (skip.has(r.id)) continue;
      if (segmentHitsRect(a[0], a[1], b[0], b[1], r, pad)) return true;
    }
  }
  return false;
}

function dedup(pts: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (
      !last ||
      Math.abs(last[0] - p[0]) > 0.5 ||
      Math.abs(last[1] - p[1]) > 0.5
    ) {
      out.push(p);
    }
  }
  return out;
}

function buildOrthogonal(
  pts: Array<[number, number]>
): [path: string, labelX: number, labelY: number] {
  const clean = dedup(pts);
  if (clean.length === 0) return ["", 0, 0];
  const [first, ...rest] = clean;
  const path = [
    `M ${first![0]},${first![1]}`,
    ...rest.map(([x, y]) => `L ${x},${y}`),
  ].join(" ");
  let bestLen = -1;
  let labelX = first![0];
  let labelY = first![1];
  for (let i = 0; i < clean.length - 1; i++) {
    const a = clean[i]!;
    const b = clean[i + 1]!;
    const len = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    if (len > bestLen) {
      bestLen = len;
      labelX = (a[0] + b[0]) / 2;
      labelY = (a[1] + b[1]) / 2;
    }
  }
  return [path, labelX, labelY];
}

function isRailZone(id: string): boolean {
  return id === "rail-ghl" || id === "rail-software" || id.startsWith("rail-");
}

function zoneAtPoint(x: number, y: number, zones: Rect[]): Rect | null {
  return (
    zones.find(
      (z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h
    ) ?? null
  );
}

function parentZone(
  node: Node | undefined,
  byId: Map<string, Node>,
  zoneRects: Rect[]
): Rect | null {
  if (!node) return null;
  let cur: Node | undefined = node;
  while (cur) {
    if (cur.type === "zone") {
      return zoneRects.find((z) => z.id === cur!.id) ?? absRect(cur, byId);
    }
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  const r = absRect(node, byId);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return zoneAtPoint(cx, cy, zoneRects);
}

function columnIndex(card: Rect, zone: Rect): 0 | 1 {
  const rel = card.x - zone.x;
  return rel >= PLUG_GUTTER_L + CARD_W + COL_GAP / 2 ? 1 : 0;
}

function colGapX(zone: Rect): number {
  return zone.x + PLUG_GUTTER_L + CARD_W + COL_GAP / 2;
}

function zoneLeftTrayX(zone: Rect): number {
  return zone.x - 22;
}

function zoneRightTrayX(zone: Rect): number {
  return zone.x + zone.w + 22;
}

function exitChannelX(
  sourceX: number,
  srcCard: Rect | null,
  srcZone: Rect | null
): number {
  if (!srcZone || !srcCard || isRailZone(srcZone.id)) {
    return sourceX + (srcZone && isRailZone(srcZone.id) ? RAIL_STUB : STUB);
  }
  return columnIndex(srcCard, srcZone) === 0
    ? colGapX(srcZone)
    : srcZone.x + srcZone.w - WIRE_GUTTER_R / 2;
}

function dropChannelX(
  targetX: number,
  tgtCard: Rect | null,
  tgtZone: Rect | null,
  srcZone: Rect | null
): number {
  if (!tgtZone || !tgtCard) return targetX - STUB;
  if (isRailZone(tgtZone.id)) return Math.max(tgtZone.x + 16, tgtCard.x - 14);
  if (columnIndex(tgtCard, tgtZone) === 1) return colGapX(tgtZone);
  return tgtZone.x + PLUG_GUTTER_L / 2;
}

function headerY(zone: Rect): number {
  if (isRailZone(zone.id)) return zone.y + RAIL_LANE_H * 0.5;
  return zone.y + Math.min(52, ZONE_HEADER_H * 0.42);
}

function roofY(zone: Rect): number {
  return zone.y - 18;
}

function zoneTopInX(zone: Rect): number {
  return zone.x + 22;
}

function zoneTopOutX(zone: Rect): number {
  return zone.x + zone.w - 22;
}

function approachY(ty: number, zone: Rect | null): number {
  const y = ty - APPROACH;
  if (!zone) return y;
  const floor = isRailZone(zone.id)
    ? zone.y + 24
    : zone.y + 16;
  return Math.max(y, floor);
}

function pointInZone(x: number, y: number, z: Rect, pad = 0): boolean {
  return (
    x >= z.x - pad &&
    x <= z.x + z.w + pad &&
    y >= z.y - pad &&
    y <= z.y + z.h + pad
  );
}

function isTopDoorX(x: number, z: Rect): boolean {
  return (
    Math.abs(x - zoneTopInX(z)) <= DOOR_X_SLACK ||
    Math.abs(x - zoneTopOutX(z)) <= DOOR_X_SLACK
  );
}

/** True when a segment crosses a parent box anywhere except the top door. */
function segmentBreaksZone(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  z: Rect
): boolean {
  const aIn = pointInZone(x1, y1, z, -1);
  const bIn = pointInZone(x2, y2, z, -1);
  if (aIn && bIn) return false;
  if (!aIn && !bIn) {
    return segmentHitsRect(x1, y1, x2, y2, z, 1);
  }
  const x = Math.abs(x2 - x1) < 2 ? x1 : (x1 + x2) / 2;
  const vertical = Math.abs(x2 - x1) < 4;
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const crossesTop = minY <= z.y + 4 && maxY >= z.y - 4;
  return !(vertical && crossesTop && isTopDoorX(x, z));
}

function polylineBreaksZones(
  pts: Array<[number, number]>,
  zones: Rect[]
): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    for (const z of zones) {
      if (segmentBreaksZone(a[0], a[1], b[0], b[1], z)) return true;
    }
  }
  return false;
}

function isLegalTopPlug(
  pts: Array<[number, number]>,
  tgtCard: Rect | null
): boolean {
  if (pts.length < 2 || !tgtCard) return true;
  const a = pts[pts.length - 2]!;
  const b = pts[pts.length - 1]!;
  const vertical = Math.abs(a[0] - b[0]) < 3;
  const fromAbove = a[1] < b[1] - 4;
  const short = Math.abs(b[1] - a[1]) <= APPROACH + 16;
  return vertical && fromAbove && short;
}

/** Same parent: Right-out (or Top-out) → gutter → row-gap → Top input. */
function localTopIn(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  exitX: number,
  tgtZone: Rect | null,
  srcPos: Position
): Array<[number, number]> {
  const ay = approachY(ty, tgtZone);
  if (srcPos === Position.Top) {
    return [
      [sx, sy],
      [sx, ay],
      [tx, ay],
      [tx, ty],
    ];
  }
  return [
    [sx, sy],
    [exitX, sy],
    [exitX, ay],
    [tx, ay],
    [tx, ty],
  ];
}

/**
 * Inter-parent: leave via source zone TOP, ride a bus that stays outside
 * every box, enter the target zone TOP, then travel in its header lane
 * and plug the card INPUT from above.
 */
function topDoorPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  exitX: number,
  gutterX: number,
  busY: number,
  srcZone: Rect | null,
  tgtZone: Rect | null,
  srcPos: Position
): Array<[number, number]> {
  const srcHy = srcZone ? headerY(srcZone) : Math.min(sy, busY);
  const tgtHy = tgtZone ? headerY(tgtZone) : approachY(ty, tgtZone);
  const ay = approachY(ty, tgtZone);
  const srcRoof = srcZone ? roofY(srcZone) : busY;
  const tgtRoof = tgtZone ? roofY(tgtZone) : busY;
  const srcOutX =
    srcPos === Position.Top ? sx : srcZone ? zoneTopOutX(srcZone) : exitX;
  const tgtInX = tgtZone ? zoneTopInX(tgtZone) : gutterX;

  const pts: Array<[number, number]> = [[sx, sy]];
  if (srcPos !== Position.Top) {
    pts.push([exitX, sy]);
    pts.push([exitX, srcHy]);
    pts.push([srcOutX, srcHy]);
  }
  pts.push([srcOutX, srcRoof]);

  const busAboveTarget = !tgtZone || busY <= tgtRoof + 2;
  const busAboveSource = !srcZone || busY <= srcRoof + 2;

  if (busAboveTarget && busAboveSource) {
    pts.push([srcOutX, busY]);
    pts.push([tgtInX, busY]);
    pts.push([tgtInX, tgtRoof]);
  } else {
    const srcTray =
      srcZone && tgtZone && tgtZone.x + tgtZone.w / 2 < srcZone.x + srcZone.w / 2
        ? zoneLeftTrayX(srcZone)
        : srcZone
          ? zoneRightTrayX(srcZone)
          : srcOutX;
    const tgtTray = tgtZone ? zoneLeftTrayX(tgtZone) : tgtInX;
    pts.push([srcTray, srcRoof]);
    pts.push([srcTray, busY]);
    pts.push([tgtTray, busY]);
    pts.push([tgtTray, tgtRoof]);
    pts.push([tgtInX, tgtRoof]);
  }

  pts.push([tgtInX, tgtHy]);
  pts.push([gutterX, tgtHy]);
  pts.push([gutterX, ay]);
  pts.push([tx, ay]);
  pts.push([tx, ty]);
  return pts;
}

/** Trunk between zone-top IN/OUT plugs: stay above the boxes, drop in the door. */
function topToTopBus(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  busY: number
): Array<[number, number]> {
  const roof = Math.min(sy, ty, busY) - 4;
  const cruise = Math.min(busY, roof);
  return [
    [sx, sy],
    [sx, cruise],
    [tx, cruise],
    [tx, ty],
  ];
}

function fivePoint(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  exitX: number,
  dropX: number,
  busY: number
): Array<[number, number]> {
  const ay = ty - APPROACH;
  return [
    [sx, sy],
    [exitX, sy],
    [exitX, busY],
    [dropX, busY],
    [dropX, ay],
    [tx, ay],
    [tx, ty],
  ];
}

function wrapOuter(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  exitX: number,
  dropX: number,
  overY: number,
  underY: number,
  outerX: number,
  srcPos: Position,
  srcZone: Rect | null,
  tgtZone: Rect | null
): Array<[number, number]> {
  const ay = approachY(ty, tgtZone);
  const srcHy = srcZone ? headerY(srcZone) : sy;
  const tgtHy = tgtZone ? headerY(tgtZone) : ay;
  const srcRoof = srcZone ? roofY(srcZone) : overY;
  const tgtRoof = tgtZone ? roofY(tgtZone) : overY;
  const srcOutX =
    srcPos === Position.Top ? sx : srcZone ? zoneTopOutX(srcZone) : exitX;
  const tgtInX = tgtZone ? zoneTopInX(tgtZone) : tx;

  const start: Array<[number, number]> =
    srcPos === Position.Top
      ? [
          [sx, sy],
          [sx, srcRoof],
        ]
      : [
          [sx, sy],
          [exitX, sy],
          [exitX, srcHy],
          [srcOutX, srcHy],
          [srcOutX, srcRoof],
        ];

  return [
    ...start,
    [outerX, srcRoof],
    [outerX, underY],
    [outerX, Math.min(overY, tgtRoof)],
    [tgtInX, Math.min(overY, tgtRoof)],
    [tgtInX, tgtHy],
    [dropX, tgtHy],
    [dropX, ay],
    [tx, ay],
    [tx, ty],
  ];
}

function busCandidates(
  srcZone: Rect | null,
  tgtZone: Rect | null,
  zones: Rect[],
  lane: number
): number[] {
  const ghl = zones.find((z) => z.id === "rail-ghl");
  const soft = zones.find((z) => z.id === "rail-software");
  const middle = zones.filter((z) => !isRailZone(z.id));
  const out: number[] = [];
  const laneT = (gapTop: number, gapBot: number) => {
    const span = gapBot - gapTop;
    if (span < 16) return;
    const pitch = Math.min(10, Math.max(4, (span - 16) / 6));
    const y = (gapTop + gapBot) / 2 + (lane - 2.5) * pitch;
    if (y > gapTop + 6 && y < gapBot - 6) out.push(y);
  };
  if (ghl && middle.length) {
    laneT(ghl.y + ghl.h, Math.min(...middle.map((z) => z.y)));
  }
  /* Lower band-gap: snake under the middle boxes (Architect overlay) */
  if (soft && middle.length) {
    laneT(Math.max(...middle.map((z) => z.y + z.h)), soft.y);
  }
  if (ghl) {
    out.push(ghl.y - 20 - (lane % 3) * 8);
  }
  /* Same-rail hops: bus just above that rail (enter from the top) */
  for (const rail of [srcZone, tgtZone]) {
    if (!rail || !isRailZone(rail.id)) continue;
    out.push(rail.y - 18 - (lane % 3) * 8);
  }
  return out;
}

function routeLength(pts: Array<[number, number]>): number {
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    n += Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
  }
  return n;
}

/**
 * Strict orthogonal PCB path. borderRadius is unused — pure 90° elbows.
 */
export function getSmartBeamPath(
  pathParams: PathParams,
  edgeId: string,
  sourceId: string,
  targetId: string,
  nodes: Node[],
  level: GridLevel = "branch"
): [path: string, labelX: number, labelY: number] {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } =
    pathParams;
  const srcPos = sourcePosition ?? Position.Right;
  const tgtPos = targetPosition ?? Position.Top;
  void tgtPos;
  const lane = trunkLaneIndex(edgeId);
  void level;
  void LEVEL_GAP_PX;

  const fallbackBus = Math.min(sourceY, targetY) - BUS_CLEARANCE - lane * LANE_PITCH;
  const fallback = fivePoint(
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourceX + STUB,
    targetX - STUB,
    fallbackBus
  );

  if (!nodes.length) {
    return buildOrthogonal(fallback);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const srcNode = byId.get(sourceId);
  const tgtNode = byId.get(targetId);
  const zoneRects = nodes
    .filter((n) => n.type === "zone")
    .map((n) => absRect(n, byId));
  const cardRects = nodes
    .filter((n) => n.type !== "zone" && n.type !== "gridTie" && n.type !== "stage")
    .map((n) => absRect(n, byId));
  const srcCard = srcNode ? absRect(srcNode, byId) : null;
  const tgtCard = tgtNode ? absRect(tgtNode, byId) : null;
  const srcZone =
    zoneAtPoint(sourceX, sourceY, zoneRects) ??
    parentZone(srcNode, byId, zoneRects);
  const tgtZone =
    zoneAtPoint(targetX, targetY, zoneRects) ??
    parentZone(tgtNode, byId, zoneRects);
  const skipEnds = new Set([sourceId, targetId]);

  const exitX = exitChannelX(sourceX, srcCard, srcZone);
  const dropX = dropChannelX(targetX, tgtCard, tgtZone, srcZone);
  const sameZone = Boolean(srcZone && tgtZone && srcZone.id === tgtZone.id);
  const topToTop =
    srcPos === Position.Top &&
    (tgtPos === Position.Top || srcNode?.type === "gridTie");

  const candidates: Array<Array<[number, number]>> = [];

  if (sameZone) {
    candidates.push(
      localTopIn(sourceX, sourceY, targetX, targetY, exitX, tgtZone, srcPos)
    );
  }

  const buses = busCandidates(srcZone, tgtZone, zoneRects, lane);
  for (const busY of buses) {
    if (topToTop) {
      candidates.push(topToTopBus(sourceX, sourceY, targetX, targetY, busY));
    } else if (!sameZone) {
      candidates.push(
        topDoorPath(
          sourceX,
          sourceY,
          targetX,
          targetY,
          exitX,
          dropX,
          busY,
          srcZone,
          tgtZone,
          srcPos
        )
      );
    } else {
      candidates.push(
        fivePoint(sourceX, sourceY, targetX, targetY, exitX, dropX, busY)
      );
    }
  }

  const worldLeft =
    (zoneRects.length
      ? Math.min(...zoneRects.map((z) => z.x))
      : Math.min(sourceX, targetX)) - WRAP_MARGIN;
  const worldRight =
    (zoneRects.length
      ? Math.max(...zoneRects.map((z) => z.x + z.w))
      : Math.max(sourceX, targetX)) + WRAP_MARGIN;
  const ghl = zoneRects.find((z) => z.id === "rail-ghl");
  const soft = zoneRects.find((z) => z.id === "rail-software");
  const mids = zoneRects.filter((z) => !isRailZone(z.id));
  const overY =
    buses[0] ??
    (ghl && mids.length
      ? (ghl.y + ghl.h + Math.min(...mids.map((z) => z.y))) / 2
      : Math.min(sourceY, targetY) - BUS_CLEARANCE);
  const underY =
    soft && mids.length
      ? (Math.max(...mids.map((z) => z.y + z.h)) + soft.y) / 2 +
        (lane % 3) * 8
      : soft
        ? soft.y - 24
        : (zoneRects.length
            ? Math.max(...zoneRects.map((z) => z.y + z.h))
            : Math.max(sourceY, targetY)) + BUS_CLEARANCE;

  candidates.push(
    wrapOuter(
      sourceX,
      sourceY,
      targetX,
      targetY,
      exitX,
      dropX,
      overY,
      underY,
      worldRight,
      srcPos,
      srcZone,
      tgtZone
    )
  );
  candidates.push(
    wrapOuter(
      sourceX,
      sourceY,
      targetX,
      targetY,
      exitX,
      dropX,
      overY,
      underY,
      worldLeft,
      srcPos,
      srcZone,
      tgtZone
    )
  );

  let best =
    sameZone
      ? localTopIn(sourceX, sourceY, targetX, targetY, exitX, tgtZone, srcPos)
      : topToTop
        ? topToTopBus(sourceX, sourceY, targetX, targetY, buses[0] ?? overY)
        : topDoorPath(
            sourceX,
            sourceY,
            targetX,
            targetY,
            exitX,
            dropX,
            buses[0] ?? overY,
            srcZone,
            tgtZone,
            srcPos
          );
  let bestScore = Infinity;
  for (const pts of candidates) {
    if (polylineHits(pts, cardRects, HIT_PAD, skipEnds)) continue;
    if (polylineBreaksZones(pts, zoneRects)) continue;
    if (!isLegalTopPlug(pts, tgtCard)) continue;
    const score = routeLength(pts);
    if (score < bestScore) {
      bestScore = score;
      best = pts;
    }
  }

  return buildOrthogonal(best);
}

/** Cards: Right output → Top input. Zone trunks: Top → Top. */
export function preferredHandles(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): { sourcePosition: Position; targetPosition: Position } {
  void sourceX;
  void sourceY;
  void targetX;
  void targetY;
  return {
    sourcePosition: Position.Right,
    targetPosition: Position.Top,
  };
}
