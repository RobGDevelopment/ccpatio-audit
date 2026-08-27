import { defineConfig } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const url = process.env.POSTGRES_URL;
if (!url) {
  throw new Error(
    "POSTGRES_URL is not set. Copy middleware/.env.example to middleware/.env.local and fill it in.",
  );
}

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
});
