import { setupBracket, verifyAdjudication, verifyIndependentRaces } from "./adjudication-checks";
import { verifyLifecycle } from "./lifecycle-checks";
import { checkSpectators } from "./spectator-checks";
// Opt-in only. Roll back the whole fixture, including append-only audit events.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "@/lib/db/schema";
import { FORMAT_KEYS } from "@/lib/tournament/rules";
import { readDevDatabase } from "./dev-database";
import { scoringFixture, verifyAtomicSubmission } from "./score-submission-fixture";
import { verifyRoomReview } from "./score-review-checks";

const urls = readDevDatabase();
const target = new URL(urls.direct);
const writer = new Pool({ connectionString: urls.pooled, max: 1 });
const observer = new Pool({ connectionString: urls.direct, max: 1 });
const db = drizzle(writer, { schema });
const independent = drizzle(observer, { schema });
const racesOnly = process.argv.includes("--adjudication-races-only");
const focused = racesOnly || process.argv.includes("--adjudication-only");
const rolledBack = new Error("Complete fixture rollback");
try {
  for (const connection of [db, independent]) {
    const [identity] = (await connection.execute(sql`select current_database() as db, current_setting('neon.endpoint_id') as endpoint,
      exists(select from pg_constraint where conrelid='public.tournaments'::regclass and conname='tournaments_legacy_engine_only'
        and convalidated and conenforced and pg_get_constraintdef(oid) = 'CHECK ((scoring_engine_version = ''legacy''::scoring_engine))') as gated`)).rows;
    assert.ok(identity.db === target.pathname.slice(1) && identity.endpoint === target.hostname.split(".")[0] && identity.gated === true);
    const history = (await connection.execute(sql`select id, hash, created_at::text as stamp from drizzle.__drizzle_migrations order by id`)).rows;
    const { entries } = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string; when: number }[] };
    assert.deepEqual(entries.map(e => e.tag), ["0000_panoramic_red_hulk", "0001_dormant_room_scoring"]);
    assert.deepEqual(history, entries.map((e, i) => ({ id: i + 1, stamp: String(e.when),
      hash: createHash("sha256").update(readFileSync("drizzle/" + e.tag + ".sql")).digest("hex") })));
  }
  console.log("Verified live direct and pooled development targets, journal and enforced engine gate.");
  if (!racesOnly) await assert.rejects(db.transaction(async tx => {
    await verifyAdjudication(tx);
    throw rolledBack;
  }), error => error === rolledBack);
  if (focused) {
    const bracket = await db.transaction(tx => setupBracket(tx));
    try {
      await verifyIndependentRaces(db,independent,bracket);
    } finally {
      // The committed race needs visible fixtures. Retain append-only history;
      // retire only the newly created, unlisted synthetic tournament and its staff.
      await db.transaction(async tx => {
        await tx.update(schema.tournaments).set({status:"archived"}).where(eq(schema.tournaments.id,bracket.id));
        await tx.update(schema.tournamentRoomStaff).set({revokedAt:new Date()}).where(eq(schema.tournamentRoomStaff.tournamentId,bracket.id));
      });
      const [saved] = await independent.select({status:schema.tournaments.status}).from(schema.tournaments).where(eq(schema.tournaments.id,bracket.id));
      assert.equal(saved.status,"archived");
      const activeStaff = await independent.select({id:schema.tournamentRoomStaff.id}).from(schema.tournamentRoomStaff)
        .where(and(eq(schema.tournamentRoomStaff.tournamentId,bracket.id),isNull(schema.tournamentRoomStaff.revokedAt)));
      assert.equal(activeStaff.length,0);
      console.log("Archived synthetic race tournament",bracket.id);
    }
  }
  for (const format of focused ? [] : FORMAT_KEYS) {
    let fixtureId = "";
    let lifecycleId = "";
    await assert.rejects(db.transaction(async tx => {
      const fixture = await scoringFixture(tx, format);
      fixtureId = fixture.id;
      await verifyAtomicSubmission(tx, fixture);
      await verifyRoomReview(tx, fixture);
      await checkSpectators(tx,fixture);
      lifecycleId = await verifyLifecycle(tx,format);
      const outside = await independent.select({ id: schema.tournamentScoreEntries.id }).from(schema.tournamentScoreEntries)
        .where(eq(schema.tournamentScoreEntries.tournamentId, fixture.id));
      assert.equal(outside.length, 0);
      throw rolledBack;
    }), error => error === rolledBack);
    assert.equal((await independent.select({ id: schema.tournaments.id }).from(schema.tournaments)
      .where(eq(schema.tournaments.id, fixtureId))).length, 0);
    assert.equal((await independent.select({ id: schema.tournaments.id }).from(schema.tournaments)
      .where(eq(schema.tournaments.id, lifecycleId))).length, 0);
    console.log("ok  Neon submission, review, official standings, room isolation, correction history, audit rollback and fixture rollback:", format);
  }
} finally {
  await Promise.all([writer.end(), observer.end()]);
}
