"use client";

import { useMemo } from "react";
import { useTopologyStore } from "../topology/topologyStore";
import { kindLabel, seedProcessLinks, type ProcessLinkKind } from "../topology/processMap";
import { openIntegrationEditorForNode } from "../control/IntegrationEditorPanel";

function nodeTitle(
  id: string,
  graphNodes: { id: string; data?: Record<string, unknown> }[]
): string {
  const node = graphNodes.find((n) => n.id === id);
  const label = node?.data?.label;
  return typeof label === "string" && label.trim() ? label : id;
}

function KindBadge({ kind }: { kind: ProcessLinkKind }) {
  const label = kindLabel(kind);
  const color =
    kind === "satellite"
      ? "text-red-300 border-red-500/40 bg-red-500/10"
      : kind === "branch"
        ? "text-amber-200 border-amber-500/40 bg-amber-500/10"
        : "text-cyan-200 border-cyan-500/40 bg-cyan-500/10";
  return (
    <span
      className={`rounded px-1.5 py-px font-[family-name:var(--font-plex-mono)] text-[8px] uppercase tracking-[0.12em] ${color}`}
    >
      {label}
    </span>
  );
}

export function ConnectionMapPanel() {
  const walkthroughId = useTopologyStore((s) => s.walkthroughId);
  const selectedMapNodeId = useTopologyStore((s) => s.selectedMapNodeId);
  const pendingMapLink = useTopologyStore((s) => s.pendingMapLink);
  const graphNodes = useTopologyStore((s) => s.graphNodes);
  const processLinksByWalkthrough = useTopologyStore(
    (s) => s.processLinksByWalkthrough
  );
  const addProcessLink = useTopologyStore((s) => s.addProcessLink);
  const removeProcessLink = useTopologyStore((s) => s.removeProcessLink);
  const resetProcessLinks = useTopologyStore((s) => s.resetProcessLinks);
  const selectMapNode = useTopologyStore((s) => s.selectMapNode);
  const setPendingMapLink = useTopologyStore((s) => s.setPendingMapLink);

  const links = useMemo(() => {
    if (!walkthroughId) return [];
    const stored = processLinksByWalkthrough[walkthroughId];
    return stored ?? seedProcessLinks(walkthroughId);
  }, [walkthroughId, processLinksByWalkthrough]);

  const mountedIds = useMemo(
    () => new Set(graphNodes.map((n) => n.id)),
    [graphNodes]
  );

  const mappable = useMemo(
    () =>
      graphNodes.filter(
        (n) =>
          n.type !== "zone" &&
          n.type !== "gridTie" &&
          n.type !== "blankSlot"
      ),
    [graphNodes]
  );

  const selected = graphNodes.find((n) => n.id === selectedMapNodeId);
  const open = Boolean(walkthroughId && selectedMapNodeId && selected);

  const outgoing = links.filter(
    (l) => l.source === selectedMapNodeId && mountedIds.has(l.target)
  );
  const incoming = links.filter(
    (l) => l.target === selectedMapNodeId && mountedIds.has(l.source)
  );
  const usedAsTarget = new Set(outgoing.map((l) => l.target));
  const usedAsSource = new Set(incoming.map((l) => l.source));

  const addTargets = mappable.filter(
    (n) => n.id !== selectedMapNodeId && !usedAsTarget.has(n.id)
  );
  const addSources = mappable.filter(
    (n) => n.id !== selectedMapNodeId && !usedAsSource.has(n.id)
  );

  return (
    <>
      {pendingMapLink ? (
        <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-lg border border-cyan-400/50 bg-slate-950/95 px-3 py-1.5 text-[11px] text-cyan-100 shadow-lg">
          {pendingMapLink.role === "output"
            ? "Click a box to connect this OUTPUT → its INPUT"
            : "Click a box that should feed this INPUT"}
        </div>
      ) : null}

      <aside
        className={`absolute bottom-3 right-3 z-40 flex w-[22rem] max-h-[min(72vh,34rem)] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950/96 shadow-2xl backdrop-blur-md transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {open && selected ? (
          <>
            <div className="flex items-start justify-between gap-2 border-b border-slate-800 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-500">
                  Process map
                </div>
                <div className="truncate text-sm font-semibold text-slate-50">
                  {nodeTitle(selected.id, graphNodes)}
                </div>
                <div className="font-[family-name:var(--font-plex-mono)] text-[10px] text-slate-500">
                  {selected.id}
                </div>
              </div>
              <button
                type="button"
                onClick={() => selectMapNode(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <section className="mb-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
                    Output maps to
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingMapLink({
                        nodeId: selected.id,
                        role: "output",
                      })
                    }
                    className="rounded border border-cyan-500/40 px-1.5 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/15"
                  >
                    + Click to add
                  </button>
                </div>
                <p className="mb-2 text-[10px] leading-snug text-slate-500">
                  Highlighted wires belong to this box. Click a wire to disconnect it.
                </p>
                {outgoing.length === 0 ? (
                  <p className="rounded border border-dashed border-slate-700 px-2 py-2 text-[11px] text-slate-500">
                    No outputs yet. Add one so this phase has a next hop.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {outgoing.map((link) => (
                      <li
                        key={link.id}
                        className="flex items-start justify-between gap-2 rounded border border-slate-800 bg-slate-900/80 px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => selectMapNode(link.target)}
                            className="truncate text-left text-[12px] text-slate-100 hover:text-cyan-200"
                          >
                            {nodeTitle(link.target, graphNodes)}
                          </button>
                          <KindBadge kind={link.kind} />
                        </div>
                        <button
                          type="button"
                          title="Disconnect this output"
                          onClick={() =>
                            removeProcessLink(link.source, link.target)
                          }
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-red-300"
                        >
                          Disconnect
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <select
                  value=""
                  onChange={(e) => {
                    const target = e.target.value;
                    if (target) addProcessLink(selected.id, target);
                  }}
                  className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200 outline-none focus:border-cyan-500"
                >
                  <option value="">Add output…</option>
                  {addTargets.map((n) => (
                    <option key={n.id} value={n.id}>
                      {nodeTitle(n.id, graphNodes)}
                    </option>
                  ))}
                </select>
              </section>

              <section>
                <div className="mb-1.5 flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
                    Inputs
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingMapLink({
                        nodeId: selected.id,
                        role: "input",
                      })
                    }
                    className="rounded border border-cyan-500/40 px-1.5 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/15"
                  >
                    + Click to add
                  </button>
                </div>
                {incoming.length === 0 ? (
                  <p className="rounded border border-dashed border-slate-700 px-2 py-2 text-[11px] text-slate-500">
                    No inputs. Add a source that should enter this box.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {incoming.map((link) => (
                      <li
                        key={link.id}
                        className="flex items-start justify-between gap-2 rounded border border-slate-800 bg-slate-900/80 px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => selectMapNode(link.source)}
                            className="truncate text-left text-[12px] text-slate-100 hover:text-cyan-200"
                          >
                            {nodeTitle(link.source, graphNodes)}
                          </button>
                          <KindBadge kind={link.kind} />
                        </div>
                        <button
                          type="button"
                          title="Disconnect this input"
                          onClick={() =>
                            removeProcessLink(link.source, link.target)
                          }
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-red-300"
                        >
                          Disconnect
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <select
                  value=""
                  onChange={(e) => {
                    const source = e.target.value;
                    if (source) addProcessLink(source, selected.id);
                  }}
                  className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200 outline-none focus:border-cyan-500"
                >
                  <option value="">Add input…</option>
                  {addSources.map((n) => (
                    <option key={n.id} value={n.id}>
                      {nodeTitle(n.id, graphNodes)}
                    </option>
                  ))}
                </select>
              </section>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-3 py-2">
              <button
                type="button"
                onClick={() => resetProcessLinks()}
                className="rounded px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                Reset to blueprint
              </button>
              <button
                type="button"
                onClick={() =>
                  openIntegrationEditorForNode({
                    id: selected.id,
                    type: selected.type ?? "system",
                    position: selected.position,
                    data: selected.data,
                  })
                }
                className="rounded border border-slate-600 px-2 py-1 text-[10px] text-slate-300 hover:border-slate-400"
              >
                Integrations
              </button>
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}
