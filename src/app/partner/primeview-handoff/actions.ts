"use server";

import { authenticatePrimeviewHandoffToken } from "@/lib/primeview-handoff-auth";
import {
  buildPartnerDryRunPreview,
  buildPartnerWooDiagnostic,
  probePartnerWooStaging,
  type PartnerWooProbe,
} from "@/server/ecommerce/primeview-handoff-ssot";

function gate(token: string) {
  return authenticatePrimeviewHandoffToken(token);
}

/** Live Woo staging re-probe — partner token only; zero outbound writes. */
export async function partnerRetestWooStaging(
  token: string,
): Promise<{ ok: true; probe: PartnerWooProbe } | { ok: false; error: string }> {
  const auth = gate(token);
  if (!auth.ok) return { ok: false, error: auth.reason };
  const probe = await probePartnerWooStaging();
  return { ok: true, probe };
}

/** Copy-ready CCP-DIAG-WOO-* report for PrimeView engineers. */
export async function partnerCopyWooDiagnostic(
  token: string,
): Promise<{ ok: true; report: string } | { ok: false; error: string }> {
  const auth = gate(token);
  if (!auth.ok) return { ok: false, error: auth.reason };
  const probe = await probePartnerWooStaging();
  return { ok: true, report: buildPartnerWooDiagnostic(probe) };
}

/** Read-only Woo REST dry-run payload for a Certified SKU or finish. */
export async function partnerDryRunPayload(
  token: string,
  sku: string,
): Promise<
  | { ok: true; preview: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const auth = gate(token);
  if (!auth.ok) return { ok: false, error: auth.reason };
  if (!sku?.trim()) return { ok: false, error: "SKU required." };
  return buildPartnerDryRunPreview(sku.trim());
}
