// Three-minute local service workload, accessible only through the disposable cluster runner.
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
import {setTimeout as sleep} from "node:timers/promises";
import pg from "pg";
import {drizzle} from "drizzle-orm/node-postgres";
import {scoringFixture,fixtureAdapter} from "./score-submission-fixture.ts";
import {readState,writeState} from "../lib/tournament/store.ts";
import {saveScoringPlan} from "../lib/tournament/scoring-plan.ts";
import {withRoomOwner} from "../lib/tournament/room-access.ts";
import {saveRoomPairings} from "../lib/tournament/room-management.ts";
import {submitRoomScore} from "../lib/tournament/room-scoring.ts";
import {decideRoomScore,pendingRoomScores} from "../lib/tournament/score-review.ts";
import {completionPreview,roomCompletion} from "../lib/tournament/fixture-lifecycle.ts";
import {staffWorkspace} from "../lib/tournament/staff-workspace.ts";
import {readOperations} from "../lib/tournament/room-operations.ts";
import {spectatorView} from "../lib/tournament/spectator.ts";
import {officialAwards} from "../lib/tournament/official-standings.ts";

export async function nativeEventSmoke({admin,bootstrap,port}) {
  const setup=drizzle(admin);
  const f=await scoringFixture(setup,"championship");
  const {config}=await readState(setup,f.id);
  const round=config.rounds[0];
  await writeState(setup,f.id,"config",{...config,rounds:[round]});
  await writeState(setup,f.id,"pairings",[]);
  await saveScoringPlan(setup,f.id,{rounds:[f.plan.rounds[0]],rosters:[]});
  const fourth=(await admin.query("insert into teams(tournament_id,name) values($1,'D') returning id",[f.id])).rows[0];
  const teams=[...f.teams,fourth];
  const rooms=["hall","west"];
  const hosts=[];
  for(const room of rooms) {
    const {rows:[user]}=await admin.query("insert into users(name,email,password) values($1,$2,'unused') returning id",[room,randomUUID()+"@test.invalid"]);
    hosts.push({userId:user.id,name:room,role:"host"});
    await admin.query("insert into tournament_room_staff(tournament_id,room_id,user_id,role) values($1,$2,$3,'room_host')",[f.id,room,user.id]);
  }
  await admin.query("update tournament_room_staff set room_id='west' where tournament_id=$1 and user_id=$2",[f.id,f.judges[1].userId]);
  const {rows:[owner]}=await admin.query("select owner_id from tournaments where id=$1",[f.id]);
  const actor={userId:owner.owner_id,name:"Owner",role:"host"};
  const fixtures=rooms.map((roomId,i)=>({...f.pairing,id:randomUUID(),released:true,roomId,teamAId:teams[2*i].id,teamBId:teams[2*i+1].id}));
  const password=randomBytes(32).toString("hex");
  await bootstrap.query("alter role quizotab_pilot_app password '"+password+"'");
  const pool=new pg.Pool({host:"127.0.0.1",port,database:"quizotab_pilot",user:"quizotab_pilot_app",password,
    application_name:"qt_local_load",max:8,connectionTimeoutMillis:2000,statement_timeout:5000});
  const db=fixtureAdapter(drizzle(pool),f.id);
  const latencies=new Map();
  let peakActive=0,peakWaiting=0,peakRss=0,peakLocks=0,peakCalls=0,active=0,failed=false;
  async function timed(name,call) {
    const begin=performance.now();
    peakCalls=Math.max(peakCalls,++active);
    try {return await call();} catch(error) {failed=true;throw error;}
    finally {
      active--;
      const times=latencies.get(name)??[];
      times.push(performance.now()-begin);
      latencies.set(name,times);
    }
  }
  try {
    await timed("release",()=>withRoomOwner(db,f.id,actor,tx=>saveRoomPairings(tx,f.id,fixtures,[])));
    const start=performance.now();
    const jobs=[];
    function schedule(offset,period,job) {
      jobs.push((async()=>{
        for(let t=offset;t<180000 && !failed;t+=period) {
          await sleep(Math.max(0,start+t-performance.now()));
          if(failed) break;
          await job(Math.floor((t-offset)/period));
        }
      })().catch(error=>{failed=true;throw error;}));
    }
    for(let i=0;i<6;i++) schedule(i*1000,6000,()=>timed("spectator",()=>spectatorView(db,f.id,"standings",i%2?rooms[i%3%2]:undefined)));
    schedule(0,15000,()=>timed("owner",()=>readOperations(db,f.id,actor)));
    for(const [i,room] of rooms.entries()) {
      const judge=f.judges[i],host=hosts[i],fixture=fixtures[i];
      schedule(i*1000,12000,async()=>{
        await Promise.all([
          timed("judge",()=>staffWorkspace(db,f.id,room,judge,"judge")),
          timed("host",()=>staffWorkspace(db,f.id,room,host,"room_host")),
          timed("queue",()=>pendingRoomScores(db,f.id,room,host)),
          timed("preview",()=>completionPreview(db,f.id,room,host,fixture.id)),
        ]);
      });
      schedule(2500,60000,async q=>{
        for(let team=0;team<2;team++) {
          const payload={...f.data,contextId:fixture.id,teamId:teams[i*2+team].id,questionKey:["q-a","q-b","q-c"][q],
            points:(i+team+q)%4,clientRequestId:randomUUID()};
          const receipt=await timed("submit",()=>submitRoomScore(db,f.id,room,judge,payload));
          assert.ok(receipt.created);
          await timed("review",()=>decideRoomScore(db,f.id,room,host,{scoreId:receipt.scoreId,decision:"approve"}));
        }
      });
    }
    schedule(0,5000,async()=>{
      peakActive=Math.max(peakActive,pool.totalCount-pool.idleCount);
      peakWaiting=Math.max(peakWaiting,pool.waitingCount);
      peakRss=Math.max(peakRss,process.memoryUsage.rss());
      const count=(await bootstrap.query("select count(*)::int n from pg_stat_activity where application_name='qt_local_load' and wait_event_type='Lock'")).rows[0].n;
      peakLocks=Math.max(peakLocks,count);
    });
    const completed=await Promise.allSettled(jobs);
    for(const result of completed) if(result.status==="rejected") throw result.reason;
    const drain=performance.now();
    for(const [i,room] of rooms.entries()) {
      const contextId=fixtures[i].id;
      const {configRevision,lifecycleRevision}=await roomCompletion(db,f.id,room,hosts[i],contextId,true);
      await timed("close",()=>roomCompletion(db,f.id,room,hosts[i],{contextId,configRevision,lifecycleRevision}));
    }
    const points=new Map((await officialAwards(setup,f.id)).map(r=>[r.teamId,r.points]));
    assert.deepEqual(teams.map(t=>points.get(t.id)),[3,6,6,5]);
    const audit=(await admin.query("select count(distinct s.id)::int entries,count(e.id)::int events from tournament_score_entries s left join tournament_score_events e on e.score_entry_id=s.id where s.tournament_id=$1",[f.id])).rows[0];
    assert.deepEqual(audit,{entries:12,events:24});
    const calls=[...latencies.values()].flat().length;
    console.log("local service workload",{calls,callsPerSecond:calls/((performance.now()-start)/1000),peakCalls,peakActive,peakWaiting,peakLocks,
      peakRssMiB:Math.round(peakRss/1048576),drainAndCloseMs:Math.round(performance.now()-drain),errors:0});
    for(const [name,times] of latencies) {
      times.sort((a,b)=>a-b);
      console.log(name,times.length,...[.5,.95,.99].map(p=>Math.ceil(times[Math.ceil(times.length*p)-1])));
    }
  } finally {await pool.end();}
}
