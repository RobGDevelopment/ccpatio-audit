/**
 * Provision a SuperAdmin (god-mode) login against live Supabase Auth.
 *
 * Usage (from repo root):
 *   GODMODE_EMAIL=you@example.com GODMODE_PASSWORD='…' npx tsx scripts/seed-godmode-superadmin.ts
 *
 * Never commit the password. Role is stored in public.user_roles and
 * auth.app_metadata (not user_metadata).
 */
import { loadEnvConfig } from "@next/env";
import { createClient, type User } from "@supabase/supabase-js";
import postgres from "postgres";
import {
  createSupabaseFetch,
  getSupabasePublishableKey,
  getSupabaseSecretKey,
  getSupabaseUrl,
} from "../src/lib/supabase-env";

loadEnvConfig(process.cwd());

const DEFAULT_EMAIL = "rjg.cal@gmail.com";
const ROLE = "SuperAdmin" as const;

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function requireEnv(name: string, fallback?: string): string {
  const value = (process.env[name] ?? fallback ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

type AuthAdminList = {
  auth: {
    admin: {
      listUsers: (params: { page: number; perPage: number }) => Promise<{
        data: { users: User[] };
        error: { message: string } | null;
      }>;
    };
  };
};

async function findUserByEmail(
  admin: AuthAdminList,
  email: string,
): Promise<User | null> {
  const normalized = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const match = data.users.find(
      (user) => user.email?.toLowerCase() === normalized,
    );
    if (match) return match;
    if (data.users.length < 200) break;
  }
  return null;
}

async function upsertRoleAndOperator(
  userId: string,
  email: string,
): Promise<void> {
  const url = process.env.POSTGRES_URL?.trim();
  if (!url) {
    throw new Error("POSTGRES_URL is not set");
  }
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    await sql`
      insert into public.user_roles (id, role, created_at, updated_at)
      values (${userId}::uuid, ${ROLE}::public.user_role, now(), now())
      on conflict (id) do update
      set role = excluded.role, updated_at = now()
    `;
    await sql`
      insert into public.pim_operators (email, display_name, registered_at, last_seen_at)
      values (${email}, ${"God Mode SuperAdmin"}, now(), now())
      on conflict (email) do update
      set display_name = excluded.display_name, last_seen_at = now()
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const email = (
    argValue("--email") ||
    process.env.GODMODE_EMAIL ||
    DEFAULT_EMAIL
  )
    .trim()
    .toLowerCase();
  const password = argValue("--password") || process.env.GODMODE_PASSWORD || "";
  if (!password) {
    throw new Error(
      "Pass GODMODE_PASSWORD or --password. Do not hardcode it in the repo.",
    );
  }

  const supabaseUrl = getSupabaseUrl();
  const secretKey = getSupabaseSecretKey();
  const publishableKey = getSupabasePublishableKey();
  if (!supabaseUrl || !secretKey || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (or SERVICE_ROLE), or publishable/anon key",
    );
  }
  requireEnv("POSTGRES_URL");

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createSupabaseFetch(secretKey) },
  });

  const existing = await findUserByEmail(admin, email);
  let user: User;

  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      app_metadata: {
        ...((existing.app_metadata as Record<string, unknown> | undefined) ?? {}),
        role: ROLE,
        god_mode: true,
      },
    });
    if (error || !data.user) {
      throw new Error(`Failed to update user: ${error?.message ?? "unknown"}`);
    }
    user = data.user;
    console.log(`Updated existing SuperAdmin ${email} (${user.id})`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: ROLE, god_mode: true },
    });
    if (error || !data.user) {
      throw new Error(`Failed to create user: ${error?.message ?? "unknown"}`);
    }
    user = data.user;
    console.log(`Created SuperAdmin ${email} (${user.id})`);
  }

  await upsertRoleAndOperator(user.id, email);
  console.log(`Granted user_roles.role=${ROLE}`);

  const anon = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createSupabaseFetch(publishableKey) },
  });
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !session.user) {
    throw new Error(
      `Password login proof failed: ${signInError?.message ?? "no user"}`,
    );
  }

  const { data: roleRow, error: roleError } = await anon
    .from("user_roles")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (roleError || roleRow?.role !== ROLE) {
    throw new Error(
      `Role proof failed: ${roleError?.message ?? `got ${roleRow?.role}`}`,
    );
  }

  await anon.auth.signOut();
  console.log(`Login proof OK — ${email} is ${ROLE} and can read own role via RLS`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
