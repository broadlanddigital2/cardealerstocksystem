// Drizzle over Neon's serverless HTTP driver (one fetch per query), reading
// DATABASE_URL lazily because on Workers the environment arrives per request.
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let cached: { url: string; db: NeonHttpDatabase<typeof schema> } | undefined;

export function getDb(): NeonHttpDatabase<typeof schema> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!cached || cached.url !== url) cached = { url, db: drizzle({ client: neon(url), schema }) };
  return cached.db;
}

export * from "./schema";
