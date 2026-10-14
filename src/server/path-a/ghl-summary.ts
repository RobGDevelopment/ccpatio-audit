/**
 * Pure builder for GHL Opportunity Build Summary (Task 8.1).
 * Pure: no I/O, no network, deterministic sorted output.
 * NEVER includes prices, tokens, signed URLs, cut-card URLs or secrets.
 */

export const MAX_GHL_SUMMARY_LENGTH = 4000;

export type GhlSummaryBomLine = {
  childSku: string;
  quantity: string | number;
  unitOfMeasure?: string | null;
};

export type GhlSummaryItem = {
  globalSku: string;
  quantity: number;
  displayName?: string | null;
  status: string;
  finalizedDossierHash?: string | null;
  bomLines?: GhlSummaryBomLine[];
};

export type GhlSummaryInput = {
  opportunityId: string;
  opportunityName?: string | null;
  sagaStatus: string;
  katanaOrderNo?: string | null;
  katanaMoIds?: number[] | null;
  items: GhlSummaryItem[];
  appUrl?: string;
};

export function formatSagaStateLabel(status: string): string {
  switch (status) {
    case "AWAITING_DEPOSIT":
      return "AWAITING DEPOSIT";
    case "COMPLETED":
      return "RELEASED TO PRODUCTION";
    case "IN_PROGRESS":
      return "RELEASING TO PRODUCTION";
    case "FAILED":
    case "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION":
      return "MANUAL REVIEW REQUIRED";
    default:
      return "DESIGNING";
  }
}

export function buildGhlOpportunitySummary(input: GhlSummaryInput): string {
  const {
    opportunityId,
    opportunityName,
    sagaStatus,
    katanaOrderNo,
    katanaMoIds,
    items,
    appUrl,
  } = input;

  // No invented host: a wrong environment's URL in a customer-facing GHL record is worse than
  // no link. The deep link is emitted only when the caller supplies the configured app URL.
  const baseUrl = appUrl?.trim().replace(/\/$/, "");
  const deepLink = baseUrl
    ? `${baseUrl}/admin/path-a?opp=${encodeURIComponent(opportunityId)}`
    : null;
  const title = opportunityName?.trim() || opportunityId;
  const statusLabel = formatSagaStateLabel(sagaStatus);

  const headerLines: string[] = [
    `=== CC CUSTOM BUILD SUMMARY ===`,
    `Opportunity: ${title}`,
    `Status: ${statusLabel}`,
  ];
  if (deepLink) {
    headerLines.push(`Dashboard: ${deepLink}`);
  }

  if (katanaOrderNo) {
    headerLines.push(`Katana Order: ${katanaOrderNo}`);
  }
  if (katanaMoIds && katanaMoIds.length > 0) {
    headerLines.push(`Katana MOs: ${katanaMoIds.join(", ")}`);
  }

  const sortedItems = [...items].sort((a, b) =>
    a.globalSku.localeCompare(b.globalSku),
  );

  const itemSections: string[] = [];
  for (const item of sortedItems) {
    const lines: string[] = [];
    const nameStr = item.displayName?.trim() || "Custom Item";
    const hashStr = item.finalizedDossierHash
      ? ` [dossier:${item.finalizedDossierHash.slice(0, 10)}]`
      : "";
    const statusText = (item.status ?? "unknown").toUpperCase();
    lines.push(`• ${item.globalSku} x${item.quantity} — ${nameStr} — ${statusText}${hashStr}`);

    if (item.bomLines && item.bomLines.length > 0) {
      const sortedBom = [...item.bomLines].sort((a, b) =>
        a.childSku.localeCompare(b.childSku),
      );
      for (const bom of sortedBom) {
        const uom = bom.unitOfMeasure?.trim() || "ea";
        lines.push(`    - ${bom.childSku}: ${bom.quantity} ${uom}`);
      }
    }
    itemSections.push(lines.join("\n"));
  }

  let fullText = `${headerLines.join("\n")}\n\nITEMS:\n${itemSections.join("\n\n")}`;

  if (fullText.length > MAX_GHL_SUMMARY_LENGTH) {
    const truncationNotice = deepLink
      ? `\n\n... [truncated, see MDM: ${deepLink}]`
      : `\n\n... [truncated]`;
    const available = MAX_GHL_SUMMARY_LENGTH - truncationNotice.length;
    fullText = fullText.slice(0, available) + truncationNotice;
  }

  return fullText;
}
