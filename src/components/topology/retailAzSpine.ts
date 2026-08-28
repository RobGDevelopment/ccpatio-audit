/**
 * Retail AZ happy-path spine — shared by ELK priority and the town-grid
 * cinematic playlist so both engines follow the same mainline.
 *
 * Order is a Kahn topological sort of the live AND-join cone that reaches
 * `postcare`. Parallel CRM (Trade + Commercials + Warranty) and factory
 * (physical line ∥ GHL MFG mirrors) gates are interleaved so every
 * dependency has already executed before a node is visited.
 */
export const RETAIL_AZ_SPINE_ORDER: readonly string[] = [
  /* Zone 0 — parallel omnichannel intake (all required by ghl-hub) */
  "traffic-meta",
  "traffic-google",
  "traffic-organic",
  "chan-phone",
  "chan-sms",
  "chan-whatsapp",
  "chan-webchat",
  "chan-social",
  "chan-email",
  "showroom-walkin",
  /* Zone 1 */
  "ghl-hub",
  /* Zone 2 — Retail AZ lead path */
  "lead-new",
  "lead-interested",
  "lead-website",
  /* Zone 2 — Trade + Commercials (AND-join into CA on-site / SketchUp) */
  "trade-app",
  "trade-approved",
  "commercials-called-in",
  "commercials-qualifying",
  /* Zone 2 — Warranty Gate 1 bypass (AND-join into Ingress) */
  "war-discovery",
  "war-paused",
  "war-file-claim",
  "war-claim-filed",
  "war-claim-approved",
  "war-selecting-colors",
  "war-produce-fo",
  /* Zone 3 — AZ + CA design gates interleaved */
  "az-onsite",
  "az-sketchup-needed",
  "ca-onsite",
  "ca-sketchup-needed",
  /* Zone 4 — shared design / BOM / Gate 0.5 deposit */
  "field-survey",
  "sketchup",
  "az-sketchup-done",
  "ca-sketchup-done",
  "az-proposal",
  "ca-proposal",
  "az-finalize",
  "ca-finalize",
  "cut-lists",
  "bom-packet",
  "qbo-deposit-link",
  "clover-showroom",
  "payment-gateway",
  /* Zone 3 — Produce FO + Won (AZ, CA, Warranty) */
  "az-produce",
  "ca-produce",
  "produce-az",
  "produce-ca",
  "produce-warranty",
  /* Zone 5 — middleware */
  "ingress",
  "redis",
  "postgres",
  "inngest",
  "katana",
  /* Zone 6 — inventory + physical line ∥ GHL MFG mirrors */
  "inventory-alloc",
  "procurement-wait",
  "mfg-new",
  "mfg-purchasing",
  "wc-tube-stock",
  "wc-upholstery",
  "wc-chop-saw",
  "wc-cart-parts",
  "wc-tack",
  "wc-weld-out",
  "wc-grinder",
  "wc-marriage",
  "qc-a",
  "mfg-receiving",
  "wc-cart-blast",
  "wc-sandblast",
  "wc-powder",
  "qc-b",
  "wc-final",
  "qc-c",
  "mfg-production",
  "mfg-ready",
  "mfg-schedule-delivery",
  "mfg-delivery-scheduled",
  /* Zone 7 — all three dispatch terminals (AND-join into QBO) */
  "dispatch-box",
  "dispatch-willcall",
  "dispatch-3pl",
  "delivery",
  /* Zone 8 — invoice paid before Clover matcher */
  "qbo",
  "inv-waiting",
  "inv-paid",
  "clover",
  "reconciled",
  "postcare",
];

export const RETAIL_AZ_SPINE_NODE_IDS = new Set<string>(RETAIL_AZ_SPINE_ORDER);

export function isRetailAzSpineEdge(source: string, target: string): boolean {
  return (
    RETAIL_AZ_SPINE_NODE_IDS.has(source) && RETAIL_AZ_SPINE_NODE_IDS.has(target)
  );
}

export function operationalZoneKey(index: number): string {
  return `z${index}`;
}
