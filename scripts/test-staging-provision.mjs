// Used only inside the native runner's new loopback cluster.
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {drizzle} from "drizzle-orm/node-postgres";
import {provision,verifyStagingRecovery} from "./staging-provision.mjs";
import {restoreEvidence} from "./restore-evidence.mjs";
import {describeStagingFixture} from "../lib/db/staging-approval.ts";
import {submitRoomScore} from "../lib/tournament/room-scoring.ts";
import {decideRoomScore} from "../lib/tournament/score-review.ts";
import {spectatorView} from "../lib/tournament/spectator.ts";
import {checkLogin} from "../lib/auth/accounts.ts";
import {readState} from "../lib/tournament/store.ts";
import {testStagingLogin} from "./test-staging-login.mjs";

export async function testStagingProvision({admin,app,connect,dir}) {
  const pins={projectId:"local-stage",branchId:"br-local-stage",endpointId:"ep-local-stage",database:"quizotab_pilot",
    directHost:"ep-local-stage.test.neon.tech",runtimeRole:"quizotab_pilot_app",setupRole:"quizotab_pilot_setup"};
  const tournament=randomUUID(), raw={purpose:"synthetic-staging-acceptance",pins,tournament,spectators:30,origin:"https://stage.example.test",project:"prj_fixture"};
  const trusted=[describeStagingFixture(raw).digest],passwords=Array.from({length:5},()=>randomBytes(32).toString("hex"));
  const verify=()=>provision(admin,raw,"verify",{trusted});
  await assert.rejects(provision(admin,raw,"install"),/independent approval/);
  await assert.rejects(provision(admin,raw,"install",{trusted})); // server still reports retained pilot
  await admin.query("set neon.project_id='local-stage'; set neon.branch_id='br-local-stage'; set neon.endpoint_id='ep-local-stage'");
  await assert.rejects(verify());
  await provision(admin,raw,"install",{trusted});
  await provision(admin,raw,"install",{trusted}); // verified no-op
  await assert.rejects(provision(admin,{...raw,tournament:randomUUID()},"fixture",{trusted,passwords}));
  await provision(admin,raw,"fixture",{trusted,passwords});
  const observer=await connect("quizotab_pilot");
  await observer.query("set session authorization quizotab_pilot_setup; set neon.project_id='local-stage'; set neon.branch_id='br-local-stage'; set neon.endpoint_id='ep-local-stage'");
  const fixture=await provision(observer,raw,"verify",{trusted});
  assert.equal(fixture.staff,4);
  await assert.rejects(provision(admin,raw,"fixture",{trusted,passwords}));
  const second=await connect("quizotab_pilot");
  for(const connection of [app,second]) await connection.query("set session authorization quizotab_pilot_app; set statement_timeout='10s'");
  await assert.rejects(app.query("insert into tournaments(owner_id,name,year,scoring_engine_version) values($1,'Denied',2026,'room_v1')",[fixture.owner]),{code:"QT403"});
  await assert.rejects(admin.query("update tournaments set scoring_engine_version='legacy' where id=$1",[tournament]),{code:"QT403"});
  const {config,pairings}=await readState(drizzle(app),tournament);
  const pair=pairings[0],room=pair.roomId;
  async function login(label,password) {
    const result=await checkLogin(drizzle(app),label+"."+tournament+"@stage.invalid",password);
    assert.equal(result.status,"ok");
    return {userId:result.user.id,name:result.user.name,role:result.user.role};
  }
  const judge=await login("east-judge",passwords[1]),host=await login("east-host",passwords[3]);
  await testStagingLogin({dir,db:drizzle(app),email:"east-judge."+tournament+"@stage.invalid",password:passwords[1],tournament,room});
  const data={roundId:config.rounds[0].id,questionKey:"q-1",teamId:pair.teamAId,contextId:pair.id,points:2,clientRequestId:randomUUID()};
  await admin.query("begin");
  let writes;
  try {
    await admin.query("select id from tournaments where id=$1 for update",[tournament]);
    writes=Promise.allSettled([app,second].map(c=>submitRoomScore(drizzle(c),tournament,room,judge,data)));
    const pids=[app.processID,second.processID];
    let blocked=0;
    for(let i=0;i<100 && blocked!==2;i++) {
      blocked=(await observer.query("select pid from pg_stat_activity where pid=any($1::int[]) and cardinality(pg_blocking_pids(pid))>0",[pids])).rowCount;
      if(blocked<2) await new Promise(r=>setTimeout(r,25));
    }
    assert.equal(blocked,2);
    console.log("Observed both staging writers blocked",pids);
  } finally {await admin.query("rollback");}
  const outcomes=await writes;
  for(const r of outcomes) if(r.status==="rejected") throw r.reason;
  const receipts=outcomes.map(r=>r.value);
  assert.equal(receipts.filter(r=>r.created).length,1);
  assert.equal(receipts[0].scoreId,receipts[1].scoreId);
  const board=async()=>(await spectatorView(drizzle(second),tournament,"standings",room)).tables[0].rows;
  assert.ok((await board()).every(r=>r.total===0));
  await decideRoomScore(drizzle(app),tournament,room,host,{scoreId:receipts[0].scoreId,decision:"approve"});
  assert.equal((await board()).reduce((n,r)=>n+r.total,0),2);
  assert.equal((await observer.query("select count(*)::int as n from tournament_score_events")).rows[0].n,2);
  await assert.rejects(admin.query("delete from tournament_score_events"));
  await verify();
  const snapshot=await restoreEvidence(drizzle(observer),{database:pins.database,login:pins.setupRole,role:pins.setupRole,
    project:pins.projectId,branch:pins.branchId,endpoint:pins.endpointId},tx=>verifyStagingRecovery(tx,describeStagingFixture(raw)));
  assert.equal(snapshot.tournament_score_entries.count,1);
  assert.equal(snapshot.tournament_score_events.count,2);
  console.log("Verified restricted staging provisioning, approval, rollback, real room scoring, audit and standings.");
}
