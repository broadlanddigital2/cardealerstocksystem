// Data access goes through Supabase's HTTPS API (see supabaseDb.ts) — no
// direct Postgres connection from the app. The Drizzle schema in ./schema is
// still the source of truth for tables and generated SQL migrations.
export {
  db,
  Database,
  DbError,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  ilike,
  isNull,
  isNotNull,
  inArray,
  and,
  or,
  asc,
  desc,
  equalsIgnoreCase,
  containsIgnoreCase,
  type Condition,
} from "./supabaseDb";

export * from "./schema";
