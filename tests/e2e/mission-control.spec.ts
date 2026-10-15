/**
 * Mission Control, in a real browser.
 *
 * Mission Control refuses the e2e god-mode cookie on purpose (src/proxy.ts), so this spec creates a REAL
 * Supabase user with a REAL `user_roles` SuperAdmin row, signs in through the login form, and removes both
 * afterwards. The Catalog Hygiene Radar product is a namespaced seed row, never a real catalog row.
 *
 * It proves, against the running app and the real database:
 *   - the Soft UI renders (light canvas, white floating cards), with no dark-theme leftovers
 *   - the seven traffic lights render and refresh
 *   - the Catalog Hygiene Radar flags a bare product
 *   - the Quick Access modal opens, validates, cancels, saves, writes the catalog row and one audit row
 *     per changed field, updates the radar in place, and is idempotent on a second save
 *   - an anonymous visitor and the god-mode cookie are both bounced away from /mission-control
 *
 * It never presses "Send" on the Raise alert modal, because that pages the on-call operator.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { injectGodModeSession } from "./helpers/god-mode-auth";
import {
  cleanupHygieneProduct,
  closePhase13Db,
  createMissionControlOperator,
  deleteMissionControlOperator,
  newRunToken,
  readHygieneState,
  seedHygieneProduct,
  type QaOperator,
} from "./helpers/phase13-seed";

const BASE_URL = "http://localhost:3000";
const run = newRunToken();

test.describe.configure({ mode: "serial" });

test.describe("Mission Control (Soft UI, Hygiene Radar, Quick Access)", () => {
  test.setTimeout(180_000);

  let operator: QaOperator;
  let product: { sku: string; name: string; prefill: { sku: string; name: string } };
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    await cleanupHygieneProduct(run);
    operator = await createMissionControlOperator(run);
    product = await seedHygieneProduct(run);

    context = await browser.newContext({ baseURL: BASE_URL });
    page = await context.newPage();
    await page.goto("/?next=%2Fmission-control");
    await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 60_000 });
    await page.fill('input[name="email"]', operator.email);
    await page.fill('input[name="password"]', operator.password);
    await page.getByRole("button", { name: /Enter Launchpad/ }).click();
    await page.waitForURL(/\/mission-control/, { timeout: 120_000 });
  });

  test.afterAll(async () => {
    try {
      await context?.close();
    } finally {
      try {
        await cleanupHygieneProduct(run);
      } finally {
        try {
          if (operator) await deleteMissionControlOperator(operator);
        } finally {
          await closePhase13Db();
        }
      }
    }
  });

  const radar = () => page.getByTestId("hygiene-radar");
  const row = (sku = product.sku) => page.getByTestId(`hygiene-row-${sku}`);
  const modal = () => page.getByTestId("hygiene-modal");

  async function openQuickAccess(target: { sku: string; name: string } = product) {
    await page.getByTestId(`hygiene-quick-access-${target.sku}`).click();
    await expect(modal()).toBeVisible();
    await expect(modal().getByRole("heading", { name: target.name })).toBeVisible();
  }

  /** Waits for a rescan to finish (the button is "Scanning..." while it runs). */
  async function radarSettled() {
    await expect(radar().getByRole("button", { name: "Scanning..." })).toBeHidden({ timeout: 90_000 });
    await expect(radar().getByRole("button", { name: "Rescan" })).toBeEnabled({ timeout: 90_000 });
  }

  async function tile(label: string): Promise<number> {
    const caption = radar().locator("div.text-xs.text-slate-500").filter({ hasText: new RegExp(`^${label}$`) });
    await expect(caption).toHaveCount(1);
    return Number(await caption.locator("xpath=preceding-sibling::div[1]").innerText());
  }
  test("renders the Soft UI shell for a signed-in SuperAdmin", async ({}, testInfo) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Mission Control");
    await expect(page.getByRole("heading", { name: "System Diagnostics" })).toBeVisible();
    await expect(page.getByText("SuperAdmin", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to Launchpad/ })).toBeVisible();

    // Soft UI: #FAFAFA canvas, white cards with a diffuse shadow.
    const canvas = page.locator("div.min-h-screen").first();
    await expect(canvas).toHaveCSS("background-color", "rgb(250, 250, 250)");
    const card = page.getByTestId("system-health");
    await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");
    expect(await card.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");

    // Dark-theme leftovers must be gone from the rendered DOM.
    // (The root layout's <body> carries the app-wide dark class for the other sections; Mission Control paints
    // its own light canvas over the whole viewport, which is asserted below. Only the canvas subtree is scanned.)
    const darkLeftovers = await canvas.evaluate((root) =>
      Array.from(
        root.querySelectorAll('[class*="bg-black"], [class*="zinc-9"], [class*="zinc-8"], [class*="zinc-7"]'),
      ).map((el) => `${el.tagName.toLowerCase()} class="${(el.getAttribute("class") ?? "").slice(0, 160)}"`),
    );
    expect(darkLeftovers).toEqual([]);
    const viewport = page.viewportSize()!;
    const box = (await canvas.boundingBox())!;
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(box.height).toBeGreaterThanOrEqual(viewport.height);

    for (const heading of ["System Health", "Catalog Hygiene Radar", "Active Issues Inbox", "Connection Manager"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    await testInfo.attach("mission-control-soft-ui", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test("renders the seven traffic lights and refreshes them", async () => {
    const health = page.getByTestId("system-health");
    await expect(health.locator('[data-testid^="lamp-"]')).toHaveCount(7, { timeout: 90_000 });
    for (const id of ["qbo", "ghl", "katana", "dlq", "wordpress", "woocommerce", "clover"]) {
      await expect(health.getByTestId(`lamp-${id}`)).toBeVisible();
    }
    const dots = health.getByRole("img");
    await expect(dots).toHaveCount(7);
    for (const label of await dots.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""))) {
      expect(label).toMatch(/ (green|amber|red)$/);
    }

    await health.getByRole("button", { name: "Refresh" }).click();
    await expect(health.getByRole("button", { name: "Refreshing..." })).toBeVisible();
    await expect(health.getByRole("button", { name: "Refresh" })).toBeEnabled({ timeout: 90_000 });
    await expect(health.locator('[data-testid^="lamp-"]')).toHaveCount(7);
  });

  test("the inbox and connection manager render, and the alert modal opens and cancels", async () => {
    await expect(page.getByTestId("issues-inbox")).toBeVisible();
    await expect(page.getByTestId("connection-manager")).toBeVisible();

    await page.getByRole("button", { name: "Raise alert" }).click();
    const alert = page.getByRole("dialog", { name: "Raise an ops alert" });
    await expect(alert).toBeVisible();
    await expect(alert.getByLabel("Message")).toBeVisible();
    await alert.getByRole("button", { name: "Cancel" }).click();
    await expect(alert).toBeHidden();
  });

  test("the Catalog Hygiene Radar flags the seeded product with all three issues", async () => {
    await expect(radar().getByText("Flagged products", { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(row()).toBeVisible();
    await expect(row()).toContainText(product.name);
    await expect(row()).toContainText(product.sku);
    for (const issue of ["Missing MSRP", "Blank dimensions", "Missing 3D asset"]) {
      await expect(row().getByText(issue, { exact: true })).toBeVisible();
    }
    // The stat tiles are numbers, and at least this one product is flagged under each issue.
    for (const label of ["Flagged products", "Missing MSRP", "Blank dimensions", "Missing 3D asset"]) {
      expect(await tile(label), label).toBeGreaterThanOrEqual(1);
    }
  });
  test("Quick Access opens, rejects bad input with an inline alert, and writes nothing", async () => {
    await openQuickAccess();
    await expect(modal().getByText(product.sku)).toBeVisible();
    await expect(modal().getByText("Missing", { exact: true })).toBeVisible(); // 3D asset badge

    await modal().locator("#hygiene-msrp").fill("free");
    await modal().locator("#hygiene-length").fill("84");
    await modal().getByRole("button", { name: "Save changes" }).click();
    await expect(modal().getByRole("alert")).toContainText("MSRP must be a dollar amount");
    await expect(modal()).toBeVisible();

    const state = await readHygieneState(run);
    expect(state.catalog).toBeUndefined();
    expect(state.audit).toHaveLength(0);

    // A value together with Not Applicable is refused too.
    await modal().locator("#hygiene-msrp").fill("1299");
    await modal().getByRole("checkbox").nth(0).check();
    await expect(modal().locator("#hygiene-length")).toBeDisabled();
    await modal().getByRole("checkbox").nth(0).uncheck();
    await expect(modal().locator("#hygiene-length")).toBeEnabled();

    await page.keyboard.press("Escape");
    await expect(modal()).toBeHidden();
    expect((await readHygieneState(run)).audit).toHaveLength(0);
  });

  test("Quick Access Cancel closes the modal and writes nothing", async () => {
    await openQuickAccess();
    await modal().locator("#hygiene-msrp").fill("777");
    await modal().getByRole("button", { name: "Cancel" }).click();
    await expect(modal()).toBeHidden();
    const state = await readHygieneState(run);
    expect(state.catalog).toBeUndefined();
    expect(state.audit).toHaveLength(0);
  });

  test("Quick Access saves: the catalog row and one audit row per field are written, and the radar updates in place", async () => {
    await radarSettled();
    const before = {
      msrp: await tile("Missing MSRP"),
      dimensions: await tile("Blank dimensions"),
    };

    await openQuickAccess();
    await modal().locator("#hygiene-msrp").fill("$1,299");
    await modal().locator("#hygiene-length").fill("84");
    await modal().locator("#hygiene-depth").fill("36");
    await modal().getByRole("checkbox").nth(2).check(); // height: Not Applicable
    await expect(modal().locator("#hygiene-height")).toBeDisabled();
    await modal().getByRole("button", { name: "Save changes" }).click();

    await expect(modal()).toBeHidden({ timeout: 60_000 });

    // The radar rescanned in place. The product now has only the 3D gap, so it ranks below the 100 worst
    // products and may leave the list: either way it must no longer show a price or dimension issue,
    // and the two tile totals must have dropped.
    await radarSettled();
    await expect(row().getByText("Missing MSRP", { exact: true })).toHaveCount(0);
    await expect(row().getByText("Blank dimensions", { exact: true })).toHaveCount(0);
    expect(await tile("Missing MSRP")).toBeLessThan(before.msrp);
    expect(await tile("Blank dimensions")).toBeLessThan(before.dimensions);

    // The database, not the DOM, is the proof.
    const state = await readHygieneState(run);
    expect(state.catalog).toMatchObject({
      global_sku: product.sku,
      msrp: "1299.00",
      length: "84",
      depth: "36",
      na_fields: ["height"],
      updated_by: operator.email,
    });
    expect(state.audit.map((entry) => entry.field).sort()).toEqual(["depth", "length", "msrp", "na_fields"]);
    for (const entry of state.audit) {
      expect(entry).toMatchObject({
        operator_email: operator.email,
        operator_name: "Mission Control (SuperAdmin)",
        global_sku: product.sku,
      });
    }
    expect(state.audit.find((entry) => entry.field === "msrp")).toMatchObject({
      old_value: null,
      new_value: "1299.00",
    });
  });

  test("Quick Access prefills from the stored row, and saving it unchanged writes nothing", async () => {
    const target = product.prefill;
    await page.getByRole("button", { name: "Rescan" }).click();
    await radarSettled();
    await expect(row(target.sku)).toBeVisible();
    // Length and height are stored; price and depth are not.
    for (const issue of ["Missing MSRP", "Blank dimensions", "Missing 3D asset"]) {
      await expect(row(target.sku).getByText(issue, { exact: true })).toBeVisible();
    }
    const before = await readHygieneState(run, "PREFILL");
    expect(before.catalog).toMatchObject({ length: "84", height: "32", msrp: null, depth: null });

    await openQuickAccess(target);
    await expect(modal().locator("#hygiene-msrp")).toHaveValue("");
    await expect(modal().locator("#hygiene-length")).toHaveValue("84");
    await expect(modal().locator("#hygiene-depth")).toHaveValue("");
    await expect(modal().locator("#hygiene-height")).toHaveValue("32");
    await modal().getByRole("button", { name: "Save changes" }).click();
    await expect(modal()).toBeHidden({ timeout: 60_000 });

    const after = await readHygieneState(run, "PREFILL");
    expect(after.audit).toHaveLength(0);
    expect(after.catalog!.updated_at.getTime()).toBe(before.catalog!.updated_at.getTime());
    expect(after.catalog).toMatchObject({ length: "84", height: "32", msrp: null, depth: null });

    // Now a real change on the same product: depth only. Exactly one field is audited.
    await radarSettled();
    await openQuickAccess(target);
    await modal().locator("#hygiene-depth").fill("30.5");
    await modal().getByRole("button", { name: "Save changes" }).click();
    await expect(modal()).toBeHidden({ timeout: 60_000 });
    const changed = await readHygieneState(run, "PREFILL");
    expect(changed.catalog).toMatchObject({ length: "84", height: "32", depth: "30.5", msrp: null });
    expect(changed.audit.map((entry) => [entry.field, entry.old_value, entry.new_value])).toEqual([
      ["depth", null, "30.5"],
    ]);
  });
});

test.describe("Mission Control access control", () => {
  test("an anonymous visitor is sent to the login page", async ({ page }) => {
    await page.goto("/mission-control");
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.getByRole("heading", { name: "System Diagnostics" })).toHaveCount(0);
  });

  test("the e2e god-mode cookie does NOT open Mission Control", async ({ page, context }) => {
    await injectGodModeSession(context);
    await page.goto("/mission-control");
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.getByRole("heading", { name: "System Diagnostics" })).toHaveCount(0);
  });
});
