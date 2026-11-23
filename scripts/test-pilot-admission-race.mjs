// Optional PostgreSQL integration test. Pass a local PostgreSQL bin directory.
// The test initializes its own disposable, password-protected loopback cluster.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { createServer } from "node:net";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { preparePilotSchema } from "./pilot-migration.ts";
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
  await preparePilotSchema(db,pins,"drizzle",true);
  await admin.query(readFileSync("PILOT_PERMISSION_AUDIT.md","utf8").split("```sql")[1].split("```")[0]);
  await pilotAdmission(db,pins,"admission-preflight");
  await pilotAdmission(db,pins,"admission-upgrade");
  await pilotAdmission(db,pins,"admission-verify");
  await admin.query("insert into users(name,email,password) values ('Local','local@local.invalid','x'); insert into pilot_admission.hosts values (1); update pilot_admission.policy set enabled=true");
  await app.query("set session authorization quizotab_pilot_app; set neon.project_id='noisy-violet-99522280'; set neon.branch_id='br-restless-king-bdli89ow'; set neon.endpoint_id='ep-long-fog-bdc5rxjn'; set statement_timeout='10s'");
  const insert="insert into public.tournaments(owner_id,name,year,scoring_engine_version) values (1,'Local race',2026,'room_v1')";
  const close="update pilot_admission.policy set enabled=false where singleton";
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
  const closing=admin.query(close);
  await blocked(admin,app);
  await app.query("commit");
  await closing;
  await assert.rejects(app.query(insert),{code:"QT403"});
  await admin.query("update pilot_admission.policy set enabled=true");
  await admin.query("begin");
  await admin.query(close);
  const refused=assert.rejects(app.query(insert),{code:"QT403"});
  await blocked(app,admin);
  await admin.query("commit");
  await refused;
  assert.equal((await app.query("select count(*) from tournaments")).rows[0].count,"1");
  await pilotAdmission(db,pins,"admission-verify");
  console.log("ok  creation first and closure first, concurrent backend locks, historical read");
} finally {
  for (const c of clients.reverse()) await c.end();
  if(started) run("pg_ctl",["-D",data,"-m","fast","-w","stop"]);
  rmSync(dir,{recursive:true,force:true});
}
