import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import type { Db } from "@/lib/db";
import { tournaments, tournamentRoomStaff as staff } from "@/lib/db/schema";
import { changeOperations, readOperations } from "@/lib/tournament/room-operations";
import { operationsHandlers } from "@/lib/tournament/room-handlers";
import { decideRoomScore } from "@/lib/tournament/score-review";
import { type Format } from "@/lib/tournament/rules";
import { scoringFixture } from "./score-submission-fixture";

export async function verifyOperations(db:Db,format:Format) {
  const f=await scoringFixture(db,format);
  const {id,adapter,judges}=f;
  const [owner]=await db.select({userId:tournaments.ownerId}).from(tournaments).where(eq(tournaments.id,id));
  const admin={...owner,name:"Owner",role:"host" as const};
  const read=()=>readOperations(adapter,id,admin);
  const change=(body:Record<string,unknown>)=>changeOperations(adapter,id,admin,body);
  const save=async(plan:unknown)=>change({action:"save",revision:(await read()).revision,plan});
  const params={params:Promise.resolve({id})};
  const request=new NextRequest("https://quizotab.test/operations");
  const api=(session:typeof admin|typeof judges[number]|null)=>operationsHandlers(()=>adapter,async()=>session);
  assert.equal((await api(null).GET(request,params)).status,401);
  assert.equal((await api(judges[0]).GET(request,params)).status,404);
  assert.equal((await api(judges[0]).POST(new NextRequest(request.url,{method:"POST",body:"{}"}),params)).status,404);
  assert.equal((await api(admin).GET(request,params)).headers.get("Cache-Control"),"no-store");
  const dormant=await readOperations(db,id,admin);
  assert.equal(dormant.enabled,false);
  assert.ok(dormant.rooms[0].contexts[0].reasons.includes("Room scoring is disabled."));
  assert.equal((await read()).rooms[0].contexts[0].setup.includes("Assign a room host."),true);
  if(f.plan.rosters.length) await change({action:"withdraw",rosterId:f.data.contextId,revision:(await read()).revision});
  await save({rounds:[],rosters:[]});
  const draft={rounds:f.plan.rounds,rosters:f.plan.rosters.map(r=>({...r,released:false}))};
  const empty=await read();
  const concurrent=await Promise.allSettled([change({action:"save",plan:draft,revision:empty.revision}),
    change({action:"save",plan:{...draft,rounds:[draft.rounds[0]]},revision:empty.revision})]);
  assert.equal(concurrent.filter(r=>r.status==="fulfilled").length,1);
  assert.ok(concurrent.some(r=>r.status==="rejected" && r.reason.status===409));
  await save(draft);
  const round=draft.rounds[0];
  for (const [q,status] of [[{id:" ",minPoints:0,maxPoints:1},400],[{...round.questions[0],maxPoints:100001},400],
      [{...round.questions[0],maxPoints:50},422],[round.questions[1],422]] as const) {
    await assert.rejects(save({...draft,rounds:[{...round,questions:[q,...round.questions.slice(1)]}]}),{status});
  }
  if(draft.rosters.length) {
    const r=draft.rosters[0];
    await assert.rejects(save({...draft,rosters:[r,{...r,id:crypto.randomUUID(),roomId:"west"}]}),{status:422});
    await assert.rejects(save({...draft,rosters:[{...r,roomId:"absent"}]}),{status:422});
    await assert.rejects(change({action:"release",rosterId:r.id,revision:(await read()).revision}),{status:409});
  }
  await db.update(staff).set({role:"room_host"}).where(and(eq(staff.tournamentId,id),eq(staff.userId,judges[1].userId)));
  if(draft.rosters.length) {
    const west={...draft.rosters[0],id:crypto.randomUUID(),roomId:"west",teamIds:[f.teams[2].id]};
    await db.insert(staff).values([{tournamentId:id,roomId:"west",userId:judges[0].userId,role:"judge"},
      {tournamentId:id,roomId:"west",userId:judges[1].userId,role:"room_host"}]);
    await save({...draft,rosters:[...draft.rosters,west]});
    for(const roster of [...draft.rosters,west]){
      const cmd={action:"release",rosterId:roster.id,revision:(await read()).revision};
      await change(cmd);
      await assert.rejects(change(cmd),{status:409});
    }
    await f.submit({...f.data,contextId:west.id,teamId:f.teams[2].id,clientRequestId:crypto.randomUUID()},judges[0],"west");
  }
  const original=await f.submit();
  const pending=await read();
  const hall=pending.rooms.find(r=>r.id==="hall")!;
  assert.equal(hall.pending,1);
  assert.equal(hall.approved,0);
  assert.ok(hall.contexts[0].blockers.includes("Review pending submissions or corrections."));
  await decideRoomScore(adapter,id,"hall",judges[1],{scoreId:original.scoreId,decision:"approve"});
  const reviewed=await read();
  assert.equal(reviewed.rooms[0].approved,1);
  assert.equal(reviewed.rooms[0].pending,0);
  assert.equal(reviewed.rooms[0].missing,hall.missing-1);
  assert.equal(reviewed.rooms[1].pending,draft.rosters.length?1:0);
  assert.equal(reviewed.rooms[1].approved,0);
  await assert.rejects(save({...reviewed.plan,rounds:[{...round,questions:round.questions.map((q,i)=>i===0?{...q,id:"renamed"}:q)},...draft.rounds.slice(1)]}),{status:409});
  if(draft.rosters.length) {
    await assert.rejects(change({action:"withdraw",rosterId:f.data.contextId,revision:reviewed.revision}),{status:409});
    await assert.rejects(save({...reviewed.plan,rosters:reviewed.plan.rosters.map(r=>({...r,teamIds:[]}))}),{status:400});
    await assert.rejects(save({...reviewed.plan,rosters:reviewed.plan.rosters.map(r=>({...r,roomId:"west"}))}),{status:409});
  }
  console.log("ok  owner plan revisions, release controls, readiness, score coverage and room isolation:",format);
}
