import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "@workspace/db";
import { db } from "@workspace/db";
import { assertInvoiceNumberAvailable, lockInvoiceNumbers, nextInvoiceNumber } from "../lib/invoiceNumbers";

// Server database tests use the standard Postgres driver (CI's Postgres service).
const testDb = vi.hoisted(() => ({ pool: undefined as undefined | { end(): Promise<void> } }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { createTestDb } = await import("@workspace/db/testing");
  const t = createTestDb(process.env.TEST_DATABASE_URL ?? "postgres://skip@127.0.0.1:1/skip");
  testDb.pool = t.pool;
  return { ...actual, db: t.db };
});

// Real PostgreSQL concurrency, isolated from all application records.
const schema = `invoice_test_${randomUUID().replaceAll("-", "")}`;
const identifier = sql.identifier(schema);
const inSchema = async <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.execute(sql`set local search_path to ${identifier}`);
    return fn(tx);
  });

describe.skipIf(!process.env.TEST_DATABASE_URL)("transactional invoice numbering (PostgreSQL)", () => {
  beforeAll(async () => {
    await db.execute(sql`create schema ${identifier}`);
    await inSchema(async (tx) => {
      await tx.execute(sql`create table vehicles (id serial primary key, user_id text not null, sales_invoice_number text)`);
      await tx.execute(sql`create table invoices (id serial primary key, user_id text not null, vehicle_id integer, invoice_number text not null, unique(user_id, invoice_number))`);
      await tx.execute(sql`create table invoice_archive (id serial primary key, user_id text not null, invoice_number text not null)`);
      await tx.execute(sql`create table issued_sales (id serial primary key, user_id text not null, vehicle_id integer, invoice_number text not null)`);
      await tx.execute(sql`create table sale_credits (id serial primary key, user_id text not null, credit_number text not null)`);
    });
  });
  afterAll(async () => {
    await db.execute(sql`drop schema ${identifier} cascade`);
    await testDb.pool?.end();
  });

  async function reserve(user: string) {
    return inSchema(async (tx) => {
      await lockInvoiceNumbers(tx, user);
      const number = await nextInvoiceNumber(tx, user);
      // Force overlap: without the advisory lock concurrent callers collide.
      await tx.execute(sql`select pg_sleep(0.01)`);
      await tx.execute(sql`insert into vehicles(user_id, sales_invoice_number) values (${user}, ${number})`);
      return number;
    });
  }

  it("reserves distinct numbers for concurrent sales even before invoices exist", async () => {
    const numbers = await Promise.all(Array.from({ length: 12 }, () => reserve("concurrent")));
    expect(new Set(numbers).size).toBe(12);
    expect(numbers.sort()).toEqual(Array.from({ length: 12 }, (_, n) => `INV-${String(n + 1).padStart(4, "0")}`));
  });

  it("does not reuse an incomplete historical sale number or alter it", async () => {
    await inSchema(async (tx) => {
      await tx.execute(sql`insert into vehicles(user_id, sales_invoice_number) values ('history', 'INV-0099')`);
      await tx.execute(sql`insert into invoices(user_id, vehicle_id, invoice_number) values ('history', 500, 'INV-0040')`);
    });
    expect(await reserve("history")).toBe("INV-0100");
    await inSchema(async (tx) => {
      await expect(assertInvoiceNumberAvailable(tx, "history", 999, "INV-0099")).rejects.toThrow("already linked");
    });
  });

  it("preserves legacy custom numbers, scans both sources and isolates dealers", async () => {
    await inSchema(async (tx) => {
      await tx.execute(sql`insert into invoices(user_id, vehicle_id, invoice_number) values ('legacy', 501, 'OLD-120')`);
      expect(await nextInvoiceNumber(tx, "legacy")).toBe("INV-0121");
      expect(await nextInvoiceNumber(tx, "empty")).toBe("INV-0001");
    });
  });

  it("rolls a failed reservation back and releases its lock", async () => {
    await expect(inSchema(async (tx) => {
      await lockInvoiceNumbers(tx, "rollback");
      const number = await nextInvoiceNumber(tx, "rollback");
      await tx.execute(sql`insert into vehicles(user_id, sales_invoice_number) values ('rollback', ${number})`);
      throw new Error("failure");
    })).rejects.toThrow("failure");
    expect(await reserve("rollback")).toBe("INV-0001");
  });
});
