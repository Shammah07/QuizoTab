// Called only from the runner that creates its own SCRAM-protected loopback cluster.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {drizzle} from "drizzle-orm/node-postgres";
import {fixtureAdapter,scoringFixture} from "./score-submission-fixture.ts";
import {setupBracket,verifyIndependentRaces} from "./adjudication-checks.ts";
import {submitRoomScore} from "../lib/tournament/room-scoring.ts";
import {decideRoomScore,proposeCorrection} from "../lib/tournament/score-review.ts";
import {changeRoom,listRoomSetup} from "../lib/tournament/room-management.ts";
import {roomCompletion,ownerReopening} from "../lib/tournament/fixture-lifecycle.ts";
import {officialAwards} from "../lib/tournament/official-standings.ts";
import {writeState} from "../lib/tournament/store.ts";
import {pooledDatabase} from "../lib/db/pooled-transactions.ts";

export async function checkNativeScoring({admin, app, second, observer, port, password}) {
  const setup = drizzle(admin), left = drizzle(app), right = drizzle(second);
  const pids = [app.processID,second.processID];
  assert.equal(new Set([...pids,admin.processID,observer.processID]).size,4);
  for (const client of [app,second]) assert.equal((await client.query("select current_user")).rows[0].current_user,"quizotab_pilot_app");
  // Observe both writers in the server lock queue before releasing the common row.
  async function race(id, first, next) {
    await observer.query("begin");
    let outcomes;
    try {
      await observer.query("select id from tournaments where id=$1 for update",[id]);
      outcomes = Promise.allSettled([first(),next()]);
      let waiting = 0;
      for(let i=0;i<100 && waiting<2;i++) {
        waiting = (await admin.query("select pid from pg_stat_activity where pid=any($1::int[]) and cardinality(pg_blocking_pids(pid))>0",[pids])).rowCount;
        if(waiting<2) await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(waiting,2,"Expected both writers waiting on database locks");
    } finally { await observer.query("rollback"); }
    return outcomes;
  }
  function winner(results, status) {
    const ok = results.filter(r=>r.status==="fulfilled");
    assert.equal(ok.length,1);
    assert.equal(results.find(r=>r.status==="rejected").reason.status,status);
    return ok[0].value;
  }
  const f = await scoringFixture(setup,"championship");
  const a = fixtureAdapter(left,f.id), b = fixtureAdapter(right,f.id);
  const ownerId = (await admin.query("select owner_id from tournaments where id=$1",[f.id])).rows[0].owner_id;
  const host = {userId:ownerId,name:"Fixture owner",role:"host"};
  await admin.query("insert into tournament_room_staff(tournament_id,room_id,user_id,role) values($1,'hall',$2,'room_host')",[f.id,ownerId]);
  const send = (db,data,judge=f.judges[0],room="hall")=>submitRoomScore(db,f.id,room,judge,data);
  let previousEvents = [];
  async function reconcile(entryCount,eventCount,points) {
    const entries = (await observer.query("select * from tournament_score_entries where tournament_id=$1",[f.id])).rows;
    const events = (await observer.query("select e.* from tournament_score_events e join tournament_score_entries s on s.id=e.score_entry_id where s.tournament_id=$1",[f.id])).rows;
    assert.equal(entries.length,entryCount);
    assert.equal(events.length,eventCount);
    for (const old of previousEvents) assert.deepEqual(events.find(row=>row.id===old.id),old);
    previousEvents = events;
    for(const entry of entries) {
      const submitted = events.filter(e=>e.score_entry_id===entry.id && e.event_type==="submitted");
      assert.equal(submitted.length,1);
      assert.equal(submitted[0].actor_user_id,entry.judge_user_id);
      if (["approved","rejected"].includes(entry.status)) {
        const decision = events.filter(e=>e.score_entry_id===entry.id && e.event_type===entry.status);
        assert.equal(decision.length,1);
        assert.equal(decision[0].actor_user_id,entry.reviewer_user_id);
      }
    }
    const awards = await officialAwards(drizzle(observer),f.id);
    assert.equal(awards.reduce((sum,row)=>sum+row.points,0),points);
    return entries;
  }
  const dup = await race(f.id,()=>send(a,f.data),()=>send(b,f.data));
  assert.ok(dup.every(r=>r.status==="fulfilled"));
  assert.equal(dup[0].value.scoreId,dup[1].value.scoreId);
  assert.equal(dup.filter(r=>r.value.created).length,1);
  await reconcile(1,1,0);
  const input = {...f.data,questionKey:"q-b",clientRequestId:randomUUID()};
  const conflict = await race(f.id,()=>send(a,input),()=>send(b,{...input,points:1}));
  const receipt = winner(conflict,409);
  const rows = await reconcile(2,2,0);
  assert.equal(rows.find(r=>r.id===receipt.scoreId).points,conflict[0].status==="fulfilled"?2:1);
  const west = {...f.pairing,id:randomUUID(),roomId:"west",teamAId:f.teams[2].id};
  await writeState(setup,f.id,"pairings",[f.pairing,west]);
  await admin.query("update tournament_room_staff set room_id='west' where tournament_id=$1 and user_id=$2",[f.id,f.judges[1].userId]);
  const westScore = {...f.data,teamId:west.teamAId,contextId:west.id,clientRequestId:randomUUID()};
  await assert.rejects(send(a,westScore,f.judges[0],"west"),{status:403});
  const separate = await race(f.id,()=>send(a,{...f.data,questionKey:"q-c",clientRequestId:randomUUID()}),()=>send(b,westScore,f.judges[1],"west"));
  assert.ok(separate.every(r=>r.status==="fulfilled" && r.value.created));
  await reconcile(4,4,0);
  const scoreId = dup[0].value.scoreId;
  // Competing approvals are mutually exclusive; either winner gives the same award.
  const approve = db=>decideRoomScore(db,f.id,"hall",host,{scoreId,decision:"approve"});
  winner(await race(f.id,()=>approve(a),()=>approve(b)),409);
  await reconcile(4,5,2);
  const correct = db=>proposeCorrection(db,f.id,"hall",f.judges[0],{scoreId,points:1,reason:"Local score sheet",clientRequestId:randomUUID()});
  winner(await race(f.id,()=>correct(a),()=>correct(b)),409);
  await reconcile(5,6,2);
  const contestedId = separate[0].value.scoreId;
  const decide = (db,decision)=>decideRoomScore(db,f.id,"hall",host,{scoreId:contestedId,decision,
    ...(decision==="reject"?{reason:"Local evidence discrepancy"}:{})});
  const competing = await race(f.id,()=>decide(a,"approve"),()=>decide(b,"reject"));
  winner(competing,409);
  const points = competing[0].status==="fulfilled" ? 4 : 2;
  await reconcile(5,7,points);
  const setupView = await listRoomSetup(a,f.id,host);
  const assignment = setupView.assignments.find(row=>row.roomId==="hall" && row.role==="judge");
  const revoke = ()=>changeRoom(a,f.id,host,{revision:setupView.revision,command:{action:"revoke",roomId:"hall",assignmentId:assignment.id}});
  const late = {...f.data,teamId:f.teams[1].id,clientRequestId:randomUUID()};
  const [revoked,attempt] = await race(f.id,revoke,()=>send(b,late));
  assert.equal(revoked.status,"fulfilled");
  if(attempt.status==="rejected") assert.equal(attempt.reason.status,403);
  await assert.rejects(send(b,late),{status:403});
  const extra = Number(attempt.status==="fulfilled");
  await reconcile(5+extra,7+extra,points);

  const bracket = await setupBracket(setup);
  const ba = fixtureAdapter(left,bracket.id), bb = fixtureAdapter(right,bracket.id);
  const open = await ownerReopening(ba,bracket.id,"hall",bracket.admin,bracket.pair.id,true);
  await ownerReopening(ba,bracket.id,"hall",bracket.admin,{contextId:bracket.pair.id,configRevision:open.configRevision,lifecycleRevision:open.lifecycleRevision,reason:"Local closure rehearsal"});
  const ready = await roomCompletion(ba,bracket.id,"hall",bracket.host,bracket.pair.id,true);
  const close = db=>roomCompletion(db,bracket.id,"hall",bracket.host,{contextId:bracket.pair.id,configRevision:ready.configRevision,lifecycleRevision:ready.lifecycleRevision});
  const closed = await race(bracket.id,()=>close(ba),()=>close(bb));
  assert.ok(closed.every(r=>r.status==="fulfilled" && r.value.lifecycleRevision===ready.lifecycleRevision+1));
  await verifyIndependentRaces(left,right,bracket);
  // Exercise the application checkout wrapper over a native wire client.
  // Suppress a real committed reply at the client boundary; no network outage is claimed.
  const pool = new pg.Pool({host:"127.0.0.1",port,database:"quizotab_pilot",user:"postgres",password,max:1,connectionTimeoutMillis:2000});
  try {
    const client = await pool.connect();
    await client.query("set session authorization quizotab_pilot_app");
    const native = pooledDatabase(pool);
    const synthetic = fixtureAdapter(native,f.id);
    const payload = {...westScore,questionKey:"q-b",clientRequestId:randomUUID()};
    client.release();
    await assert.rejects(send(fixtureAdapter(native,f.id,true),payload,f.judges[1],"west"),error=>error.cause?.code==="23503");
    await reconcile(5+extra,7+extra,points);
    const query = client.query.bind(client);
    client.query = async (...args)=>{
      const result = await query(...args);
      if((args[0].text??args[0]).trim().toLowerCase()==="commit") throw new Error("Injected lost receipt");
      return result;
    };
    await assert.rejects(send(synthetic,payload,f.judges[1],"west"),/Commit outcome unconfirmed/);
    assert.equal(pool.totalCount,0);
    const saved = await reconcile(6+extra,8+extra,points);
    assert.equal(saved.filter(r=>r.client_request_id===payload.clientRequestId).length,1);
    const replacement = await pool.connect();
    try {
      await replacement.query("set session authorization quizotab_pilot_app");
      assert.equal((await replacement.query("select current_user")).rows[0].current_user,"quizotab_pilot_app");
    } finally { replacement.release(); }
    const retry = await send(synthetic,payload,f.judges[1],"west");
    assert.equal(retry.created,false);
    await reconcile(6+extra,8+extra,points);
  } finally { await pool.end(); }
  console.log("ok  native scoring, independent lock waiters, closure, rollback, ambiguous commit and pool recovery", {writerPids:pids,revocationOrder:attempt.status});
}
