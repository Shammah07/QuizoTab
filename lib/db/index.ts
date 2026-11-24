import "server-only";
import { neon, Pool } from "@neondatabase/serverless";
import { pooledDatabase } from "./pooled-transactions";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { readPins, pilotUrl, verifyPilot, probeIdentity } from "./pilot-target";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Any Postgres connection that knows QuizoTab's tables. Code that reads and writes data takes one of
// these, so the same code runs against Neon when live and against a throwaway database in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

function runtimeUrl() {
  const raw=process.env.QUIZOTAB_PILOT_PINS;
  if (raw===undefined) return env("DATABASE_URL");
  try { return pilotUrl(env("DATABASE_URL"),readPins(JSON.parse(raw))); }
  catch { throw new Error("Pilot runtime database configuration is invalid."); }
}
let client: Db | undefined;

// The database, connected on first use rather than when this file loads,
// so `next build` works on machines that have no DATABASE_URL.
//
// Queries travel over HTTPS, one request each, which suits Vercel's short-lived functions.
// Anything that has to read, decide and then write inside a single transaction
// (payment fulfilment) will use a pooled connection instead.
export function db(): Db {
  client ??= drizzle(neon(runtimeUrl()), { schema });
  return client;
}

export { schema };

let transactionalClient: Db | undefined;
let pool: Pool | undefined;
export function transactionDb(): Db {
  pool ??= new Pool({ connectionString: runtimeUrl(), connectionTimeoutMillis: 10000 });
  transactionalClient ??= pooledDatabase(pool);
  return transactionalClient;
}

export function poolSample() {
  return {active:(pool?.totalCount ?? 0)-(pool?.idleCount ?? 0),waiting:pool?.waitingCount ?? 0,max:pool?.options.max ?? 10};
}

export async function verifyRuntimePilot() {
  try {
    const pins=readPins(JSON.parse(process.env.QUIZOTAB_PILOT_PINS ?? ""));
    await verifyPilot(pins,()=>probeIdentity(db()),()=>transactionDb().transaction(tx=>probeIdentity(tx)));
  } catch { throw new Error("Pilot runtime database verification failed. Startup refused."); }
}
