// Database access: Drizzle over Neon (see client.ts). The Drizzle schema in
// ./schema is the source of truth for tables and generated SQL migrations.
import { ilike, sql, type AnyColumn, type SQL } from "drizzle-orm";

export { db, pgError, isUniqueViolation, type Database } from "./client";

export {
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
  sql,
} from "drizzle-orm";

/** Escape LIKE wildcards so user input is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Case-insensitive equality (e.g. registration numbers, emails). */
export const equalsIgnoreCase = (col: AnyColumn, value: string): SQL =>
  sql`lower(${col}) = lower(${value})`;

/** Case-insensitive "contains" search with wildcards in the input escaped. */
export const containsIgnoreCase = (col: AnyColumn, value: string): SQL =>
  ilike(col, `%${escapeLike(value)}%`);

/** A WHERE condition (kept for code written against the earlier data layer). */
export type Condition = SQL | undefined;

export * from "./schema";
