"use server";

import { requireMissionControlAuth } from "@/app/mission-control/actions";
import { logError } from "@/lib/log/structured";
import { readSystemLamps } from "@/server/mission-control/health-probes";

/**
 * Read-only system health for the traffic-light matrix: QuickBooks, GoHighLevel, Katana and the
 * Inngest dead-letter queue, plus the WordPress, WooCommerce and Clover channel lamps.
 *
 * Every probe is a select or a single GET. Nothing here can raise an alert or write a row, and a
 * probe that fails shows as an amber lamp instead of failing the dashboard.
 */
export async function getSystemHealthAction() {
  await requireMissionControlAuth();

  try {
    return { ok: true as const, data: await readSystemLamps() };
  } catch (error: unknown) {
    const ref = logError("mission-control-health", error);
    return { ok: false as const, error: `Failed to load system health. Reference ${ref}.` };
  }
}
