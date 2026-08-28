"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  isCcpatioEmail,
  PIM_SESSION_COOKIE,
  pimSessionCookieOptions,
  signPimSession,
} from "@/lib/pim-session";
import { getDb } from "@/server/db/client";
import { pim_operators } from "@/server/db/schema";
import { logPimAudit } from "@/lib/pim-audit";

export type RegisterResult =
  | { ok: true }
  | { ok: false; error: string }
  | null;

export async function registerPimOperator(
  _prev: RegisterResult,
  formData: FormData,
): Promise<RegisterResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const nextPath = String(formData.get("next") ?? "/").trim();

  if (!email || !displayName) {
    return { ok: false, error: "Email and display name are required." };
  }
  if (!isCcpatioEmail(email)) {
    return {
      ok: false,
      error: "Access is limited to @ccpatio.com email addresses.",
    };
  }

  try {
    const db = getDb();
    const now = new Date();
    await db
      .insert(pim_operators)
      .values({
        email,
        display_name: displayName,
        registered_at: now,
        last_seen_at: now,
      })
      .onConflictDoUpdate({
        target: pim_operators.email,
        set: {
          display_name: displayName,
          last_seen_at: now,
        },
      });

    const token = await signPimSession(email, displayName);
    const jar = await cookies();
    jar.set(PIM_SESSION_COOKIE, token, pimSessionCookieOptions(60 * 60 * 24 * 30));

    await logPimAudit({
      operatorEmail: email,
      operatorName: displayName,
      action: "register",
      field: null,
      newValue: "Signed in to PIM Dictionary",
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Registration failed";
    return { ok: false, error: message };
  }

  const safeNext =
    nextPath.startsWith("/") &&
    !nextPath.includes("//") &&
    !nextPath.startsWith("/api")
      ? nextPath
      : "/";
  redirect(safeNext);
}

export async function logoutPimOperator(): Promise<void> {
  const jar = await cookies();
  jar.delete(PIM_SESSION_COOKIE);
  redirect("/");
}
