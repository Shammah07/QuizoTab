// Deterministic protocol fixture for the bounded driver. No network or credentials.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {rehearsal} from "./staging-https.mjs";
import {describeStagingFixture} from "../lib/db/staging-approval.ts";

async function test(spectators, fault) {
  const n=spectators===30?15:10;
  const m={origin:"https://stage.example.test",project:"prj_fixture",commit:"a".repeat(40),tournament:randomUUID(),owner:1,spectators,
    publicText:["Fixture","Hall","West"],pins:{projectId:"local-stage",branchId:"br-stage",endpointId:"ep-stage",directHost:"ep-stage.test.neon.tech",
      database:"quizotab_pilot",runtimeRole:"quizotab_pilot_app",setupRole:"quizotab_pilot_setup"},
    rooms:[0,1].map(i=>({id:randomUUID(),context:"room"+i,round:"round",judge:2+i,host:4+i,
      teams:[0,1].map(j=>({id:randomUUID(),name:"Synthetic "+i+j})),questions:Array.from({length:n},(_,q)=>"q"+q)}))};
  const s={observer:"s".repeat(32),owner:"owner",judges:["judge0","judge1"],hosts:["host0","host1"],guestCode:"ABCDEF"};
  const rows=[],log=[];
  let shared=true,revoked=false;
  const json=(value,status=200)=>Response.json(value,{status});
  const transport=async(url,options)=>{
    const parts=url.pathname.split("/"),room=m.rooms.find(r=>r.id===parts[5]);
    const i=m.rooms.indexOf(room),cookie=options.headers.cookie?.split("=")[1],body=options.body?JSON.parse(options.body):{};
    if(url.pathname==="/api/staging/acceptance") return json({id:m.tournament,owner:m.owner,project:m.project,commit:m.commit,origin:m.origin,
      identity:{project_id:fault==="identity"?"wrong":m.pins.projectId,branch_id:m.pins.branchId,endpoint_id:m.pins.endpointId,
        database:m.pins.database,login_role:m.pins.runtimeRole,effective_role:m.pins.runtimeRole},
      ledger:rows,instance:"local",pool:{active:1,max:10,waiting:0},lock:{seconds:0},rss:1000,cpu:{user:2,system:1},memoryLimitMiB:512});
    if(url.pathname.endsWith("/workspace")) {
      if(revoked && cookie===s.judges[0]) return json({},401);
      if(cookie!==s.judges[i] && cookie!==s.hosts[i]) return json({},403);
      return json({userId:cookie===s.judges[i]?room.judge:room.host});
    }
    if(url.pathname.endsWith("/operations")) return json({});
    if(url.pathname.endsWith("/sharing")) {shared=false;return json({});}
    if(url.pathname.endsWith("/session")) {revoked=true;return json({});}
    if(url.pathname.endsWith("/completion")) return json({configRevision:"test",lifecycleRevision:1,completed:!!options.body});
    if(url.pathname.endsWith("/scores")) {
      const row={id:randomUUID(),client_request_id:body.clientRequestId,team_id:body.teamId,context_id:body.contextId,round_id:body.roundId,
        question_key:body.questionKey,points:body.points,room_id:room.id,judge_user_id:room.judge,reviewer_user_id:null,status:"pending",events:[["submitted",room.judge]]};
      rows.push(row);return json({scoreId:row.id,status:"pending"},201);
    }
    if(url.pathname.endsWith("/pending")) return json({scores:rows.filter(r=>r.status==="pending"&&r.room_id===room.id).map(r=>({scoreId:r.id,points:r.points,judgeUserId:r.judge_user_id}))});
    if(url.pathname.endsWith("/decisions")) {
      const row=rows.find(r=>r.id===body.scoreId);
      Object.assign(row,{status:"approved",reviewer_user_id:room.host});row.events.push(["approved",room.host]);return json({status:"approved"});
    }
    if(!shared) return json({},404);
    const teams=m.rooms.filter(r=>!url.searchParams.has("room") || url.searchParams.get("room")===r.id).flatMap(r=>r.teams);
    return json({rooms:[],fixtures:[],contexts:[],updatedAt:null,tables:[{label:"Fixture",rows:teams.map(t=>({name:t.name,
      total:rows.filter(r=>r.team_id===t.id&&r.status==="approved").reduce((sum,r)=>sum+r.points,0),rounds:[]}))}],...(fault==="privacy"?{actor:"private"}:{})});
  };
  const {digest}=describeStagingFixture({purpose:"synthetic-staging-acceptance",pins:m.pins,origin:m.origin,project:m.project,tournament:m.tournament,spectators:m.spectators});
  await assert.rejects(rehearsal(m,s,()=>{}, {transport:()=>assert.fail("Premature HTTPS connection")}),/independent approval/);
  const run=()=>rehearsal(m,s,msg=>log.push(msg),{transport,intervalScale:0,trusted:[digest]});
  if(fault) {await assert.rejects(run());assert.equal(rows.length,0);return;}
  const report=await run();
  assert.equal(report.entries,n*4);assert.equal(report.events,n*8);
  assert.equal(report.errors,0);assert.ok(revoked&&!shared);
  assert.equal(log.filter(msg=>msg.action==="submit").length,n*4);
}
for(const level of [30,60]) await test(level);
await test(30,"identity");await test(30,"privacy");
console.log("ok  30/60 spectator schedules, reviewed public projection, session/sharing revocation, ledger and fail-closed mismatch");
