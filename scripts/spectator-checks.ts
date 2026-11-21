import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { tournamentRoomStaff, tournaments } from "@/lib/db/schema";
import { officialAwards, officialFixture } from "@/lib/tournament/official-standings";
import { saveRoomPairings } from "@/lib/tournament/room-management";
import { decideRoomScore } from "@/lib/tournament/score-review";
import { saveScoringPlan } from "@/lib/tournament/scoring-plan";
import { spectatorView } from "@/lib/tournament/spectator";
import { spectatorRefresh } from "@/lib/tournament/spectator-refresh";
import { readState, writeState } from "@/lib/tournament/store";
import type { scoringFixture } from "./score-submission-fixture";

export async function checkSpectators(db: Db, f: Awaited<ReturnType<typeof scoringFixture>>) {
  const { id, plan, adapter } = f;
  const { config, pairings } = await readState(db,id);
  const [owner] = await db.select({ userId: tournaments.ownerId }).from(tournaments).where(eq(tournaments.id,id));
  const westHost = { ...owner, name:"synthetic host", role:"host" as const };
  await db.insert(tournamentRoomStaff).values({ tournamentId:id, roomId:"west", role:"judge", userId:f.judges[0].userId });
  const contextId = randomUUID();
  const lastRound = plan.rounds[1].id;
  const teamId = f.teams[2].id;
  const west = { ...f.pairing, id:contextId, roomId:"west", teamAId:teamId, teamBId:null };
  if (plan.rosters.length) {
    await saveScoringPlan(db,id,{ ...plan, rosters:[...plan.rosters,...[f.data.roundId,lastRound].map(roundId => ({
      id:contextId+roundId.slice(-8), roomId:"west", released:true, teamIds:[teamId], roundId,
    }))] });
  } else {
    await writeState(db,id,"pairings",[...pairings,west]);
    const next = {...west,id:randomUUID(),stage:"final" as const};
    const current = (await readState(db,id)).pairings;
    await assert.rejects(adapter.transaction(tx => saveRoomPairings(tx,id,[...current,next],current)),
      {status:409,message:"Complete and release the prerequisite fixtures before advancing eligible teams."});
  }
  const before = await spectatorView(adapter,id,"standings","hall");
  const rounds = plan.rosters.length ? [f.data.roundId,lastRound] : [f.data.roundId];
  for (const roundId of rounds) {
    const receipt = await f.submit({...f.data,teamId,roundId,contextId:plan.rosters.length ? contextId+roundId.slice(-8) : contextId,
      points:2,clientRequestId:randomUUID()},f.judges[0],"west");
    await decideRoomScore(adapter,id,"west",westHost,{scoreId:receipt.scoreId,decision:"approve"});
  }
  assert.deepEqual(await spectatorView(adapter,id,"standings","hall"),before);
  const other = await spectatorView(adapter,id,"standings","west");
  assert.deepEqual(other.tables[0].rows.map(r => [r.name,r.total]),[["C",2*rounds.length]]);
  const all = await spectatorView(adapter,id,"standings");
  assert.deepEqual(all.tables[0].rows.map(r => r.total),[9,2*rounds.length,0]);
  assert.ok(all.updatedAt);
  const legacy = await spectatorView(db,id,"standings");
  assert.ok(legacy.tables[0].rows.every(r => r.total===0));
  const forbidden = /"(ownerId|judgeName|judgeId|members|registeredBy|email|scoreId|correctionOf|reason|contextId|teamId|panelistIds|reviewerUserId)":/;
  assert.doesNotMatch(JSON.stringify([all,before,other]),forbidden);
  if (!plan.rosters.length) {
    const awards = await officialAwards(db,id);
    const pair = pairings[0];
    assert.equal(officialFixture(pair,config,plan,awards).winnerId,null);
    assert.equal(officialFixture(pair,config,{...plan,completedContexts:[pair.id]},awards).complete,false);
    await assert.rejects(saveScoringPlan(db,id,{...plan,completedContexts:[pair.id]}),{status:409});
    assert.equal(officialFixture(west,config,{...plan,completedContexts:[west.id]},awards).winnerId,teamId);
    if (config.format === "championship") {
      const reduced = { ...config, qualificationCount:2, rounds:config.rounds.filter(r => plan.rounds.some(p => p.id === r.id)) };
      await writeState(db,id,"config",reduced);
      const current = (await readState(db,id)).pairings;
      const final = { ...pair, id:randomUUID(), stage:"final" as const, matchLabel:"Final", roomId:"west", teamBId:teamId };
      const advance = () => adapter.transaction(tx => saveRoomPairings(tx,id,[...current,final],current));
      await assert.rejects(advance(),{status:409});
      const [hallHost] = await db.select({userId:tournamentRoomStaff.userId}).from(tournamentRoomStaff)
        .where(and(eq(tournamentRoomStaff.tournamentId,id),eq(tournamentRoomStaff.roomId,"hall"),eq(tournamentRoomStaff.role,"room_host")));
      for (const q of plan.rounds[0].questions) {
        const receipt = await f.submit({...f.data,teamId:f.teams[1].id,questionKey:q.id,points:0,clientRequestId:randomUUID()});
        await decideRoomScore(adapter,id,"hall",{...westHost,...hallHost},{scoreId:receipt.scoreId,decision:"approve"});
      }
      await assert.rejects(advance(),{status:409});
      await saveScoringPlan(db,id,{...plan,completedContexts:[pair.id,west.id]});
      await advance();
      const board = await spectatorView(adapter,id,"standings","west");
      assert.deepEqual(board.tables[1].rows.map(t => t.name),["A","C"]);
    }
  }
}

export async function checkSpectatorRefresh() {
  const responses: ((r:Response) => void)[] = [];
  let content: string | null = "Hall";
  let stale = false;
  const poll = spectatorRefresh<string>(() => new Promise(r => responses.push(r)),data => {content=data;},() => {stale=true;});
  const failed = poll.refresh();
  responses.shift()!(new Response(null,{status:503}));
  await failed;
  assert.ok(stale);
  assert.equal(content,"Hall");
  const old = poll.refresh();
  poll.cancel();
  content = "West";
  responses.shift()!(Response.json("Hall"));
  await old;
  assert.equal(content,"West");
  const revoked = poll.refresh();
  responses.shift()!(new Response(null,{status:404}));
  await revoked;
  assert.equal(content,null);
}
