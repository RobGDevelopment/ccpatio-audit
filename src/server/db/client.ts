import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type MiddlewareDb = PostgresJsDatabase<typeof schema>;

let queryClient: ReturnType<typeof postgres> | null = null;
let dbSingleton: MiddlewareDb | null = null;

/** Lazy connect so `next build` can import routes without POSTGRES_URL. */
export function getDb(): MiddlewareDb {
  if (dbSingleton) return dbSingleton;
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is not set");
  }
  queryClient = postgres(url);
  dbSingleton = drizzle(queryClient, { schema });
  return dbSingleton;
}

export async function closeDb(): Promise<void> {
  if (queryClient) {
    await queryClient.end({ timeout: 5 });
    queryClient = null;
    dbSingleton = null;
  }
}
