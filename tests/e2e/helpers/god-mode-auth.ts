import path from "path";
import * as dotenv from "dotenv";
import type { BrowserContext } from "@playwright/test";
import {
  E2E_GODMODE_COOKIE,
  E2E_GODMODE_LOCAL_SECRET,
  signE2eGodModeCookie,
} from "../../../src/lib/e2e-god-mode";

dotenv.config({ path: path.resolve(process.cwd(), ".env.test.local") });
dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
  override: true,
});

export const GODMODE_EMAIL =
  process.env.E2E_GODMODE_EMAIL?.trim() || "godmode@ccpatio.com";

/**
 * Injects a signed `ccpatio_e2e_godmode` cookie plus `x-ccpatio-e2e-godmode`
 * header so Playwright never touches magic links. The HMAC uses the local
 * built-in secret (Next's proxy isolate does not receive E2E_GODMODE_SECRET).
 * Never set E2E_GODMODE_SECRET in Vercel production.
 */
export async function injectGodModeSession(context: BrowserContext): Promise<void> {
  const token = await signE2eGodModeCookie(GODMODE_EMAIL, E2E_GODMODE_LOCAL_SECRET);
  await context.addCookies([
    {
      name: E2E_GODMODE_COOKIE,
      value: token,
      url: "http://localhost:3000",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
  await context.setExtraHTTPHeaders({
    "x-ccpatio-e2e-godmode": token,
  });
}
