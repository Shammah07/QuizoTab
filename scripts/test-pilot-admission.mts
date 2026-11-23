import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readPins } from "../lib/db/pilot-target";
import { preparePilotSchema } from "./pilot-migration";
import { pilotHostAdmission, readHostApproval } from "./pilot-host-admission";
import { pilotScorePermissions } from "./pilot-score-permissions";
import { pilotAdmission } from "./pilot-upgrade";
import type { Session } from "../lib/auth/session";

const pins = readPins({projectId:"noisy-violet-99522280",branchId:"br-restless-king-bdli89ow",endpointId:"ep-long-fog-bdc5rxjn",
  directHost:"ep-long-fog-bdc5rxjn.c-8.us-east-2.aws.neon.tech",database:"quizotab_pilot",runtimeRole:"quizotab_pilot_app",setupRole:"quizotab_pilot_setup"});
const initial = new PGlite();
await initial.exec("create role quizotab_pilot_owner");
await initial.exec("create database quizotab_pilot owner quizotab_pilot_owner");
const image = await initial.dumpDataDir();
await initial.close();
const local = new PGlite({database:pins.database,loadDataDir:image});
const db = drizzle(local);
const setup = () => local.exec("set session authorization quizotab_pilot_setup");
const runtime = () => local.exec("set session authorization quizotab_pilot_app");
const inspect = () => pilotAdmission(db,pins,"admission-preflight");
const upgrade = () => pilotAdmission(db,pins,"admission-upgrade");
const verify = () => pilotAdmission(db,pins,"admission-verify");
try {
  await local.exec(`create role quizotab_pilot_app login; create role quizotab_pilot_setup login;
    revoke temporary on database quizotab_pilot from public;
    grant create on database quizotab_pilot to quizotab_pilot_setup;
    grant usage,create on schema public to quizotab_pilot_setup;
    set neon.project_id='${pins.projectId}'; set neon.branch_id='${pins.branchId}'; set neon.endpoint_id='${pins.endpointId}'`);
  await setup();
  await preparePilotSchema(db,pins,"drizzle",true);
  const legacy = readFileSync("PILOT_PERMISSION_AUDIT.md","utf8").split("```sql")[1].split("```")[0];
  assert.equal((legacy.match(/\bGRANT\b/g)||[]).length,16);
  await local.exec(legacy);
  await inspect();
  await assert.rejects(pilotAdmission(db,{...pins,branchId:"br-other"},"admission-upgrade"),/verified pilot/);
  await local.exec("set neon.endpoint_id='ep-other'");
  await assert.rejects(upgrade(),/identity/);
  await local.exec(`set neon.endpoint_id='${pins.endpointId}'`);
  await local.exec("alter table public.users add column unexpected text");
  await assert.rejects(upgrade(),/schema fingerprint/);
  await local.exec("alter table public.users drop column unexpected");
  const history = (await local.query<{hash:string}>("select hash from drizzle.__drizzle_migrations where id=1")).rows[0];
  await local.exec("update drizzle.__drizzle_migrations set hash='local drift' where id=1");
  await assert.rejects(upgrade(),/migration history/);
  await local.query("update drizzle.__drizzle_migrations set hash=$1 where id=1",[history.hash]);
  await local.exec("alter table tournament_score_events disable trigger tournament_score_events_append_only");
  await assert.rejects(upgrade(),/schema fingerprint/);
  await local.exec("alter table tournament_score_events enable trigger tournament_score_events_append_only");
  await upgrade();
  await verify();
  await local.exec("alter table tournaments disable trigger pilot_engine_guard_v1");
  await assert.rejects(verify(),/schema fingerprint/);
  await local.exec("alter table tournaments enable always trigger pilot_engine_guard_v1");
  await assert.rejects(upgrade(),/schema fingerprint/);
  const require = createRequire(import.meta.url);
  let session: Session|null = null;
  const mock = (id:string, exports:object) => {
    const path = require.resolve(id);
    require.cache[path] = {id:path,filename:path,loaded:true,exports} as NodeJS.Module;
  };
  // The route, authorization, service and SQL are real. Only request-session decoding,
  // database transport and page UI components are replaced in this isolated process.
  mock("next/navigation",require("next/dist/client/components/redirect"));
  mock("../lib/db",{db:()=>db,transactionDb:()=>db});
  mock("../lib/auth/session",{getSession:async()=>session});
  for(const id of ["../components/host/frame","../components/host/judge-dashboard","../components/ui/button"]) mock(id,{});
  const createRoute = require("../app/api/host/tournaments/route");
  const judge = require("../app/api/tournaments/[id]/judge/route");
  const page = require("../app/host/[id]/judge/page").default;
  const create = (engine?:unknown) => createRoute.POST(new Request("http://localhost",{method:"POST",
    body:JSON.stringify({name:"Local rehearsal",category:"Quiz",year:2026,scoringEngineVersion:engine,ownerId:1})}));
  await assert.rejects(pilotHostAdmission(db,pins,"host-verify"),/Complete scoring permissions/);
  await pilotScorePermissions(db,pins,"scoring-apply");
  await local.exec("insert into public.users(name,email,password,role) values ('A','a@local.invalid','x','host'),('B','b@local.invalid','x','host'),('J','j@local.invalid','x','judge')");
  await runtime();
  await assert.rejects(pilotHostAdmission(db,pins,"host-close"),/identity mismatch/);
  assert.equal((await create("room_v1")).status,401);
  session={name:"J",role:"judge",userId:3};
  assert.equal((await create("room_v1")).status,403);
  session={name:"A",role:"host",userId:1};
  const legacyResult = await create();
  assert.equal(legacyResult.status,200);
  const legacyId = (await legacyResult.json()).tournament.id;
  assert.equal((await create("legacy")).status,200);
  assert.equal((await create("unknown")).status,409);
  delete process.env.QUIZOTAB_PILOT_PINS;
  assert.equal((await create("room_v1")).status,409);
  process.env.QUIZOTAB_PILOT_PINS=JSON.stringify(pins);
  assert.equal((await create("room_v1")).status,403);
  const directInsert = "insert into public.tournaments(owner_id,name,year,scoring_engine_version) values (1,'Direct local',2026,'room_v1')";
  await assert.rejects(local.exec(directInsert),/admission denied/i);
  for(const statement of ["update pilot_admission.policy set enabled=true","select * from pilot_admission.hosts","insert into pilot_admission.hosts values (1)",
    "select * from drizzle.__drizzle_migrations","update tournaments set scoring_engine_version='room_v1'"]) {
    await assert.rejects(local.exec(statement),/permission denied/);
  }
  await setup();
  const [{stamp}] = (await local.query<{stamp:string}>(
    "select to_char(created_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as stamp from public.users where id=1")).rows;
  const fixture = readHostApproval("1",{purpose:"synthetic-room-admission",hostId:1,email:"a@local.invalid",createdAtUtc:stamp});
  assert.throws(()=>readHostApproval("2",fixture),/explicit ID/);
  assert.throws(()=>readHostApproval("1",{...fixture,email:"a@example.com"}),/fixture record/);
  assert.throws(()=>readHostApproval("1",{...fixture,purpose:"other"}),/fixture record/);
  await assert.rejects(pilotHostAdmission(db,pins,"host-add"),/fixture approval/);
  await local.exec("set neon.branch_id='br-other'");
  await assert.rejects(pilotHostAdmission(db,pins,"host-add",fixture),/identity mismatch/);
  await local.exec(`set neon.branch_id='${pins.branchId}'`);
  await assert.rejects(pilotHostAdmission(db,pins,"host-open",fixture),/allowlisted host/);
  for(const wrong of [{hostId:999},{hostId:3,email:"j@local.invalid"},{email:"other@local.invalid"},{createdAtUtc:"2000-01-01T00:00:00.000000Z"}])
    await assert.rejects(pilotHostAdmission(db,pins,"host-add",{...fixture,...wrong}),/Persisted host/);
  await pilotHostAdmission(db,pins,"host-preflight",fixture);
  const interrupted = new Error("simulated local interruption");
  await assert.rejects(db.transaction(async tx=>{
    await pilotHostAdmission(tx,pins,"host-add",fixture);
    throw interrupted;
  }),error=>error===interrupted);
  assert.deepEqual(await pilotHostAdmission(db,pins,"host-verify-closed"),{open:false,hostId:null});
  await pilotHostAdmission(db,pins,"host-add",fixture);
  assert.deepEqual(await pilotHostAdmission(db,pins,"host-verify"),{open:false,hostId:1});
  await assert.rejects(pilotHostAdmission(db,pins,"host-add",{...fixture,hostId:2}),/allowlisted host/);
  await runtime();
  await assert.rejects(local.exec(directInsert),/admission denied/i);
  await setup();
  await assert.rejects(pilotHostAdmission(db,pins,"host-open",{...fixture,email:"other@local.invalid"}),/Persisted host/);
  await pilotHostAdmission(db,pins,"host-open",fixture);
  assert.deepEqual(await pilotHostAdmission(db,pins,"host-verify"),{open:true,hostId:1});
  await assert.rejects(pilotHostAdmission(db,pins,"host-verify-closed"),/Expected closed/);
  await runtime();
  session={name:"B",role:"host",userId:2};
  assert.equal((await create("room_v1")).status,403);
  session={name:"stale",role:"host",userId:3};
  assert.equal((await create("room_v1")).status,403);
  session={name:"A",role:"host",userId:1};
  const admitted = await create("room_v1");
  assert.equal(admitted.status,200);
  const roomId=(await admitted.json()).tournament.id;
  const context = (id:string)=>({params:Promise.resolve({id})});
  const get = (id:string)=>judge.GET(new Request("http://localhost"),context(id));
  const post = (id:string,action:string,fields:Record<string,unknown>={})=>judge.POST(new Request("http://localhost",{method:"POST",body:JSON.stringify({action,name:"Local team",category:"Quiz",members:"",...fields})}),context(id));
  assert.equal((await get(legacyId)).status,200);
  const legacyTeam=await post(legacyId,"register");
  assert.equal(legacyTeam.status,200);
  await setup();
  await local.query("insert into tournament_judges(tournament_id,user_id) values ($1,3),($2,3)",[roomId,legacyId]);
  await runtime();
  session={name:"J",role:"judge",userId:3};
  const view = await (await get(legacyId)).json();
  const scored = await post(legacyId,"score",{teamId:view.teams[0].id,roundId:view.config.rounds[0].id,points:1});
  assert.equal(scored.status,200);
  assert.equal((await scored.json()).scores[0].approved,false);
  assert.ok(await page(context(legacyId)));
  for(const response of [await get(roomId),await post(roomId,"register"),await post(roomId,"score")]) {
    assert.equal(response.status,409);
    assert.deepEqual(Object.keys(await response.json()),["error"]);
  }
  await assert.rejects(page(context(roomId)),(e:Error & {digest?:string})=>!!e.digest?.includes(";/staff;"));
  await setup();
  await assert.rejects(local.query("update tournaments set scoring_engine_version='legacy' where id=$1",[roomId]),/immutable/);
  await local.query(`with team as (insert into teams(tournament_id,name) values ($1,'Local team') returning id),
    entry as (insert into tournament_score_entries(tournament_id,room_id,context_id,team_id,round_id,question_key,points,judge_user_id,client_request_id)
    select $1,'room','context',id,'round','q',1,3,gen_random_uuid() from team returning id)
    insert into tournament_score_events(score_entry_id,actor_user_id,event_type) select id,3,'submitted' from entry`,[roomId]);
  const audit = await local.query("select * from tournament_score_events order by id");
  await pilotHostAdmission(db,pins,"host-close");
  assert.deepEqual(await pilotHostAdmission(db,pins,"host-verify-closed"),{open:false,hostId:null});
  await assert.rejects(local.exec("delete from tournament_score_events"),/append-only/);
  await runtime();
  await assert.rejects(local.exec(directInsert),/admission denied/i);
  assert.equal((await local.query("select id from tournaments where scoring_engine_version='room_v1'")).rows.length,1);
  assert.equal(audit.rows.length,1);
  assert.deepEqual((await local.query("select * from tournament_score_events order by id")).rows,audit.rows);
  console.log("ok  pilot upgrade, restricted runtime, closed/open admission, immutability, route and SSR authorization, historical recovery");
} finally {await local.close();}
