import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.log("missing url/key");
    return;
  }
  const res = await fetch(`${url}/auth/v1/settings`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  console.log("status", res.status);
  console.log("body", (await res.text()).slice(0, 300));
}

main().catch(console.error);
