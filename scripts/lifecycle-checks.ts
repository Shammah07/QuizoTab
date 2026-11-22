import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { NextRequest } from "next/server";
import type { Db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { lifecycleHandlers, scoreReviewHandlers } from "@/lib/tournament/room-handlers";
import { staffAssignments, staffWorkspace } from "@/lib/tournament/staff-workspace";
import { completionPreview, roomCompletion } from "@/lib/tournament/fixture-lifecycle";
import { saveScoringPlan } from "@/lib/tournament/scoring-plan";
import { readState, saveConfig, resetTournament, writeState } from "@/lib/tournament/store";
import type { Format } from "@/lib/tournament/rules";
import { fixtureAdapter, scoringFixture } from "./score-submission-fixture";

export async function verifyLifecycle(db: Db, format: Format) {
  const f = await scoringFixture(db, format);
  const { id, adapter, data, judges } = f;
  const [owner] = await db.select({ userId: s.tournaments.ownerId }).from(s.tournaments).where(eq(s.tournaments.id, id));
  const host = { ...owner, role: "host" as const, name: "Fixture owner" };
  const [membership] = await db.insert(s.tournamentRoomStaff).values({ tournamentId: id, roomId: "hall", userId: host.userId, role: "room_host" })
    .returning({ id: s.tournamentRoomStaff.id });
  const config = (await readState(db, id)).config;
  const round = config.rounds[0];
  const plan = { ...f.plan, rounds: [{ id: round.id, questions: [f.plan.rounds[0].questions[0]] }] };
  await writeState(db, id, "config", { ...config, rounds: [round] });
  await saveScoringPlan(db, id, plan);
  const contextId = data.contextId;
  const payload = (points: number, scoreId: string) => ({ scoreId, points, reason: "Corrected answer sheet", clientRequestId: randomUUID() });
  const params = (roomId: string) => ({ params: Promise.resolve({ id, roomId }) });
  const request = (body?: unknown) => new NextRequest("https://quizotab.test/room?contextId=" + contextId,
    body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
  const review = (input: unknown, actor = host) => scoreReviewHandlers(() => adapter, async () => actor).decide(request(input), params("hall"));
  const propose = (input: unknown, room = "hall") => scoreReviewHandlers(() => adapter, async () => judges[1]).correct(request(input), params(room));
  const life = (owner: boolean, actor: { userId: number; name: string; role: "host" | "judge" } | null, input?: unknown, room = "hall") => {
    const handlers = lifecycleHandlers(() => adapter, async () => actor, owner);
    return handlers[input === undefined ? "GET" : "POST"](request(input), params(room));
  };
  const versions = async () => {
    const response = await life(false, host);
    assert.equal(response.status, 200);
    const { configRevision, lifecycleRevision } = await response.json();
    return { contextId, configRevision, lifecycleRevision };
  };
  const workspace = () => staffWorkspace(adapter,id,"hall",judges[0],"judge");
  const assignments = await staffAssignments(db,judges[0]);
  assert.deepEqual(assignments.map(a=>[a.id,a.room,a.role,a.status]),[[id,"hall","judge","active"]]);
  await assert.rejects(staffWorkspace(adapter,id,"west",judges[0],"judge"),{status:403});
  await assert.rejects(staffWorkspace(adapter,id,"hall",judges[0],"room_host"),{status:403});
  await assert.rejects(staffWorkspace(db,id,"hall",judges[0],"judge"),{status:409});
  const initial = await workspace();
  assert.deepEqual(initial.contexts.map(c=>c.id),[contextId]);
  assert.deepEqual(initial.contexts[0].teams.map(t=>t.id),f.teams.slice(0,2).map(t=>t.id));
  assert.deepEqual(initial.contexts[0].rounds[0].questions,plan.rounds[0].questions);
  const preview = () => completionPreview(adapter,id,"hall",host,contextId);
  const empty = await preview();
  assert.match(empty.blocker ?? "",/missing approved/);
  assert.equal(empty.coverage.required,2);
  assert.equal(empty.coverage.missingCount,2);
  const start = await versions();
  const history = () => db.select({ value: s.tournamentState.value }).from(s.tournamentState)
    .where(and(eq(s.tournamentState.tournamentId, id), like(s.tournamentState.key, "fixtureEvent:%"))).orderBy(s.tournamentState.key);
  const error = async (response: Response, status: number, pattern?: RegExp) => {
    assert.equal(response.status, status);
    if (pattern) assert.match((await response.json()).error, pattern);
  };
  await error(await life(false, null, start), 401);
  await error(await life(false, judges[0], start), 403);
  await error(await life(false, host, start, "west"), 403);
  await error(await life(false, host, { ...start, configRevision: "0".repeat(64) }), 409, /Configuration/);
  await error(await life(false, host, start), 409, /missing approved/);
  await assert.rejects(roomCompletion(db, id, "hall", host, start), { status: 409, message: "Room scoring is disabled." });
  const first = await f.submit();
  assert.equal((await workspace()).history[0].status,"pending");
  assert.equal((await staffWorkspace(adapter,id,"hall",judges[1],"judge")).history[0].points,null);
  const waiting = await preview();
  assert.match(waiting.blocker ?? "",/pending/);
  assert.equal(waiting.coverage.pendingScores,1);
  assert.equal(waiting.coverage.missingCount,1);
  await error(await life(false, host, start), 409, /pending/);
  assert.equal((await review({ scoreId: first.scoreId, decision: "reject", reason: "Check the score sheet" })).status, 200);
  const replacement = payload(1, first.scoreId);
  await error(await propose(replacement, "west"), 403);
  const staff = s.tournamentRoomStaff;
  const judgeWhere = and(eq(staff.tournamentId, id), eq(staff.roomId, "hall"), eq(staff.userId, judges[1].userId));
  await db.update(staff).set({ revokedAt: new Date() }).where(judgeWhere);
  await error(await propose(replacement), 403);
  await db.update(staff).set({ revokedAt: null }).where(judgeWhere);
  const proposed = await propose(replacement);
  assert.equal(proposed.status, 201);
  const second = (await proposed.json()).scoreId;
  const retry = await propose(replacement);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).scoreId, second);
  await error(await propose(payload(3, first.scoreId)), 409);
  await db.update(staff).set({ revokedAt: new Date() }).where(eq(staff.id, membership.id));
  await error(await life(false, host, start), 403);
  assert.deepEqual(await staffAssignments(db,host),[]);
  await assert.rejects(staffWorkspace(adapter,id,"hall",host,"room_host"),{status:403});
  await db.update(staff).set({ role: "room_host" }).where(judgeWhere);
  await error(await review({ scoreId: second, decision: "approve" }, { ...host, userId: judges[1].userId }), 403);
  await db.update(staff).set({ role: "judge" }).where(judgeWhere);
  await db.update(staff).set({ revokedAt: null }).where(eq(staff.id, membership.id));
  assert.equal((await review({ scoreId: second, decision: "reject", reason: "Still incorrect" })).status, 200);
  await error(await propose(payload(1, first.scoreId)), 409);
  const thirdResponse = await propose(payload(3, second));
  assert.equal(thirdResponse.status, 201);
  const third = (await thirdResponse.json()).scoreId;
  assert.equal((await review({ scoreId: third, decision: "approve" })).status, 200);
  const chain = await db.select({
    status: s.tournamentScoreEntries.status, revision: s.tournamentScoreEntries.revision,
    parent: s.tournamentScoreEntries.correctionOf
  }).from(s.tournamentScoreEntries)
    .where(eq(s.tournamentScoreEntries.tournamentId, id)).orderBy(s.tournamentScoreEntries.revision);
  assert.deepEqual(chain, [{ status: "rejected", revision: 1, parent: null }, { status: "rejected", revision: 2, parent: first.scoreId }, { status: "approved", revision: 3, parent: second }]);
  const audit = await db.select({entry:s.tournamentScoreEvents.scoreEntryId,type:s.tournamentScoreEvents.eventType})
    .from(s.tournamentScoreEvents).where(inArray(s.tournamentScoreEvents.scoreEntryId,[first.scoreId,second,third]));
  for (const [entry,decision] of [[first.scoreId,"rejected"],[second,"rejected"],[third,"approved"]]) {
    assert.deepEqual(audit.filter(e => e.entry === entry).map(e => e.type).sort(),[decision,"submitted"].sort());
  }
  const other = await f.submit({ ...data, teamId: f.teams[1].id, points: 1, clientRequestId: randomUUID() });
  assert.equal((await review({ scoreId: other.scoreId, decision: "approve" })).status, 200);
  const correction = await propose(payload(2, third));
  assert.equal(correction.status, 201);
  await error(await life(false, host, start), 409, /pending/);
  assert.equal((await review({ scoreId: (await correction.json()).scoreId, decision: "approve" })).status, 200);
  await assert.rejects(roomCompletion(fixtureAdapter(db, id, "lifecycle"), id, "hall", host, start), /Injected lifecycle marker write failure/);
  assert.equal((await preview()).blocker,null);
  assert.deepEqual(await history(), []);
  assert.deepEqual(await versions(), start);
  assert.equal((await life(false, host, start)).status, 200);
  assert.equal((await life(false, host, start)).status, 200);
  assert.equal((await preview()).completed,true);
  assert.equal((await workspace()).contexts[0].completed,true);
  const closed = await versions();
  assert.equal(closed.lifecycleRevision, 1);
  const ownerPreview = await lifecycleHandlers(() => adapter, async () => host, true).GET(
    new NextRequest("https://quizotab.test/reopen?preview=1&contextId="+encodeURIComponent(contextId)),params("hall"));
  assert.equal(ownerPreview.status,200);
  assert.deepEqual(await ownerPreview.json(),{...closed,completed:true,blocker:null});
  await assert.rejects(resetTournament(db,id),{status:409});
  await assert.rejects(saveConfig(db,id,{...config,maxScorePerRound:config.maxScorePerRound+1}),{status:409});
  await assert.rejects(f.submit({...data,clientRequestId:randomUUID()}),{status:409,message:"Reopen the completed context before scoring."});
  await saveScoringPlan(db, id, plan); // stale editor omitting markers preserves closure
  await assert.rejects(saveScoringPlan(db, id, { ...plan, completedContexts: [] }), { status: 409 });
  await error(await life(true, judges[0], { ...closed, reason: "Check fixture" }), 404);
  await error(await life(true, host, closed), 400);
  await error(await life(true, host, { ...start, reason: "Check fixture" }), 409, /revision/);
  const prior = await history();
  assert.equal(prior.length, 1);
  assert.equal((await life(true, host, { ...closed, reason: "Check fixture" })).status, 200);
  const events = await history();
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], prior[0]);
  assert.deepEqual(events.map(e => {
    const event = e.value as { action: string; actor: number; reason?: string; at: string; configRevision: string };
    assert.ok(Date.parse(event.at));
    assert.equal(event.configRevision, start.configRevision);
    return [event.action, event.actor, event.reason];
  }), [["close", host.userId, undefined], ["reopen", host.userId, "Check fixture"]]);
  await error(await life(false, host, start), 409, /revision/);
  console.log("ok  rejected replacement chain, room completion, owner reopening and versioned history:", format);
  return id;
}
