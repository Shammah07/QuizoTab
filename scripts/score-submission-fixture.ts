import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { submitRoomScore } from "@/lib/tournament/room-scoring";
import { saveScoringPlan } from "@/lib/tournament/scoring-plan";
import { createTournament, readState, writeState } from "@/lib/tournament/store";
import { isPointsFormat, type Format } from "@/lib/tournament/rules";

// Test only: project the gated read for exactly one synthetic tournament. All
// locks, membership queries, constraints and writes use the actual adapter.
// Neither the fixture row nor the database activation constraint is changed.
export function fixtureAdapter(db: Db, fixtureId: string, failAudit = false): Db {
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== "transaction") return Reflect.get(target, prop);
      return (work: (tx: Db) => Promise<unknown>) => target.transaction(tx => work(new Proxy(tx, {
        get(inner, method) {
          if (method === "select") return (fields?: Record<string, unknown>) => {
            if (fields?.engine === s.tournaments.scoringEngineVersion) {
              return inner.select({ engine: sql`case when ${s.tournaments.id} = ${fixtureId} then 'room_v1' else ${s.tournaments.scoringEngineVersion}::text end` });
            }
            return fields ? inner.select(fields as Parameters<Db["select"]>[0]) : inner.select();
          };
          if (method === "insert" && failAudit) return (table: typeof s.tournamentScoreEvents) => {
            if (table === s.tournamentScoreEvents) return {
              values: (values: typeof table.$inferInsert) => inner.insert(table).values({ ...values, actorUserId: -1 }),
            };
            return inner.insert(table);
          };
          return Reflect.get(inner, method);
        },
      })));
    },
  });
}

export async function scoringFixture(db: Db, format: Format) {
  const tag = "unit3-" + randomUUID();
  const accounts = await db.insert(s.users).values(["owner", "one", "two"].map(name => ({
    name, email: tag + name + "@example.test", password: "unusable", emailVerifiedAt: new Date(),
  }))).returning({ id: s.users.id });
  const made = await createTournament(db, accounts[0].id, { name: tag, category: "fixture", format, year: 2026 });
  assert.ok(made.ok);
  const tournament = made.value;
  const id = tournament.id;
  const judges = accounts.slice(1).map(a => ({ userId: a.id, name: tag, role: "judge" as const }));
  const teams = await db.insert(s.teams).values(["A", "B", "C"].map(name => ({ tournamentId: id, name }))).returning({ id: s.teams.id });
  const { config } = await readState(db, id);
  const round = config.rounds[0];
  round.maxPoints = 9;
  await writeState(db, id, "config", config);
  await writeState(db, id, "rooms", ["hall", "west"].map(id => ({ id, name: id, panelistIds: [], judgeId: "" })));
  await db.insert(s.tournamentRoomStaff).values(judges.map(j => ({ tournamentId: id, roomId: "hall", userId: j.userId, role: "judge" as const })));
  const contextId = randomUUID();
  const pairing = { id: contextId, stage: round.stage, matchLabel: round.match, teamAId: teams[0].id, teamBId: teams[1].id, roomId: "hall", released: true };
  const pointsFormat = isPointsFormat(config);
  if (!pointsFormat) await writeState(db, id, "pairings", [pairing]);
  const plan = {
    rounds: [round, config.rounds.at(-1)!].map(r => ({ id: r.id, questions: ["q-a", "q-b", "q-c"].map(id => ({ id, minPoints: 0, maxPoints: 3 })) })),
    rosters: pointsFormat ? [{ id: contextId, roomId: "hall", roundId: round.id, teamIds: teams.slice(0, 2).map(t => t.id), released: true }] : [],
  };
  await saveScoringPlan(db, id, plan);
  const data = { contextId, teamId: teams[0].id, roundId: round.id, questionKey: "q-a", points: 2, clientRequestId: randomUUID() };
  const adapter = fixtureAdapter(db, id);
  const submit = (input: unknown = data, actor = judges[0], room = "hall") => submitRoomScore(adapter, id, room, actor, input);
  return { tournament, id, judges, teams, plan, pairing, adapter, data, submit };
}

export async function verifyAtomicSubmission(db: Db, f: Awaited<ReturnType<typeof scoringFixture>>) {
  const { id, judges, data, submit } = f;
  await assert.rejects(submitRoomScore(db, id, "hall", judges[0], data), { status: 409, message: "Room scoring is disabled." });
  const invalid = fixtureAdapter(db, id, true);
  await assert.rejects(submitRoomScore(invalid, id, "hall", judges[0], data),
    (error: Error) => (error.cause as { code?: string })?.code === "23503");
  assert.equal((await db.select().from(s.tournamentScoreEntries).where(eq(s.tournamentScoreEntries.tournamentId, id))).length, 0);
  const first = await submit();
  assert.equal(first.created, true);
  assert.deepEqual(await submit(), { ...first, created: false });
  await assert.rejects(submit({ ...data, points: 1 }), { status: 409 });
  const events = await db.select().from(s.tournamentScoreEvents).where(eq(s.tournamentScoreEvents.scoreEntryId, first.scoreId));
  assert.equal(events.length, 1);
  assert.equal(events[0].actorUserId, judges[0].userId);
  assert.equal(events[0].eventType, "submitted");
  assert.ok(events[0].createdAt instanceof Date);
  const [entry] = await db.select().from(s.tournamentScoreEntries).where(eq(s.tournamentScoreEntries.id, first.scoreId));
  assert.equal(entry.status, "pending");
  assert.equal(entry.reviewerUserId, null);
}
