/**
 * Ghost Customer — Order Desk through Freeze & Send.
 *
 * Creates a GoHighLevel contact and opportunity, holds one in-stock Bravada
 * unit, drives the embed in headless Chromium, then checks the revision and
 * the opportunity value. Cleanup runs even when a step fails.
 *
 * The app must already be listening on http://localhost:3000.
 *   npm run qa:ghost-customer
 *
 * Requires GHL_EMBED_SECRET, GHL_GHOST_USER_ID, the private integration
 * token, GHL_LOCATION_ID, POSTGRES_URL, and Katana credentials.
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { chromium, type Browser, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { LIVE_IDS } from "@/config/liveIds";
import { closeDb, getDb } from "@/server/db/client";
import {
  delivery_days,
  delivery_zones,
  finished_goods_catalog,
  logistics_profiles,
  quote_revisions,
  quotes,
  sku_mappings,
} from "@/server/db/schema";
import { asGhlRecord, ghlDelete, ghlGet, ghlPost, readGhlConfig } from "@/server/ghl/private-api";
import { fetchHoldOpportunity, type HoldActor } from "@/server/ghl/hold-actor";
import { phoenixToday } from "@/server/quotes/phoenix-date";
import { snapshotMsrp } from "@/server/quotes/msrp";
import { amountDue } from "@/server/quotes/send-quote";
import { createHold } from "@/server/stock/create-hold";
import { releaseHoldById } from "@/server/stock/release-hold";

loadEnvConfig(process.cwd());

const APP_ORIGIN = "http://localhost:3000";
const DEST_ZIP = "85255";
const ZONE_CODE = "SCOTTSDALE";
const TRUCK_CODE = "QA-GHOST";
const PREFERRED_SKU = "FIN-BRV-CLB-CHA-34X34";
const FROZEN_COPY = "Quote Frozen. GHL Opportunity Updated.";
const SALES_PIPELINE_ID = LIVE_IDS.GHL.pipelines.Scottsdale___Sales__AZ_;

const created = {
  contactId: "",
  opportunityId: "",
  holdId: "",
  sku: "",
};

let failed = false;
let browser: Browser | null = null;
let page: Page | null = null;

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function step(name: string, run: () => Promise<string>): Promise<void> {
  if (failed) {
    console.log(`[FAIL] ${name} — skipped`);
    return;
  }
  try {
    const detail = await run();
    console.log(`[PASS] ${name} — ${detail}`);
  } catch (error: unknown) {
    failed = true;
    console.log(`[FAIL] ${name} — ${detailOf(error)}`);
  }
}

async function cleanupStep(name: string, run: () => Promise<string>): Promise<void> {
  try {
    const detail = await run();
    console.log(`[PASS] ${name} — ${detail}`);
  } catch (error: unknown) {
    failed = true;
    console.log(`[FAIL] ${name} — ${detailOf(error)}`);
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recordId(body: unknown, key: string): string {
  const root = asGhlRecord(body);
  const nested = asGhlRecord(root?.[key]) ?? root;
  const id = text(nested?.id);
  if (!id) throw new Error(`GoHighLevel did not return a ${key} id.`);
  return id;
}

function userInLocation(user: Record<string, unknown>, locationId: string): boolean {
  if (text(user.locationId) === locationId) return true;
  const roles = asGhlRecord(user.roles);
  const roleIds = roles?.locationIds;
  if (Array.isArray(roleIds) && roleIds.some((id) => String(id) === locationId)) return true;
  const permissions = asGhlRecord(user.permissions);
  const locations = permissions?.locations;
  return Array.isArray(locations) && locations.some((id) => String(id) === locationId);
}

function displayName(user: Record<string, unknown>): string {
  const name = text(user.name);
  if (name) return name;
  return `${text(user.firstName)} ${text(user.lastName)}`.trim();
}

function moneyCents(value: unknown): number | null {
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function phoenixTomorrow(): string {
  const [year, month, day] = phoenixToday().split("-").map(Number);
  const next = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, (day ?? 1) + 1));
  return next.toISOString().slice(0, 10);
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => asGhlRecord(row))
    .filter((row): row is Record<string, unknown> => Boolean(row));
}

async function assertServer(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${APP_ORIGIN}/api/health`, { signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new Error("Order Desk is not running at http://localhost:3000.");
  }
  if (!response.ok) throw new Error(`Health check returned ${response.status}.`);
}

type LocationUser = { id: string; name: string; email: string };

async function locationUsers(locationId: string): Promise<LocationUser[]> {
  const listed = await ghlGet(`/users/?locationId=${encodeURIComponent(locationId)}`);
  if (!listed.ok) throw new Error(listed.error);
  const root = asGhlRecord(listed.body);
  return records(root?.users).map((row) => ({
    id: text(row.id),
    name: displayName(row),
    email: text(row.email).toLowerCase(),
  }));
}

async function loadGhostActor(locationId: string): Promise<HoldActor> {
  const raw = process.env.GHL_GHOST_USER_ID?.trim() ?? "";
  if (!raw) throw new Error("GHL_GHOST_USER_ID is not set.");
  const users = await locationUsers(locationId);
  const exact = users.find((user) => user.id === raw || user.email === raw.toLowerCase());
  const contained = users.filter((user) => user.id && raw.includes(user.id));
  const chosen = exact ?? (contained.length === 1 ? contained[0] : undefined);
  if (!chosen?.id) {
    throw new Error(
      `GHL_GHOST_USER_ID is not a user in this location. Set it to one location user id (${users.length} users).`,
    );
  }
  const loaded = await ghlGet(`/users/${encodeURIComponent(chosen.id)}`);
  if (!loaded.ok) throw new Error(loaded.error);
  const root = asGhlRecord(loaded.body);
  const user = asGhlRecord(root?.user) ?? root;
  if (!user) throw new Error("GoHighLevel could not confirm the ghost user.");
  const returnedId = text(user.id);
  if (returnedId && returnedId !== chosen.id) {
    throw new Error("GoHighLevel returned a different user.");
  }
  if (!userInLocation(user, locationId)) {
    throw new Error("GHL_GHOST_USER_ID is not in this location.");
  }
  const name = displayName(user);
  if (!name) throw new Error("GoHighLevel did not return a user name.");
  return {
    ghlUserId: chosen.id,
    ghlUserName: name,
    ghlUserEmail: text(user.email) || null,
  };
}

type StockPick = { sku: string; variantId: number; profile: string };

const FALLBACK_PROFILE = {
  length_in: "34.0000",
  width_in: "34.0000",
  height_in: "31.0000",
  weight_lb: "85.0000",
  ltl_class: "250",
  lead_time_days: 0,
} as const;

type LogisticsIdentity = {
  variantId: number;
  weightLb: string | null;
  ltlClass: string | null;
};

async function readLogistics(sku: string): Promise<LogisticsIdentity | null> {
  const [row] = await getDb()
    .select({
      variantId: logistics_profiles.katana_variant_id,
      weightLb: logistics_profiles.weight_lb,
      ltlClass: logistics_profiles.ltl_class,
    })
    .from(logistics_profiles)
    .where(eq(logistics_profiles.variant_sku, sku))
    .limit(1);
  return row ?? null;
}

function stockFromLogistics(row: LogisticsIdentity | null): StockPick | null {
  const ltlClass = row?.ltlClass?.trim() ?? "";
  const weight = Number(row?.weightLb);
  if (!row || !ltlClass || !(weight > 0)) return null;
  const weightLb = String(row.weightLb);
  return {
    sku: PREFERRED_SKU,
    variantId: row.variantId,
    profile: `${weightLb} lb class ${ltlClass} variant ${row.variantId}`,
  };
}

async function assertCatalogPrice(sku: string): Promise<void> {
  const [row] = await getDb()
    .select({ msrp: finished_goods_catalog.msrp })
    .from(finished_goods_catalog)
    .where(sql`upper(${finished_goods_catalog.global_sku}) = ${sku}`)
    .limit(1);
  if (snapshotMsrp(row?.msrp).unitPrice == null) {
    throw new Error(`${sku} has no catalog MSRP.`);
  }
}

async function fallbackVariantId(sku: string): Promise<number> {
  const [row] = await getDb()
    .select({ variantId: sku_mappings.katana_variant_id })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (row?.variantId == null) {
    throw new Error(`No Katana variant mapping for ${sku}.`);
  }
  return row.variantId;
}

async function pickStock(): Promise<StockPick> {
  const sku = PREFERRED_SKU;
  await assertCatalogPrice(sku);
  const existing = await readLogistics(sku);
  const ready = stockFromLogistics(existing);
  if (ready) return ready;
  if (existing) {
    throw new Error(`${sku} logistics profile is missing weight or freight class.`);
  }

  await getDb()
    .insert(logistics_profiles)
    .values({
      katana_variant_id: await fallbackVariantId(sku),
      variant_sku: sku,
      ...FALLBACK_PROFILE,
    })
    .onConflictDoUpdate({
      target: logistics_profiles.variant_sku,
      set: { updated_at: new Date() },
    });

  const loaded = stockFromLogistics(await readLogistics(sku));
  if (!loaded) {
    throw new Error(`${sku} logistics profile could not be loaded after insert.`);
  }
  return loaded;
}

async function seedCapacity(): Promise<string> {
  const serviceDate = phoenixTomorrow();
  const db = getDb();
  await db
    .insert(delivery_zones)
    .values({ zip5: DEST_ZIP, zone_code: ZONE_CODE })
    .onConflictDoUpdate({
      target: delivery_zones.zip5,
      set: { zone_code: ZONE_CODE },
    });
  await db
    .insert(delivery_days)
    .values({
      service_date: serviceDate,
      truck_code: TRUCK_CODE,
      zone_code: ZONE_CODE,
      capacity_stops: 10,
      capacity_weight_lb: "10000.00",
    })
    .onConflictDoUpdate({
      target: [delivery_days.service_date, delivery_days.truck_code, delivery_days.zone_code],
      set: {
        capacity_stops: sql`greatest(${delivery_days.capacity_stops}, ${delivery_days.stops_booked} + 1, 10)`,
        capacity_weight_lb: sql`greatest(${delivery_days.capacity_weight_lb}, ${delivery_days.weight_booked_lb} + 500, 10000)`,
      },
    });
  return `${DEST_ZIP} ${ZONE_CODE} ${serviceDate} truck ${TRUCK_CODE}`;
}

async function firstPipelineStage(locationId: string): Promise<string> {
  const loaded = await ghlGet(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
  );
  if (!loaded.ok) throw new Error(loaded.error);
  const root = asGhlRecord(loaded.body);
  const pipelines = records(root?.pipelines);
  const pipeline = pipelines.find((row) => text(row.id) === SALES_PIPELINE_ID);
  if (!pipeline) throw new Error("Scottsdale sales pipeline was not returned.");
  const stages = records(pipeline.stages).sort((left, right) => {
    const leftPosition = Number(left.position ?? 0);
    const rightPosition = Number(right.position ?? 0);
    return leftPosition - rightPosition;
  });
  const stageId = text(stages[0]?.id);
  if (!stageId) throw new Error("Scottsdale sales pipeline has no stage.");
  return stageId;
}

async function readText(current: Page, testId: string): Promise<string> {
  const locator = current.getByTestId(testId);
  if ((await locator.count()) === 0) return "";
  return (await locator.first().innerText()).trim();
}

async function openOrderDesk(actor: HoldActor): Promise<void> {
  const secret = process.env.GHL_EMBED_SECRET?.trim() ?? "";
  if (!secret) throw new Error("GHL_EMBED_SECRET is not set.");
  const url = new URL("/embed/order-desk", APP_ORIGIN);
  url.searchParams.set("embedKey", secret);
  url.searchParams.set("ghlUserId", actor.ghlUserId);
  if (actor.ghlUserEmail) url.searchParams.set("ghlUserEmail", actor.ghlUserEmail);
  url.searchParams.set("opportunityId", created.opportunityId);

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  const lines = page.getByTestId("order-desk-lines");
  const error = page.getByTestId("order-desk-error");
  await lines.or(error).waitFor({ timeout: 30_000 });
  if (await error.isVisible()) throw new Error(await error.innerText());
  const lineText = await lines.innerText();
  if (!lineText.toUpperCase().includes(created.sku)) {
    throw new Error(`Quote lines did not include ${created.sku}.`);
  }
  const status = await readText(page, "order-desk-status");
  if (!/draft/i.test(status)) throw new Error(`Quote status was ${status || "missing"}.`);
}

async function freezeInBrowser(): Promise<void> {
  if (!page) throw new Error("The browser is not open.");
  const zip = page.getByTestId("order-desk-dest-zip");
  await zip.fill(DEST_ZIP);
  try {
    await page.waitForFunction(
      () => {
        const freight =
          document.querySelector('[data-testid="order-desk-freight-total"]')?.textContent ?? "";
        const promise =
          document.querySelector('[data-testid="order-desk-promise-date"]')?.textContent ?? "";
        const send = document.querySelector('[data-testid="order-desk-send"]');
        const enabled = send instanceof HTMLButtonElement && !send.disabled;
        return freight.includes("$") && promise.trim() !== "" && !promise.includes("—") && enabled;
      },
      undefined,
      { timeout: 45_000 },
    );
  } catch {
    const freight = await readText(page, "order-desk-freight-total");
    const promise = await readText(page, "order-desk-promise-date");
    const freightError = await readText(page, "order-desk-freight-error");
    const promiseError = await readText(page, "order-desk-promise-error");
    throw new Error(
      `Freight or promise did not settle. freight=${freight || "missing"} promise=${promise || "missing"} ${freightError} ${promiseError}`.trim(),
    );
  }
  await page.getByTestId("order-desk-send").click();
  const frozen = page.getByTestId("order-desk-frozen");
  const syncError = page.getByTestId("order-desk-ghl-sync-error");
  await frozen.or(syncError).waitFor({ timeout: 30_000 });
  if (await syncError.isVisible()) throw new Error(await syncError.innerText());
  const message = (await frozen.innerText()).trim();
  if (message !== FROZEN_COPY) throw new Error(`Success message was ${message || "missing"}.`);
}

async function assertRevision(): Promise<string> {
  const db = getDb();
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.ghl_opportunity_id, created.opportunityId))
    .limit(1);
  if (!quote) throw new Error("No quote row was stored.");
  if (quote.status !== "sent") throw new Error(`Quote status is ${quote.status}.`);
  if (!quote.current_revision_id) throw new Error("The quote has no current revision.");
  if (quote.ghl_sync_error) throw new Error(quote.ghl_sync_error);
  const [revision] = await db
    .select()
    .from(quote_revisions)
    .where(eq(quote_revisions.id, quote.current_revision_id))
    .limit(1);
  if (!revision) throw new Error("The revision row is missing.");
  if (revision.voided_at) throw new Error("The revision is voided.");
  const payload = asGhlRecord(revision.payload);
  const lines = payload?.lines;
  if (!payload || !Array.isArray(lines) || lines.length < 1) {
    throw new Error("The revision payload has no lines.");
  }
  if (text(payload.destZip) !== DEST_ZIP) {
    throw new Error(`Revision ZIP is ${text(payload.destZip) || "missing"}.`);
  }
  const due = amountDue(
    quote.merchandise_total ?? "",
    quote.freight_total ?? "",
    quote.deposit_pct ?? "",
  );
  if (!due || due !== revision.amount_due) {
    throw new Error(`amount_due is ${revision.amount_due}, expected ${due ?? "uncomputable"}.`);
  }
  return `sent revision ${revision.revision_no} amount_due ${revision.amount_due}`;
}

async function assertOpportunityValue(): Promise<string> {
  const db = getDb();
  const [quote] = await db
    .select({
      merchandise: quotes.merchandise_total,
      freight: quotes.freight_total,
    })
    .from(quotes)
    .where(eq(quotes.ghl_opportunity_id, created.opportunityId))
    .limit(1);
  if (!quote?.merchandise || !quote.freight) throw new Error("Quote totals are missing.");
  const expected = moneyCents(Number(quote.merchandise) + Number(quote.freight));
  const loaded = await ghlGet(`/opportunities/${encodeURIComponent(created.opportunityId)}`);
  if (!loaded.ok) throw new Error(loaded.error);
  const root = asGhlRecord(loaded.body);
  const opportunity = asGhlRecord(root?.opportunity) ?? root;
  const actual = moneyCents(opportunity?.monetaryValue);
  if (expected == null || actual == null || actual !== expected) {
    throw new Error(`Opportunity value ${String(opportunity?.monetaryValue)} did not match ${expected == null ? "the quote" : (expected / 100).toFixed(2)}.`);
  }
  return `monetary value ${(actual / 100).toFixed(2)}`;
}

async function cleanup(): Promise<void> {
  await cleanupStep("cleanup hold", async () => {
    if (!created.holdId) return "nothing to release";
    const outcome = await releaseHoldById(created.holdId, "qa-ghost");
    if (outcome !== "released") throw new Error(`release returned ${outcome}`);
    return created.holdId;
  });
  await cleanupStep("cleanup quote", async () => {
    if (!created.opportunityId) return "nothing to delete";
    await getDb().delete(quotes).where(eq(quotes.ghl_opportunity_id, created.opportunityId));
    return created.opportunityId;
  });
  await cleanupStep("cleanup logistics profile", async () => {
    return `${PREFERRED_SKU} left untouched`;
  });
  await cleanupStep("cleanup opportunity", async () => {
    if (!created.opportunityId) return "nothing to delete";
    const deleted = await ghlDelete(
      `/opportunities/${encodeURIComponent(created.opportunityId)}`,
      undefined,
    );
    if (!deleted.ok) throw new Error(deleted.error);
    return created.opportunityId;
  });
  await cleanupStep("cleanup contact", async () => {
    if (!created.contactId) return "nothing to delete";
    const deleted = await ghlDelete(
      `/contacts/${encodeURIComponent(created.contactId)}`,
      undefined,
    );
    if (!deleted.ok) throw new Error(deleted.error);
    return created.contactId;
  });
}

async function main(): Promise<void> {
  const config = readGhlConfig();
  if ("error" in config) throw new Error(config.error);
  const locationId = config.locationId;
  let actor: HoldActor | null = null;
  let stock: StockPick | null = null;

  await step("preflight", async () => {
    await assertServer();
    actor = await loadGhostActor(locationId);
    stock = await pickStock();
    created.sku = stock.sku;
    const capacity = await seedCapacity();
    return `${actor.ghlUserName} · ${stock.sku} · ${stock.profile} · ${capacity}`;
  });

  await step("ghl setup", async () => {
    const stageId = await firstPipelineStage(locationId);
    const email = `qa-ghost-${randomUUID()}@ccpatio.test`;
    const contact = await ghlPost("/contacts/", {
      locationId,
      firstName: "QA",
      lastName: "Ghost",
      name: "QA Ghost",
      email,
    });
    if (!contact.ok) throw new Error(contact.error);
    created.contactId = recordId(contact.body, "contact");
    const opportunity = await ghlPost("/opportunities/", {
      pipelineId: SALES_PIPELINE_ID,
      pipelineStageId: stageId,
      locationId,
      contactId: created.contactId,
      name: "QA Ghost",
      status: "open",
      monetaryValue: 0,
    });
    if (!opportunity.ok) throw new Error(opportunity.error);
    created.opportunityId = recordId(opportunity.body, "opportunity");
    return created.opportunityId;
  });

  await step("inventory hold", async () => {
    if (!actor || !stock) throw new Error("Preflight did not choose a user and SKU.");
    const opportunity = await fetchHoldOpportunity(created.opportunityId);
    if (!opportunity.ok) throw new Error(opportunity.error);
    const held = await createHold({
      variantId: stock.variantId,
      sku: stock.sku,
      qty: 1,
      note: "QA Ghost",
      actor,
      opportunity,
    });
    if (!held.ok) throw new Error(held.error);
    created.holdId = held.holdId;
    return `${held.orderNo} on ${stock.sku}`;
  });

  await step("order desk", async () => {
    if (!actor) throw new Error("The ghost user was not loaded.");
    await openOrderDesk(actor);
    return `${created.sku} is a draft line`;
  });

  await step("freeze and send", async () => {
    await freezeInBrowser();
    return FROZEN_COPY;
  });

  await step("database", async () => assertRevision());

  await step("ghl value", async () => assertOpportunityValue());
}

main()
  .catch((error: unknown) => {
    failed = true;
    console.log(`[FAIL] orchestrator — ${detailOf(error)}`);
  })
  .finally(async () => {
    await cleanup();
    await browser?.close().catch((error: unknown) => {
      failed = true;
      console.log(`[FAIL] cleanup browser — ${detailOf(error)}`);
    });
    await closeDb().catch((error: unknown) => {
      failed = true;
      console.log(`[FAIL] cleanup database — ${detailOf(error)}`);
    });
    // process.exit while libuv is still closing sockets aborts on Windows.
    await new Promise((resolve) => setTimeout(resolve, 250));
    process.exit(failed ? 1 : 0);
  });
