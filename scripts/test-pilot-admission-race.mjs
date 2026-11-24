// Optional PostgreSQL integration test. Pass a local PostgreSQL bin directory.
// The test initializes its own disposable, password-protected loopback cluster.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { createServer } from "node:net";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { preparePilotSchema } from "./pilot-migration.ts";
import { pilotHostAdmission, readHostApproval } from "./pilot-host-admission.ts";
import { pilotScorePermissions } from "./pilot-score-permissions.ts";
import { pilotAdmission } from "./pilot-upgrade.ts";

const pins={projectId:"noisy-violet-99522280",branchId:"br-restless-king-bdli89ow",endpointId:"ep-long-fog-bdc5rxjn",
  directHost:"ep-long-fog-bdc5rxjn.c-8.us-east-2.aws.neon.tech",database:"quizotab_pilot",setupRole:"quizotab_pilot_setup",runtimeRole:"quizotab_pilot_app"};

const bin = resolve(process.argv[2]);
const dir = mkdtempSync(join(tmpdir(),"quizotab-admission-"));
const data = join(dir,"data"), pwfile = join(dir,"pw");
const password = randomBytes(32).toString("hex");
const binary = name => join(bin,name+(process.platform==="win32"?".exe":""));
function run(name,args) {
  const r=spawnSync(binary(name),args,{windowsHide:true,encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:60000});
  if(r.status!==0) throw new Error(r.stderr || r.error?.message || name+" failed");
}
const portProbe=createServer();
await new Promise(resolve=>portProbe.listen(0,"127.0.0.1",resolve));
const port=portProbe.address().port;
await new Promise(resolve=>portProbe.close(resolve));
const clients=[];
async function connect(database) {
  const c=new pg.Client({host:"127.0.0.1",port,user:"postgres",password,database,connectionTimeoutMillis:5000});
  await c.connect(); clients.push(c); return c;
}
let started=false;
try {
  writeFileSync(pwfile,password,{mode:0o600});
  run("initdb",["-D",data,"-U","postgres","-A","scram-sha-256","--pwfile="+pwfile,"--locale=C","--encoding=UTF8"]);
  run("pg_ctl",["-D",data,"-l",join(dir,"server.log"),"-o","-h 127.0.0.1 -p "+port,"-w","start"]);
  started=true;
  const bootstrap=await connect("postgres");
  await bootstrap.query("create role quizotab_pilot_owner; create role quizotab_pilot_setup login; create role quizotab_pilot_app login");
  await bootstrap.query("create database quizotab_pilot owner quizotab_pilot_owner");
  const admin=await connect("quizotab_pilot"),app=await connect("quizotab_pilot");
  await admin.query(`revoke temporary on database quizotab_pilot from public;
    grant create on database quizotab_pilot to quizotab_pilot_setup;
    grant usage,create on schema public to quizotab_pilot_setup;
    set session authorization quizotab_pilot_setup; set neon.project_id='${pins.projectId}';
    set neon.branch_id='${pins.branchId}'; set neon.endpoint_id='${pins.endpointId}'`);
  const db=drizzle(admin);
  if(process.argv.includes("--staging")) {
    const {testStagingProvision}=await import("./test-staging-provision.mjs");
    await testStagingProvision({admin,app,connect,dir});
  } else {
  await preparePilotSchema(db,pins,"drizzle",true);
  await admin.query(readFileSync("PILOT_PERMISSION_AUDIT.md","utf8").split("```sql")[1].split("```")[0]);
  await pilotAdmission(db,pins,"admission-preflight");
  await pilotAdmission(db,pins,"admission-upgrade");
  await pilotAdmission(db,pins,"admission-verify");
  await pilotScorePermissions(db,pins,"scoring-apply");
  await admin.query("insert into users(name,email,password,created_at) values ('Local','local@local.invalid','x','2026-01-01T00:00:00Z')");
  const fixture=readHostApproval("1",{purpose:"synthetic-room-admission",hostId:1,email:"local@local.invalid",createdAtUtc:"2026-01-01T00:00:00.000000Z"});
  async function authorize() {
    await pilotHostAdmission(db,pins,"host-add",fixture);
    await pilotHostAdmission(db,pins,"host-open",fixture);
  }
  await authorize();
  await app.query("set session authorization quizotab_pilot_app; set neon.project_id='noisy-violet-99522280'; set neon.branch_id='br-restless-king-bdli89ow'; set neon.endpoint_id='ep-long-fog-bdc5rxjn'; set statement_timeout='10s'");
  // A separate setup session can resolve a lost reply without replaying a write.
  const observer=await connect("quizotab_pilot");
  await observer.query(`set session authorization quizotab_pilot_setup; set neon.project_id='${pins.projectId}';
    set neon.branch_id='${pins.branchId}'; set neon.endpoint_id='${pins.endpointId}'`);
  const independent=drizzle(observer);
  assert.deepEqual(await pilotHostAdmission(independent,pins,"host-verify"),{open:true,hostId:1});
  const insert="insert into public.tournaments(owner_id,name,year,scoring_engine_version) values (1,'Local race',2026,'room_v1')";
  // Wait for PostgreSQL itself to identify who blocks the competing backend.
  async function blocked(waiter,holder) {
    for(let i=0;i<100;i++){
      if((await bootstrap.query("select $1::int=any(pg_blocking_pids($2)) as waiting",[holder.processID,waiter.processID])).rows[0].waiting)return;
      await new Promise(r=>setTimeout(r,25));
    }
    assert.fail("Expected a competing backend waiting on a lock");
  }
  await app.query("begin");
  await app.query(insert);
  const closing=pilotHostAdmission(db,pins,"host-close");
  await blocked(admin,app);
  await app.query("commit");
  await closing;
  await assert.rejects(app.query(insert),{code:"QT403"});
  await authorize();
  let refused;
  await db.transaction(async tx=>{
    await pilotHostAdmission(tx,pins,"host-close");
    refused=assert.rejects(app.query(insert),{code:"QT403"});
    await blocked(app,admin);
  });
  await refused;
  assert.equal((await app.query("select count(*) from tournaments")).rows[0].count,"1");
  assert.deepEqual(await pilotHostAdmission(independent,pins,"host-verify-closed"),{open:false,hostId:null});
  console.log("ok  creation first and closure first, concurrent backend locks, historical read");
  if (process.argv.includes("--scoring")) {
    const second = await connect("quizotab_pilot");
    await second.query("set session authorization quizotab_pilot_app; set statement_timeout='10s'");
    const { checkNativeScoring } = await import("./native-scoring-checks.mjs");
    await checkNativeScoring({admin, app, second, observer, port, password});
    if(process.argv.includes("--load")) {
      const {nativeEventSmoke}=await import("./native-event-smoke.mjs");
      await nativeEventSmoke({admin,bootstrap,port});
    }
    const {restoreEvidence} = await import("./restore-evidence.mjs");
    const expected = {database:"quizotab_pilot",login:pins.setupRole,role:pins.setupRole,
      project:pins.projectId,branch:pins.branchId,endpoint:pins.endpointId};
    const snapshot = await restoreEvidence(independent,expected);
    // Postgres requires an idle template. All sessions here belong to this new cluster.
    for (const client of clients.splice(1)) await client.end();
    const start = performance.now();
    await bootstrap.query("create database qt_recovery template quizotab_pilot owner quizotab_pilot_owner");
    const recovered = await connect("qt_recovery");
    // CREATE DATABASE does not clone the database ACL. Reproduce its independent
    // provisioning on this disposable target before validating effective privileges.
    await recovered.query("revoke temporary on database qt_recovery from public; grant create on database qt_recovery to quizotab_pilot_setup");
    await recovered.query("set session authorization quizotab_pilot_setup; set neon.project_id='local-recovery'; set neon.branch_id='br-local-recovery'; set neon.endpoint_id='ep-local-recovery'");
    assert.deepEqual(await restoreEvidence(drizzle(recovered),{...expected,database:"qt_recovery",
      project:"local-recovery",branch:"br-local-recovery",endpoint:"ep-local-recovery"}),snapshot);
    console.log("ok  separate local restore target, catalog, migration journal, privileges, row hashes and awards",{
      entries:snapshot.tournament_score_entries.count, events:snapshot.tournament_score_events.count, recoveryMs:Math.round(performance.now()-start)});
    if(process.argv.includes("--stage-sessions")) {
      await recovered.query("set search_path=pg_catalog");
      const catalog=readFileSync("scripts/pilot-catalog.sql","utf8");
      const readCatalog=async()=>(await recovered.query(catalog)).rows.map(row=>row.item);
      const digest=items=>createHash("sha256").update(JSON.stringify(items)).digest("hex");
      const before=await readCatalog();
      assert.equal(digest(before),"14699534914ebe61bdd9d0df77c9d0d6282979e2bf1fe2ca94cd4a3cacc16549");
      for(const purpose of ["verify","reset"]) await recovered.query(
        "insert into public.auth_tokens(user_id,purpose,token_hash,expires_at) values(1,$1,$2,now()+interval '1 hour')",
        [purpose,randomBytes(32).toString("hex")]);
      const legacyTokens=async()=>(await recovered.query("select * from public.auth_tokens order by id")).rows;
      const priorTokens=await legacyTokens();
      await recovered.query(readFileSync("staging-upgrades/0001_session_tokens.sql","utf8"));
      assert.deepEqual(await legacyTokens(),priorTokens);
      const after=await readCatalog();
      const added=after.filter(item=>!before.includes(item));
      assert.deepEqual(added.map(item=>JSON.parse(item)),[["enum","public","token_purpose","session",3]]);
      assert.deepEqual(after.filter(item=>!added.includes(item)),before);
      const runtime=await connect("qt_recovery");
      await runtime.query("set session authorization quizotab_pilot_app");
      const token=randomBytes(32).toString("hex");
      await runtime.query("insert into auth_tokens(user_id,token_hash,purpose,expires_at) values(1,$1,'session',now()+interval '8 hours')",[token]);
      assert.equal((await runtime.query("select token_hash,created_at,expires_at from auth_tokens where user_id=1 and purpose='session' and used_at is null order by created_at")).rowCount,1);
      assert.equal((await runtime.query("update auth_tokens set used_at=now() where token_hash=$1 returning used_at",[token])).rowCount,1);
      await assert.rejects(runtime.query("select * from drizzle.__drizzle_migrations"),{code:"42501"});
      console.log("ok  staging-only catalog delta and restricted session privileges",digest(after));
    }
  }
  }
} finally {
  for (const c of clients.reverse()) await c.end();
  if(started) run("pg_ctl",["-D",data,"-m","fast","-w","stop"]);
  rmSync(dir,{recursive:true,force:true});
}
