import { readOperations } from "@/lib/tournament/room-operations";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import type { Db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { compareCorrection, ownerAdjudication } from "@/lib/tournament/adjudication";
import { adjudicationHandlers } from "@/lib/tournament/room-handlers";
import { ownerReopening, roomCompletion } from "@/lib/tournament/fixture-lifecycle";
import { saveRoomPairings } from "@/lib/tournament/room-management";
import { submitRoomScore } from "@/lib/tournament/room-scoring";
import { decideRoomScore, pendingRoomScores, proposeCorrection } from "@/lib/tournament/score-review";
import { saveScoringPlan } from "@/lib/tournament/scoring-plan";
import { officialAwards } from "@/lib/tournament/official-standings";
import { readState, saveSharing, writeState } from "@/lib/tournament/store";
import { fixtureAdapter, scoringFixture } from "./score-submission-fixture";

export async function setupBracket(tx:Db) {
  const f = await scoringFixture(tx,"knockout");
  const {id,judges,teams} = f;
  await saveSharing(tx,id,{listed:false,showDraw:false,showStandings:false});
  const [owner] = await tx.select({userId:s.tournaments.ownerId}).from(s.tournaments).where(eq(s.tournaments.id,id));
  const admin = {...owner,name:"Synthetic administrator",role:"host" as const};
  const host = judges[1];
  await tx.update(s.tournamentRoomStaff).set({role:"room_host"}).where(and(eq(s.tournamentRoomStaff.tournamentId,id),
    eq(s.tournamentRoomStaff.userId,host.userId)));
  const config = (await readState(tx,id)).config;
  const semi = {...config.rounds[0],stage:"semi-final" as const,maxPoints:9};
  const finalRound = {...semi,id:randomUUID(),stage:"final" as const};
  await writeState(tx,id,"config",{...config,rounds:[semi,finalRound]});
  const pair = {...f.pairing,stage:semi.stage,matchLabel:"Semi A"};
  const bye = {...pair,id:randomUUID(),matchLabel:"Semi B",teamAId:teams[2].id,teamBId:null};
  await writeState(tx,id,"pairings",[pair,bye]);
  await saveScoringPlan(tx,id,{rosters:[],rounds:[semi,finalRound].map(r=>({id:r.id,questions:f.plan.rounds[0].questions}))});
  let award = "";
  for (const team of teams.slice(0,2)) {
    for (const q of f.plan.rounds[0].questions) {
      const points = q.id !== f.data.questionKey ? 0 : team.id === teams[0].id ? 2 : 1;
      const receipt = await f.submit({...f.data,teamId:team.id,questionKey:q.id,points,clientRequestId:randomUUID()});
      await decideRoomScore(f.adapter,id,"hall",host,{scoreId:receipt.scoreId,decision:"approve"});
      if (points === 2) award = receipt.scoreId;
    }
  }
  for (const p of [pair,bye]) {
    const {configRevision,lifecycleRevision} = await roomCompletion(f.adapter,id,"hall",host,p.id,true);
    await roomCompletion(f.adapter,id,"hall",host,{contextId:p.id,configRevision,lifecycleRevision});
  }
  const final = {...pair,id:randomUUID(),stage:finalRound.stage,matchLabel:"Final",teamBId:teams[2].id,released:false};
  return {id,judge:judges[0],host,admin,award,pair,bye,final,teams,finalRound,data:f.data};
}
type Bracket = Awaited<ReturnType<typeof setupBracket>>;

function actions(db:Db,b:Bracket) {
  const {id,judge,host,admin,pair} = b;
  const adapter = fixtureAdapter(db,id);
  return {
    propose:(scoreId:string,points:number) => proposeCorrection(adapter,id,"hall",judge,
      {scoreId,points,reason:"Synthetic score sheet verification",clientRequestId:randomUUID()}),
    decide:(scoreId:string,decision="approve",who:{userId:number;name:string;role:"judge"|"host"}=host) => decideRoomScore(adapter,id,"hall",who,
      decision === "approve" ? {scoreId,decision} : {scoreId,decision,reason:"Ruling reviewed independently"}),
    draw:(final:typeof b.final) => adapter.transaction(async tx => {
      const {pairings} = await readState(tx,id);
      await saveRoomPairings(tx,id,[...pairings.filter(p=>p.id!==final.id),final],pairings);
    }),
    reopen:async () => {
      const {configRevision,lifecycleRevision} = await ownerReopening(adapter,id,"hall",admin,pair.id,true);
      return ownerReopening(adapter,id,"hall",admin,{contextId:pair.id,configRevision,lifecycleRevision,reason:"Recheck upstream award"});
    },
    close:async () => {
      const {configRevision,lifecycleRevision} = await roomCompletion(adapter,id,"hall",host,pair.id,true);
      return roomCompletion(adapter,id,"hall",host,{contextId:pair.id,configRevision,lifecycleRevision});
    },
    api:(input?:unknown,who:{userId:number;name:string;role:"judge"|"host"}=admin,client=adapter) => {
      const handler = adjudicationHandlers(()=>client,async()=>who);
      const req = new NextRequest("https://quizotab.test/adjudication",input === undefined ? {} : {method:"POST",body:JSON.stringify(input)});
      return handler[input===undefined?"GET":"POST"](req,{params:Promise.resolve({id})});
    }
  };
}

export async function verifyAdjudication(db:Db) {
  const b = await setupBracket(db);
  const a = actions(db,b);
  const stable = await a.propose(b.award,3);
  await a.decide(stable.scoreId);
  const change = await a.propose(stable.scoreId,0);
  await assert.rejects(a.decide(change.scoreId),{status:409});
  await a.reopen();
  await a.decide(change.scoreId);
  await a.close();
  const draft = {...b.final,teamAId:b.teams[1].id};
  await a.draw(draft);
  const preview = await ownerReopening(fixtureAdapter(db,b.id),b.id,"hall",b.admin,b.pair.id,"preview");
  assert.ok("blocker" in preview && /later draw/.test(preview.blocker ?? ""));
  const conflicting = await a.propose(change.scoreId,3);
  await assert.rejects(a.decide(conflicting.scoreId),{status:409});
  assert.equal((await a.api(undefined,b.judge)).status,404);
  const current = async () => {
    const response = await a.api();
    assert.equal(response.status,200);
    const [c] = (await response.json()).cases;
    assert.ok(c);
    return c;
  };
  const cmd = async (action:string) => ({action,version:(await current()).version,scoreId:conflicting.scoreId,
    reason:"Synthetic competition ruling",requestId:randomUUID()});
  const draftCase = await current();
  const monitor=await readOperations(fixtureAdapter(db,b.id),b.id,b.admin);
  assert.ok(monitor.rooms.find(r=>r.id==="hall")?.contexts.find(c=>c.id===draft.id)?.disputes.some(d=>d.scoreId===conflicting.scoreId));
  assert.ok(draftCase.changes.includes("downstream participants"));
  assert.ok(draftCase.dependent[0].slotChange.proposed.includes(b.teams[0].id));
  const hold = await cmd("hold");
  assert.equal((await a.api(hold,b.judge)).status,404);
  assert.equal((await a.api(hold)).status,200);
  assert.equal((await a.api(hold)).status,200);
  const {history} = await (await a.api()).json();
  assert.equal(history.length,1);
  assert.equal(history[0].actor,b.admin.userId);
  assert.equal(history[0].reason,hold.reason);
  assert.ok(Number.isFinite(Date.parse(history[0].at)));
  assert.equal((await a.api({...hold,reason:"Different reason for the same request"})).status,409);
  assert.equal((await a.api({...hold,action:"withdraw",requestId:randomUUID()})).status,409);
  await assert.rejects(a.draw({...draft,released:true}),{status:409});
  assert.equal((await a.api(await cmd("resume"))).status,200);
  const withdraw = await cmd("withdraw");
  // Inject a history insertion failure after the draft removal.
  await assert.rejects(ownerAdjudication(
    fixtureAdapter(db,b.id,"ruling"),b.id,b.admin,withdraw),/Injected ruling/);
  assert.ok((await readState(db,b.id)).pairings.some(p=>p.id===draft.id));
  assert.equal((await a.api(withdraw)).status,200);
  assert.ok(!(await readState(db,b.id)).pairings.some(p=>p.id===draft.id));
  await assert.rejects(a.decide(conflicting.scoreId),{status:409});
  await a.reopen();
  await assert.rejects(a.decide(conflicting.scoreId,"approve",b.admin),{status:403});
  await a.decide(conflicting.scoreId);
  await a.close();
  await a.draw({...b.final,released:true});
  for (const scored of [false,true]) {
    if (scored) await submitRoomScore(fixtureAdapter(db,b.id),b.id,"hall",b.judge,
      {...b.data,contextId:b.final.id,roundId:b.finalRound.id,points:2,clientRequestId:randomUUID()});
    const pending = await a.propose(conflicting.scoreId,0);
    await assert.rejects(a.decide(pending.scoreId),{status:409});
    await assert.rejects(a.decide(pending.scoreId,"reject"),{status:409});
    const queue = await pendingRoomScores(fixtureAdapter(db,b.id),b.id,"hall",b.host);
    assert.deepEqual(queue.find(s=>s.scoreId===pending.scoreId)?.adjudication,{approval:true,rejection:true});
    const c = await current();
    assert.equal(c.dependent[0].scored,scored);
    assert.equal(c.dependent[0].released,true);
    const command = {scoreId:pending.scoreId,version:c.version,reason:"Preserve the played draw",requestId:randomUUID()};
    assert.equal((await a.api({...command,action:"withdraw"})).status,409);
    assert.equal((await a.api({...command,action:"uphold"})).status,200);
    await assert.rejects(a.reopen(),{status:409});
    await assert.rejects(a.decide(pending.scoreId),{status:409});
    await a.decide(pending.scoreId,"reject");
    assert.deepEqual((await (await a.api()).json()).cases,[]);
  }
  const awards = await officialAwards(db,b.id);
  const {config} = await readState(db,b.id);
  const prelim = {...b.pair,stage:"preliminary" as const,matchLabel:"Match 1"};
  const championship = {...config,format:"championship" as const,qualificationCount:2,
    rounds:[{...config.rounds[0],stage:prelim.stage,match:prelim.matchLabel}]};
  const row = awards.find(r=>r.teamId===b.teams[0].id)!;
  const opponent = awards.find(r=>r.teamId===b.teams[1].id)!;
  const entrant = {...row,contextId:b.bye.id,teamId:b.teams[2].id,points:2};
  const teams = b.teams.map((t,i)=>({...t,name:["A","B","C"][i]}));
  function compare(previous:number,next:number,other:number,cut:number,tiebreakWinnerId:string|null=null) {
    return compareCorrection({...championship,qualificationCount:cut},[{...prelim,tiebreakWinnerId}],teams,
      [{...row,points:previous},{...opponent,points:other},entrant],{...row,points:next},previous);
  }
  assert.ok(compare(3,1,0,1).changes.includes("qualification"));
  assert.ok(!compare(3,1,0,1).changes.includes("winner"));
  assert.ok(compare(3,1,0,2).changes.includes("seeding"));
  assert.ok(compare(1,2,1,2,b.teams[0].id).changes.includes("tiebreak"));
  console.log("ok  finalized results, qualification, seeding, tiebreak, draft withdrawal, released and scored adjudication");
  return b.id;
}

export async function verifyTiebreakRetirement(db:Db) {
  const b = await setupBracket(db);
  const a = actions(db,b);
  await a.reopen();
  const tie = await a.propose(b.award,1);
  await a.decide(tie.scoreId);
  const adapter = fixtureAdapter(db,b.id);
  await adapter.transaction(async tx => {
    const {pairings} = await readState(tx,b.id);
    await saveRoomPairings(tx,b.id,pairings.map(p => p.id === b.pair.id ? {...p,tiebreakWinnerId:b.teams[0].id} : p),pairings);
  });
  await a.close();
  const correction = await a.propose(tie.scoreId,2);
  await assert.rejects(a.decide(correction.scoreId),{status:409});
  await a.reopen();
  await a.decide(correction.scoreId);
  assert.equal((await readState(db,b.id)).pairings.find(p=>p.id===b.pair.id)?.tiebreakWinnerId,null);
  await a.close();
}

// Both clients commit independently on the same synthetic tournament.
export async function verifyIndependentRaces(writer:Db,other:Db,b:Bracket) {
  const first = actions(writer,b);
  const second = actions(other,b);
  const neutral = await first.propose(b.award,3);
  const compatible = await Promise.allSettled([first.decide(neutral.scoreId),second.draw(b.final)]);
  assert.ok(compatible.every(r=>r.status==="fulfilled"));
  const proposal = await first.propose(neutral.scoreId,0);
  const contested = await Promise.allSettled([first.decide(proposal.scoreId),second.draw({...b.final,released:true})]);
  assert.ok(contested.every(r=>r.status==="rejected" && r.reason.status===409));
  const [dispute] = (await (await first.api()).json()).cases;
  const withdrawn = await first.api({action:"withdraw",scoreId:proposal.scoreId,version:dispute.version,
    reason:"Withdraw synthetic draft",requestId:randomUUID()});
  assert.equal(withdrawn.status,200);
  await first.reopen();
  await first.decide(proposal.scoreId);
  await first.close();
  const final = {...b.final,teamAId:b.teams[1].id,released:true};
  const race = await Promise.allSettled([first.reopen(),second.draw(final)]);
  assert.equal(race.filter(r=>r.status==="fulfilled").length,1);
  assert.ok(race.some(r=>r.status==="rejected" && r.reason.status===409));
  const persisted = (await readState(other,b.id)).pairings.some(p=>p.id===final.id);
  assert.equal(persisted,race[1].status==="fulfilled");
  console.log("ok  neutral approval and draft committed; impactful approval and advancement refused; reopen / release",race.map(r=>r.status));
}
