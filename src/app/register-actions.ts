"use server";

import { redirect } from "next/navigation";
import { logPimAudit } from "@/lib/pim-audit";
import { createClient } from "@/utils/supabase/server";

export type RegisterResult =
  | { ok: true }
  | { ok: false; error: string }
  | null;

export async function registerPimOperator(
  _prev: RegisterResult,
  formData: FormData,
): Promise<RegisterResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const nextPath = String(formData.get("next") ?? "/admin/quarantine").trim();
  
  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return { ok: false, error: error.message };
    }
    
    await logPimAudit({
      operatorEmail: email,
      action: "login",
      newValue: "Signed in via Supabase Auth",
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
      : "/admin/quarantine";
  
  redirect(safeNext);
}

export async function logoutPimOperator(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function staffSignUpAction(
  _prev: RegisterResult,
  formData: FormData,
): Promise<RegisterResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  if (!email.endsWith("@ccpatio.com")) {
    return { ok: false, error: "Access denied. Must use a @ccpatio.com email address." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    await logPimAudit({
      operatorEmail: email,
      action: "signup",
      newValue: "Self-serve signup via @ccpatio.com",
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Registration failed";
    return { ok: false, error: message };
  }

  redirect("/admin/dictionary");
}
