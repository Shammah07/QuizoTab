import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readPins, requirePilotSession } from "../lib/db/pilot-target";
import { preparePilotSchema } from "./pilot-migration";
import { pilotAdmission } from "./pilot-upgrade";
import { pilotScorePermissions, type ScoringMode } from "./pilot-score-permissions";

const pins = readPins({projectId:"noisy-violet-99522280", branchId:"br-restless-king-bdli89ow", endpointId:"ep-long-fog-bdc5rxjn",
  directHost:"ep-long-fog-bdc5rxjn.c-8.us-east-2.aws.neon.tech", database:"quizotab_pilot", runtimeRole:"quizotab_pilot_app", setupRole:"quizotab_pilot_setup"});
const settings = `set neon.project_id='${pins.projectId}'; set neon.branch_id='${pins.branchId}'; set neon.endpoint_id='${pins.endpointId}'`;
const initial = new PGlite();
await initial.exec("create role quizotab_pilot_owner; create role quizotab_pilot_setup login; create role quizotab_pilot_app login");
await initial.exec("create database quizotab_pilot owner quizotab_pilot_owner");
const image = await initial.dumpDataDir();
await initial.exec(settings + "; set session authorization quizotab_pilot_setup");
await assert.rejects(pilotScorePermissions(drizzle(initial),pins,"scoring-preflight"),/identity mismatch/);
await initial.close();
let local = new PGlite({database:pins.database, loadDataDir:image});
const run = (mode: ScoringMode) => pilotScorePermissions(drizzle(local), pins, mode);
try {
  await local.exec(`revoke temporary on database quizotab_pilot from public;
    grant create on database quizotab_pilot to quizotab_pilot_setup;
    grant usage,create on schema public to quizotab_pilot_setup;
    ${settings}; set session authorization quizotab_pilot_setup`);
  await preparePilotSchema(drizzle(local),pins,"drizzle",true);
  const grants = readFileSync("PILOT_PERMISSION_AUDIT.md","utf8").split("```sql");
  await local.exec(grants[1].split("```")[0]);
  await assert.rejects(run("scoring-preflight"),/schema fingerprint/);
  await pilotAdmission(drizzle(local),pins,"admission-upgrade");

  for(const key of ["project_id","branch_id","endpoint_id"]) {
    await local.exec("set neon."+key+"='wrong'");
    await assert.rejects(run("scoring-apply"),/identity mismatch/);
    await local.exec(settings);
  }
  await local.exec("set session authorization quizotab_pilot_app");
  await requirePilotSession(drizzle(local),pins,pins.runtimeRole);
  await assert.rejects(run("scoring-apply"),/identity mismatch/);
  await local.exec("set session authorization quizotab_pilot_setup");

  // Roll back each independent drift fixture, even the synthetic audit history.
  const db = drizzle(local);
  async function rejectsFixture(statements:string[], expected:RegExp, verifyAlso=false) {
    const discard = new Error("discard local fixture");
    await assert.rejects(db.transaction(async tx=>{
      for(const statement of statements) await tx.execute(sql.raw(statement));
      await assert.rejects(pilotScorePermissions(tx,pins,"scoring-preflight"),expected);
      if (verifyAlso)
        await assert.rejects(pilotScorePermissions(tx,pins,"scoring-verify"),expected);
      throw discard;
    }), e=>e===discard);
  }
  await rejectsFixture(["update pilot_admission.upgrades set sha256='wrong'"],/upgrade history/);
  await rejectsFixture(["create table public.extra(id int)"],/schema fingerprint/);
  await rejectsFixture(["update pilot_admission.policy set enabled=true"],/closed policy/);
  const host = "insert into public.users(id,name,email,password) values (999,'Local','fixture@local.invalid','x')";
  await rejectsFixture([host,"insert into pilot_admission.hosts values (999)"],/empty allowlist/);
  await rejectsFixture([host,
    "with t as (insert into public.tournaments(owner_id,name,year) values (999,'Local',2026) returning id), "+
    "team as (insert into public.teams(tournament_id,name) select id,'Local' from t returning id,tournament_id), "+
    "entry as (insert into public.tournament_score_entries(tournament_id,room_id,context_id,team_id,round_id,question_key,points,judge_user_id,client_request_id) "+
    "select tournament_id,'r','c',id,'round','q',1,999,gen_random_uuid() from team returning id) "+
    "insert into public.tournament_score_events(score_entry_id,actor_user_id,event_type) select id,999,'submitted' from entry"
  ],/room-scoring records/);
  for(const statement of ["grant insert on public.tournament_score_events to quizotab_pilot_app",
    "grant update(details) on public.tournament_score_events to public"]) {
    await rejectsFixture([statement],/partial or excessive/,true);
  }
  await rejectsFixture(["grant select on public.tournament_score_events to public"],/PUBLIC scoring privileges/);
  await rejectsFixture(["grant usage on schema pilot_admission to public"],/schema privileges/);
  await rejectsFixture(["grant select on drizzle.__drizzle_migrations to public"],/journal privileges/);

  // Interrupt verification only after both reviewed GRANTs actually executed.
  const executed:string[]=[];
  const normalize = (q:string)=>q.trim().replace(/\s+/g," ").replace(/;$/,"").toLowerCase();
  const fault = drizzle(local,{logger:{logQuery(q) {
    const statement=normalize(q);
    if(statement.startsWith("grant ")) executed.push(statement);
    else if(executed.length===2 && statement.includes("with ns as")) throw new Error("local postcheck fault");
  }}});
  await assert.rejects(pilotScorePermissions(fault,pins,"scoring-apply"),e=>e instanceof Error &&
    (e.message.includes("local postcheck fault") || (e.cause instanceof Error && e.cause.message.includes("local postcheck fault"))));
  assert.deepEqual(executed,grants[2].split("```")[0].split(";").map(normalize).filter(Boolean));
  assert.equal((await run("scoring-verify")).profile,"legacy");
  assert.equal((await run("scoring-preflight")).profile,"legacy");
  await run("scoring-apply"); // Simulate losing the successful reply.
  const committed=await local.dumpDataDir();
  await local.close();
  local=new PGlite({database:pins.database,loadDataDir:committed});
  await local.exec(settings+"; set session authorization quizotab_pilot_setup");
  assert.equal((await run("scoring-verify")).profile,"full");
  await assert.rejects(run("scoring-apply"),/Expected legacy-only/);
  await local.exec("set session authorization quizotab_pilot_app");
  await local.exec("update public.tournament_score_entries set status=status, reviewer_user_id=null, reviewed_at=null, reason=null where false");
  await local.exec("insert into public.tournament_score_entries select * from public.tournament_score_entries where false");
  await local.exec("insert into public.tournament_score_events select * from public.tournament_score_events where false");
  for(const q of ["update tournament_score_entries set points=0","update tournament_score_events set details='{}'", "delete from tournament_score_events","truncate tournament_score_events",
    "update pilot_admission.policy set enabled=true","insert into pilot_admission.hosts values (999)","delete from pilot_admission.upgrades",
    "create table pilot_admission.extra(id int)","select * from drizzle.__drizzle_migrations",
    "update tournaments set scoring_engine_version='room_v1'","alter table tournaments disable trigger pilot_engine_guard_v1",
    "alter table tournament_score_events disable trigger tournament_score_events_append_only"]) {
    await assert.rejects(local.exec(q),/permission denied|must be owner/);
  }
  console.log("ok  scoring permission identity, predecessor, partial/excess, both reviewed grants, rollback, fresh-session recovery and restricted runtime");
} finally {await local.close();}
