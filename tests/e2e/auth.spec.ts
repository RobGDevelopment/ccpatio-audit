import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";
import { createSupabaseFetch } from "../../src/lib/supabase-env";

// .env.test.local must win so auth admin calls hit the same local Supabase stack as the app under test.
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
dotenv.config({
  path: path.resolve(__dirname, "../../.env.test.local"),
  override: true,
});

const QA_EMAIL = "qa.test@ccpatio.com";
const QA_PASSWORD = "TestPassword123!";

/**
 * Auth admin calls are HTTP. This client does not open a Postgres pool.
 * Bounded pages so a large user list cannot stall teardown.
 */
function authAdmin(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: createSupabaseFetch(supabaseServiceKey) },
  });
}

async function deleteQaUser(email: string): Promise<void> {
  const supabase = authAdmin();
  if (!supabase) return;
  try {
    for (let page = 1; page <= 10; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error || !data?.users) return;
      const match = data.users.find((user) => user.email === email);
      if (match) {
        await supabase.auth.admin.deleteUser(match.id);
        return;
      }
      if (data.users.length < 200) return;
    }
  } catch {
    // Teardown must not replace the original failure or keep the worker alive.
  }
}

test.describe("Gatekeeper Auth Proof", () => {
  test("rejects unauthorized domain", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({
      timeout: 20_000,
    });

    await page.fill('input[name="email"]', "rogue.user@gmail.com");
    await page.fill('input[name="password"]', QA_PASSWORD);
    await page.click('button:has-text("Create @ccpatio.com Account")');

    await expect(
      page.locator("text=Access denied. Must use a @ccpatio.com email address."),
    ).toBeVisible();
  });

  test("accepts authorized domain, creates session, and redirects", async ({ page }) => {
    await deleteQaUser(QA_EMAIL);

    try {
      await page.goto("/");
      await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({
        timeout: 20_000,
      });

      await page.fill('input[name="email"]', QA_EMAIL);
      await page.fill('input[name="password"]', QA_PASSWORD);
      await page.click('button:has-text("Create @ccpatio.com Account")');

      // `commit` resolves when the dictionary URL is committed. It does not wait
      // for the full SKU table's load event, which is what burned the 120s budget
      // and aborted the dev compile.
      const outcome = await page.waitForFunction(
        () => {
          const error = document.querySelector(".text-rose-500")?.textContent?.trim() ?? "";
          if (error) return `error:${error}`;
          const heading = document.querySelector("h1")?.textContent ?? "";
          if (heading.includes("couldn") && heading.includes("load")) return "server-lost";
          if (location.pathname.startsWith("/admin/dictionary")) return "dictionary";
          const next = new URLSearchParams(location.search).get("next") ?? "";
          if (next.includes("/admin/dictionary")) return "bounced";
          return "";
        },
        null,
        { timeout: 45_000, polling: 250 },
      );
      const status = await outcome.jsonValue();
      if (typeof status === "string" && status.startsWith("error:")) {
        throw new Error(`Sign up failed with error displayed on page: ${status.slice("error:".length)}`);
      }
      if (status === "server-lost") {
        throw new Error(
          "Signup navigation died on the Next.js error page. The app server stopped serving /admin/dictionary.",
        );
      }
      if (status === "bounced") {
        throw new Error(
          "Signup returned to the login page. /admin/dictionary requires a session, and this signup did not leave one.",
        );
      }

      await expect(page).toHaveURL(/\/admin\/dictionary/, { timeout: 15_000 });
    } finally {
      await deleteQaUser(QA_EMAIL);
    }
  });
});
