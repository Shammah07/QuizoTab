import { verifyOperations } from "./operations-checks";
import { verifyAdjudication, verifyTiebreakRetirement } from "./adjudication-checks";
import { verifyLifecycle } from "./lifecycle-checks";
import { checkSpectators, checkSpectatorRefresh } from "./spectator-checks";
import { spectatorView } from "@/lib/tournament/spectator";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";
import { scoreSubmissionHandler } from "@/lib/tournament/room-handlers";
import { FORMAT_KEYS } from "@/lib/tournament/rules";
import { saveScoringPlan } from "@/lib/tournament/scoring-plan";
import { writeState } from "@/lib/tournament/store";
import { scoringFixture, verifyAtomicSubmission } from "./score-submission-fixture";
import { verifyConcurrentReview, verifyRoomReview } from "./score-review-checks";

const pg = new PGlite();
const db = drizzle(pg, { schema });
try {
  await checkSpectatorRefresh();
  await migrate(db, { migrationsFolder: "./drizzle" });
  await verifyAdjudication(db);
  await verifyTiebreakRetirement(db);
  for (const format of FORMAT_KEYS) {
    await verifyOperations(db,format);
    await verifyLifecycle(db,format);
    const f = await scoringFixture(db, format);
    const { data, submit, id, judges, plan, pairing } = f;
    const pub = () => spectatorView(f.adapter, id, "standings");
    const original = await pub();
    await assert.rejects(submit(data, judges[0], "west"), { status: 403 });
    for (const change of [{ teamId: randomUUID() }, { teamId: f.teams[2].id }, { roundId: "missing" },
      { roundId: plan.rounds[1].id }, { questionKey: "missing" }, { points: 4 }]) {
      await assert.rejects(submit({ ...data, ...change }), { status: 422 });
    }
    for (const points of [-1, 0.5, "2"]) await assert.rejects(submit({ ...data, points }), { status: 400 });
    await assert.rejects(submit({ ...data, contextId: "obsolete" }), { status: 409 });
    const excessive = { ...plan, rounds: plan.rounds.map(r => ({ ...r, questions: r.questions.map(q => ({ ...q, maxPoints: 100000 })) })) };
    await assert.rejects(saveScoringPlan(db, id, excessive), { status: 422 });
    if (plan.rosters.length) {
      await saveScoringPlan(db, id, { ...plan, rosters: plan.rosters.map(r => ({ ...r, released: false })) });
      await assert.rejects(submit(), { status: 409 });
      await saveScoringPlan(db, id, plan);
    } else {
      await writeState(db, id, "pairings", [{ ...pairing, released: false }]);
      await assert.rejects(submit(), { status: 409 });
      await writeState(db, id, "pairings", [{ ...pairing, roomId: "west" }]);
      await assert.rejects(submit(), { status: 409 });
      await writeState(db, id, "pairings", [pairing]);
    }
    await verifyAtomicSubmission(db, f);
    await saveScoringPlan(db, id, plan);
    await assert.rejects(saveScoringPlan(db, id, { ...plan, rounds: plan.rounds.slice(1) }), { status: plan.rosters.length ? 422 : 409 });
    const other = { ...data, questionKey: "q-b", clientRequestId: randomUUID() };
    const race = await Promise.allSettled(judges.map(j => submit(other, j)));
    assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
    assert.ok(race.some(r => r.status === "rejected" && r.reason.status === 409));

    const post = (viewer: typeof judges[number] | null, payload: unknown, tid = id, roomId = "hall") =>
      scoreSubmissionHandler(() => f.adapter, async () => viewer)(new NextRequest("https://quizotab.test/scores", {
        method: "POST", body: JSON.stringify(payload),
      }), { params: Promise.resolve({ id: tid, roomId }) });
    assert.equal((await post(null, data)).status, 401);
    assert.equal((await post(judges[0], { ...data, judgeUserId: judges[1].userId })).status, 400);
    assert.equal((await post(judges[0], data, id, "west")).status, 403);
    const another = await scoringFixture(db, format);
    const { host, approvedId } = await verifyRoomReview(db, another);
    const spectatorFixture = await scoringFixture(db,format);
    await verifyRoomReview(db,spectatorFixture);
    await checkSpectators(db,spectatorFixture);
    await verifyConcurrentReview(db, another, host, approvedId);
    console.log("ok  room review, competing decisions and immutable correction history:", format);
    assert.equal((await post(judges[0], data, another.id)).status, 403);
    const requests = [data.teamId, f.teams[1].id].map(teamId => ({ ...data, teamId, questionKey: "q-c", clientRequestId: randomUUID() }));
    const [first, second] = await Promise.all([post(judges[0], requests[0]), submit(requests[1], judges[1])]);
    assert.equal(first.status, 201);
    assert.equal(second.created, true);
    const retry = await post(judges[0], requests[0]);
    assert.equal(retry.status, 200);
    assert.deepEqual(await first.json(), await retry.json());
    assert.equal((await post(judges[0], { ...requests[0], points: 0 })).status, 409);
    assert.deepEqual(await pub(), original);
    if (format === "knockout") {
      const nextFixture = { ...pairing, id: randomUUID() };
      await writeState(db, id, "pairings", [nextFixture]);
      const next = { ...data, contextId: nextFixture.id, points: 3, clientRequestId: randomUUID() };
      const receipts = await Promise.all([submit(next), submit(next)]);
      assert.equal(receipts[0].scoreId, receipts[1].scoreId);
      assert.equal(receipts.filter(r => r.created).length, 1);
      await assert.rejects(submit({ ...next, questionKey: "q-b", clientRequestId: randomUUID() }), { status: 409 });
      // The original receipt survives withdrawal of its fixture.
      assert.equal((await post(judges[0], data)).status, 200);
    }
    await db.update(schema.tournamentRoomStaff).set({ revokedAt: new Date() }).where(and(
      eq(schema.tournamentRoomStaff.tournamentId, id), eq(schema.tournamentRoomStaff.userId, judges[0].userId)));
    assert.equal((await post(judges[0], requests[0])).status, 403);
    console.log("ok  submission, eligibility, competing attempts, audit rollback and unchanged public view:", format);
  }
} finally {
  await pg.close();
}
