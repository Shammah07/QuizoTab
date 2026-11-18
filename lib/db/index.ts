import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Any Postgres connection that knows QuizoTab's tables. Code that reads and writes data takes one of
// these, so the same code runs against Neon when live and against a throwaway database in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

let client: Db | undefined;

// The database, connected on first use rather than when this file loads,
// so `next build` works on machines that have no DATABASE_URL.
//
// Queries travel over HTTPS, one request each, which suits Vercel's short-lived functions.
// Anything that has to read, decide and then write inside a single transaction
// (payment fulfilment) will use a pooled connection instead.
export function db(): Db {
  client ??= drizzle(neon(env("DATABASE_URL")), { schema });
  return client;
}

export { schema };
