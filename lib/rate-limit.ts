import "server-only";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { rateLimits } from "@/lib/db/schema";
import type { Db } from "@/lib/db";

// Counts recent attempts per visitor so passwords, PINs and guest codes can't be guessed by trying them all.
// The PHP site kept these counts in temp files; here they are rows in rate_limits.

// True when `key` already has `max` attempts in the last `windowSeconds`
export async function tooManyAttempts(db: Db, key: string, max: number, windowSeconds: number) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, key), gt(rateLimits.at, sql`now() - make_interval(secs => ${windowSeconds}::int)`)));
  return (row?.count ?? 0) >= max;
}

export async function recordAttempt(db: Db, key: string) {
  await db.insert(rateLimits).values({ key });
  // Now and then, sweep out rows older than a day so the table stays small
  if (Math.random() < 0.02) await db.delete(rateLimits).where(lt(rateLimits.at, sql`now() - interval '1 day'`));
}

// The visitor's address as Vercel reports it. Only used to count attempts.
export async function visitorIp() {
  const forwarded = (await headers()).get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0].trim().replace(/[^0-9a-f.:]/gi, "") || "unknown";
}
