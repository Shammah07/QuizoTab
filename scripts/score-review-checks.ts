import { spectatorView } from "@/lib/tournament/spectator";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import type { Db } from "@/lib/db";
import type { Session } from "@/lib/auth/session";
import * as s from "@/lib/db/schema";
import { scoreReviewHandlers } from "@/lib/tournament/room-handlers";
import { decideRoomScore, pendingRoomScores, proposeCorrection } from "@/lib/tournament/score-review";
import { writeState } from "@/lib/tournament/store";
import { fixtureAdapter, type scoringFixture } from "./score-submission-fixture";

type Fixture = Awaited<ReturnType<typeof scoringFixture>>;

export async function verifyRoomReview(db: Db, f: Fixture) {
  const { id, adapter, judges } = f;
  const standings = () => spectatorView(adapter,id,"standings","hall");
  const total = async () => (await standings()).tables[0].rows.find(r => r.name === "A")?.total;
  const pending = await f.submit();
  assert.equal(await total(),0);
  const scoreId = pending.scoreId;
  const [owner] = await db.select({ userId: s.tournaments.ownerId }).from(s.tournaments).where(eq(s.tournaments.id, id));
  const [account] = await db.insert(s.users).values({ name: "Review host", email: randomUUID() + "@example.test", password: "unusable" })
    .returning({ userId: s.users.id });
  const host: Session = { ...account, name: "Review host", role: "host" };
  const [membership] = await db.insert(s.tournamentRoomStaff).values({ tournamentId: id, roomId: "hall", userId: host.userId, role: "room_host" })
    .returning({ id: s.tournamentRoomStaff.id });
  const approved = { scoreId, decision: "approve" };
  const decide = (input: unknown) => decideRoomScore(adapter, id, "hall", host, input);
  const check = async (key: string) => (await db.select().from(s.tournamentScoreEntries).where(eq(s.tournamentScoreEntries.id, key)))[0];
  const audit = (key: string) => db.select().from(s.tournamentScoreEvents).where(eq(s.tournamentScoreEvents.scoreEntryId, key));
  function api(which: "pending" | "decide" | "correct", actor: Session | null, input?: unknown, roomId = "hall") {
    const request = new NextRequest("https://quizotab.test/review", input === undefined ? {} : { method: "POST", body: JSON.stringify(input) });
    return scoreReviewHandlers(() => adapter, async () => actor)[which](request, { params: Promise.resolve({ id, roomId }) });
  }
  assert.equal((await api("pending", null)).status, 401);
  assert.equal((await api("pending", { ...host, ...owner })).status, 403);
  assert.equal((await api("decide", { ...host, ...owner }, approved)).status, 403);
  assert.equal((await api("pending", host, undefined, "west")).status, 403);
  assert.equal((await api("decide", host, approved, "west")).status, 403);
  await db.insert(s.tournamentRoomStaff).values({ tournamentId: id, roomId: "west", role: "room_host", userId: owner.userId });
  const westHost = { ...host, ...owner };
  assert.deepEqual(await (await api("pending", westHost, undefined, "west")).json(), { scores: [] });
  assert.equal((await api("decide", westHost, approved, "west")).status, 404);
  await assert.rejects(pendingRoomScores(db, id, "hall", host), { status: 409 });
  const queue = await api("pending", host);
  assert.equal(queue.status, 200);
  const [row] = (await queue.json()).scores;
  for (const [key, value] of Object.entries({ scoreId, teamId: f.data.teamId, teamName: "A", roundId: f.data.roundId,
    questionKey: f.data.questionKey, contextId: f.data.contextId, points: f.data.points, status: "pending", judgeUserId: judges[0].userId })) {
    assert.equal(row[key], value);
  }
  assert.ok(row.submittedAt && row.judgeName);
  assert.equal((await api("decide", host, { ...approved, reviewerUserId: owner.userId })).status, 400);
  assert.equal((await api("decide", host, { scoreId, decision: "reject", reason: "  " })).status, 400);
  await db.update(s.tournamentRoomStaff).set({ revokedAt: sql`clock_timestamp()` }).where(eq(s.tournamentRoomStaff.id, membership.id));
  assert.equal((await api("pending", host)).status, 403);
  assert.equal((await api("decide", host, approved)).status, 403);
  // The submitting judge becomes a host after submission. Active host membership alone is insufficient.
  const judgeRole = and(eq(s.tournamentRoomStaff.tournamentId, id), eq(s.tournamentRoomStaff.userId, judges[0].userId));
  await db.update(s.tournamentRoomStaff).set({ role: "room_host" }).where(judgeRole);
  assert.equal((await api("decide", judges[0], approved)).status, 403);
  await db.update(s.tournamentRoomStaff).set({ role: "judge" }).where(judgeRole);
  await db.update(s.tournamentRoomStaff).set({ revokedAt: null }).where(eq(s.tournamentRoomStaff.id, membership.id));
  if (!f.plan.rosters.length) {
    await writeState(db, id, "pairings", [{ ...f.pairing, released: false }]);
    await assert.rejects(decide(approved), { status: 409 });
    await writeState(db, id, "pairings", [f.pairing]);
  }
  const failing = fixtureAdapter(db, id, true);
  await assert.rejects(decideRoomScore(failing, id, "hall", host, approved), (e: Error) => (e.cause as { code: string }).code === "23503");
  assert.equal((await check(scoreId)).status, "pending");
  assert.equal((await audit(scoreId)).length, 1);
  assert.equal((await api("decide", host, approved)).status, 200);
  const first = await check(scoreId);
  assert.equal(first.status, "approved");
  assert.equal(first.reviewerUserId, host.userId);
  assert.ok(first.reviewedAt);
  assert.equal((await api("decide", host, approved)).status, 409);

  // Fill two other question slots. Replacing the 2-point award with 3
  // reaches the round maximum of 9 without counting both revisions.
  for (const questionKey of ["q-b", "q-c"]) {
    const extra = await f.submit({ ...f.data, questionKey, points: 3, clientRequestId: randomUUID() });
    await decide({ scoreId: extra.scoreId, decision: "approve" });
  }
  assert.equal(await total(),8);
  const beforeCorrection = await standings();
  const proposal = { scoreId, points: 3, reason: "Answer key corrected", clientRequestId: randomUUID() };
  assert.equal((await api("correct", host, proposal)).status, 403);
  const submitted = await api("correct", judges[1], proposal);
  assert.equal(submitted.status, 201);
  assert.deepEqual(await standings(),beforeCorrection);
  const rejectedId = (await submitted.json()).scoreId;
  assert.equal((await check(rejectedId)).correctionOf, scoreId);
  assert.equal((await check(scoreId)).status, "approved");
  assert.equal((await api("correct", judges[1], proposal)).status, 200);
  assert.equal((await api("correct", judges[1], { ...proposal, points: 0 })).status, 409);
  const review = await pendingRoomScores(adapter, id, "hall", host);
  assert.equal(review[0].previousPoints, first.points);
  assert.equal(review[0].reason, proposal.reason);
  const rejection = "The original answer key applies";
  await decide({ scoreId: rejectedId, decision: "reject", reason: rejection });
  assert.equal((await check(rejectedId)).status, "rejected");
  assert.equal((await check(rejectedId)).reason, proposal.reason);
  assert.deepEqual((await audit(rejectedId)).find(e => e.eventType === "rejected")?.details, { reason: rejection });
  assert.equal((await check(scoreId)).status, "approved");
  assert.deepEqual(await standings(),beforeCorrection);
  const corrected = await proposeCorrection(adapter, id, "hall", judges[1], { ...proposal, clientRequestId: randomUUID() });
  const correctionApproval = { scoreId: corrected.scoreId, decision: "approve" };
  // Fail the second audit insert, after the supersession event and both updates.
  await assert.rejects(decideRoomScore(fixtureAdapter(db, id, "approved"), id, "hall", host, correctionApproval),
    (e: Error) => (e.cause as { code: string }).code === "23503");
  assert.equal((await check(scoreId)).status, "approved");
  assert.equal((await check(corrected.scoreId)).status, "pending");
  assert.ok(!(await audit(scoreId)).some(e => e.eventType === "superseded"));
  await decide(correctionApproval);
  assert.equal(await total(),9);
  const superseded = await check(scoreId);
  assert.equal(superseded.status, "superseded");
  assert.equal(superseded.points, first.points);
  assert.deepEqual(superseded.reviewedAt, first.reviewedAt);
  const replacement = await check(corrected.scoreId);
  assert.equal(replacement.status, "approved");
  assert.equal(replacement.revision, 3);
  assert.equal(replacement.correctionOf, scoreId);
  assert.deepEqual((await audit(scoreId)).map(e => e.eventType).sort(), ["approved", "submitted", "superseded"]);
  assert.deepEqual((await audit(corrected.scoreId)).map(e => e.eventType).sort(), ["approved", "submitted"]);
  assert.equal((await pendingRoomScores(adapter, id, "hall", host)).length, 0);
  return { host, approvedId: corrected.scoreId };
}

export async function verifyConcurrentReview(db: Db, f: Fixture, host: Session, approvedId: string) {
  const original = await f.submit({ ...f.data, teamId: f.teams[1].id, questionKey: "q-b", clientRequestId: randomUUID() });
  const correction = await proposeCorrection(f.adapter, f.id, "hall", f.judges[0], {
    scoreId: approvedId, points: 1, reason: "Rechecked the recorded answer", clientRequestId: randomUUID(),
  });
  for (const scoreId of [original.scoreId, correction.scoreId]) {
    const calls = await Promise.allSettled([{ decision: "approve" }, { decision: "reject", reason: "Answer disputed" }].map(d =>
      decideRoomScore(f.adapter, f.id, "hall", host, { scoreId, ...d })));
    assert.equal(calls.filter(r => r.status === "fulfilled").length, 1);
    assert.ok(calls.some(r => r.status === "rejected" && r.reason.status === 409));
    const audit = await db.select().from(s.tournamentScoreEvents).where(eq(s.tournamentScoreEvents.scoreEntryId, scoreId));
    assert.equal(audit.filter(e => e.eventType === "approved" || e.eventType === "rejected").length, 1);
  }
  const effective = await db.select().from(s.tournamentScoreEntries).where(and(eq(s.tournamentScoreEntries.tournamentId, f.id),
    eq(s.tournamentScoreEntries.questionKey, f.data.questionKey), eq(s.tournamentScoreEntries.status, "approved")));
  assert.equal(effective.length, 1);
}
