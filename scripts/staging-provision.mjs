// Offline operator entry point. CLI input cannot set the trusted digest list.
import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {readFileSync,writeFileSync,realpathSync} from "node:fs";
import {dirname,isAbsolute,relative,sep} from "node:path";
import {pathToFileURL} from "node:url";
import pg from "pg";
import {parse} from "dotenv";
import {drizzle} from "drizzle-orm/node-postgres";
import {sql} from "drizzle-orm";
import {stagingApproval} from "../lib/db/staging-approval.ts";
import {pilotUrl,probeIdentity,rejectInherited} from "../lib/db/pilot-target.ts";
import {preparePilotSchema,loadApproved} from "./pilot-migration.ts";
import {hashPassword} from "../lib/auth/password.ts";
import {defaultConfig} from "../lib/tournament/rules.ts";
import {readState,writeState} from "../lib/tournament/store.ts";
import {saveScoringPlan} from "../lib/tournament/scoring-plan.ts";

const read=file=>readFileSync(file,"utf8").replaceAll("\r\n","\n");
const hash=text=>createHash("sha256").update(text).digest("hex");
const sessionHash="f54dce15e3ea88125932da3100f2d1da78b1605545646c76dd8cd1cd5c20a70f";
const guardHash="a6f0b68adea7fc9be73619c7814b9c6bbbb6b407ba4bb6b8cdcf8e1709b48114";
const labels=["owner","east-judge","west-judge","east-host","west-host"];
const query=async(tx,q)=>(await tx.execute(q)).rows;
const actorEmail=(id,label)=>label+"."+id+"@stage.invalid";

async function identity(tx,pins) {
  assert.deepEqual(await probeIdentity(tx),{project_id:pins.projectId,branch_id:pins.branchId,endpoint_id:pins.endpointId,
    database:pins.database,login_role:pins.setupRole,effective_role:pins.setupRole});
}

async function verifyInstallation(tx) {
  const [log]=await query(tx,sql`select session_hash,guard_hash from staging_control.installation where singleton`);
  assert.deepEqual(log,{session_hash:sessionHash,guard_hash:guardHash});
  const journal=await query(tx,sql`select id,hash,created_at from drizzle.__drizzle_migrations order by id`);
  assert.deepEqual(journal.map(r=>[r.id,r.hash,Number(r.created_at)]),loadApproved("drizzle").map((m,i)=>[i+1,m.hash,m.folderMillis]));
  const catalog=read("scripts/pilot-catalog.sql").replaceAll("'pilot_admission'","'staging_control'");
  await tx.execute(sql`set local search_path=pg_catalog`);
  const digest=hash(JSON.stringify((await query(tx,sql.raw(catalog))).map(r=>r.item)));
  assert.equal(digest,stagingCatalog,"Unexpected staging catalog: "+digest);
  await tx.execute(sql`set local search_path=pg_catalog,public`);
  const verifier=read("scripts/verify-pilot-permissions.sql");
  assert.equal(hash(verifier),"ea40e1a5ddaaf7f8dcf184464c8db53e5653560d3ca74fa60b92ed6fbf2ef7bd");
  const statements=verifier.replace(/^\s*--.*$/gm,"").split(";").map(v=>v.trim()).filter(Boolean);
  const results=[];
  for(const statement of statements) results.push(await query(tx,sql.raw(statement)));
  const [,roles,[database],schemas,tables,columns,sequences,functions,defaults,,,,maintain,builtins,profiles]=results;
  assert.ok(roles.length===1 && !["rolsuper","rolcreaterole","rolcreatedb","rolreplication","rolbypassrls"].some(k=>roles[0][k]));
  assert.ok(database.owner==="quizotab_pilot_owner" && database.connect && !database.temp && !database.create_schema);
  assert.ok(schemas.length===3 && schemas.every(n=>!n.create_object && n.use_schema===(n.nspname==="public") &&
    n.owner===(n.nspname==="public"?"pg_database_owner":"quizotab_pilot_setup")));
  assert.ok(tables.every(t=>t.owner==="quizotab_pilot_setup" && !t.grantable.length && t.effective.every(p=>["SELECT","UPDATE","INSERT","DELETE"].includes(p)) &&
    (t.nspname!=="drizzle" || !t.effective.length)) && columns.every(c=>!c.grantable.length) && sequences.every(s=>!s.effective.length));
  assert.ok(!maintain.length && !builtins.length && profiles.some(p=>p.profile==="full" && Number(p.missing)===0 && Number(p.excess)===0));
  assert.ok(functions.length===1 && !functions[0].prosecdef && functions[0].owner==="quizotab_pilot_setup" &&
    defaults.every(d=>["cloud_admin","neon_superuser"].includes(d.creator)));
  const [rights]=await query(tx,sql`select has_parameter_privilege('quizotab_pilot_app','session_replication_role','SET') as bypass,
    exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='staging_control' and
      (pg_get_userbyid(c.relowner)<>'quizotab_pilot_setup' or (c.relkind='r' and
      has_table_privilege('quizotab_pilot_app',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))) as private_access,
    exists(select from pg_roles r where pg_has_role(session_user,r.oid,'MEMBER') and
      (r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolbypassrls or r.rolreplication)) as administrative_setup,
    exists(select from staging_control.fixtures where not consumed) as pending`);
  assert.deepEqual(rights,{bypass:false,private_access:false,administrative_setup:false,pending:false});
}
// Produced on a fresh disposable PG18 database from the four pinned SQL files.
const stagingCatalog="5dc380043f4958445a0e91a030ac51d17bddef688b810d851df91e4c2a8e0367";

async function fixtures(tx,plan,passwords) {
  const {tournament:id,pins}=plan;
  const users=[];
  for(const [i,label] of labels.entries()) {
    const role=i===1 || i===2?"judge":"host";
    const [user]=await query(tx,sql`insert into users(name,email,password,role,email_verified_at) values
      (${"Staging "+label},${actorEmail(id,label)},${await hashPassword(passwords[i])},${role},now()) returning id`);
    users.push(user.id);
  }
  await tx.execute(sql`insert into staging_control.fixtures(id,approval,owner_id,project,branch,endpoint)
    values(${id},${plan.digest},${users[0]},${pins.projectId},${pins.branchId},${pins.endpointId})`);
  await tx.execute(sql`insert into tournaments(id,owner_id,name,category,year,status,scoring_engine_version)
    values(${id},${users[0]},'Staging championship','Synthetic',2026,'active','room_v1')`);
  const config=defaultConfig("championship","Staging championship");
  const round=config.rounds[0];
  const questions=Array.from({length:plan.spectators===30?15:10},(_,i)=>({id:"q-"+(i+1),minPoints:0,maxPoints:3}));
  round.maxPoints=questions.length*3;
  config.rounds=[round];
  const rooms=[],pairings=[];
  for(const [i,name] of ["East","West"].entries()) {
    const roomId=randomUUID();
    rooms.push({id:roomId,name,panelistIds:[],judgeId:""});
    const teams=[];
    for(const suffix of ["A","B"]) {
      const [team]=await query(tx,sql`insert into teams(tournament_id,name) values(${id},${"Staging "+name+" "+suffix}) returning id`);
      teams.push(team.id);
    }
    pairings.push({id:randomUUID(),stage:round.stage,matchLabel:round.match,roomId,teamAId:teams[0],teamBId:teams[1],released:true});
    await tx.execute(sql`insert into tournament_room_staff(tournament_id,room_id,user_id,role)
      values(${id},${roomId},${users[1+i]},'judge'),(${id},${roomId},${users[3+i]},'room_host')`);
  }
  for(const [key,value] of Object.entries({rooms,config,pairings,judges:[],sharing:{listed:false,showStandings:true,showDraw:true,about:"Synthetic"}}))
    await writeState(tx,id,key,value);
  await saveScoringPlan(tx,id,{rounds:[{id:round.id,questions}],rosters:[]});
}

async function verifyFixture(tx,plan) {
  const id=plan.tournament;
  const [fixture]=await query(tx,sql`select f.approval,f.consumed,t.owner_id,t.status,t.scoring_engine_version,u.email,u.role
    from staging_control.fixtures f join tournaments t on t.id=f.id and t.owner_id=f.owner_id join users u on u.id=t.owner_id
    where f.id=${id} and (f.project,f.branch,f.endpoint)=(${plan.pins.projectId},${plan.pins.branchId},${plan.pins.endpointId})`);
  assert.ok(fixture?.approval===plan.digest && fixture.consumed && fixture.role==="host" && fixture.email===actorEmail(id,"owner") &&
    fixture.status==="active" && fixture.scoring_engine_version==="room_v1");
  const staff=await query(tx,sql`select s.room_id,s.role,u.id,u.email,u.role as account_role from tournament_room_staff s join users u on u.id=s.user_id
    where tournament_id=${id} and revoked_at is null order by u.email`);
  assert.equal(staff.length,4);
  assert.equal(new Set(staff.map(s=>s.room_id)).size,2);
  for(const label of labels.slice(1)) {
    const row=staff.find(s=>s.email===actorEmail(id,label));
    assert.ok(row && row.account_role===(label.endsWith("judge")?"judge":"host") && row.role===(row.account_role==="host"?"room_host":"judge"));
  }
  const teams=await query(tx,sql`select id,name from teams where tournament_id=${id} order by name`);
  assert.deepEqual(teams.map(t=>t.name),["Staging East A","Staging East B","Staging West A","Staging West B"]);
  const state=await readState(tx,id);
  assert.ok(state.config.rounds.length===1 && state.rooms.length===2 && state.pairings.length===2);
  const round=state.config.rounds[0];
  const [scoring]=await query(tx,sql`select value from tournament_state where tournament_id=${id} and key='scoringPlan'`);
  const questions=Array.from({length:plan.spectators===30?15:10},(_,i)=>({id:"q-"+(i+1),minPoints:0,maxPoints:3}));
  assert.deepEqual(scoring.value.rounds,[{id:round.id,questions}]);
  const rooms=["East","West"].map(name=>{
    const room=state.rooms.find(r=>r.name===name);
    assert.ok(room);
    const pair=state.pairings.find(p=>p.roomId===room.id);
    const roster=teams.filter(t=>t.name.startsWith("Staging "+name+" "));
    assert.ok(pair?.released && pair.stage===round.stage && pair.matchLabel===round.match);
    assert.deepEqual([pair.teamAId,pair.teamBId],roster.map(t=>t.id));
    const actor=role=>staff.find(s=>s.room_id===room.id && s.email===actorEmail(id,name.toLowerCase()+"-"+role))?.id;
    assert.ok(actor("judge") && actor("host"));
    return {id:room.id,context:pair.id,round:round.id,teams:roster,judge:actor("judge"),host:actor("host"),questions:questions.map(q=>q.id)};
  });
  return {tournament:id,owner:fixture.owner_id,teams:teams.length,staff:staff.length,rooms,admission:"closed"};
}

export async function verifyStagingRecovery(tx,sourcePlan) {
  await verifyInstallation(tx);
  await verifyFixture(tx,sourcePlan);
}

export async function provision(connection,raw,mode,{trusted,passwords}={}) {
  const plan=stagingApproval(raw,trusted);
  assert.ok(["install","fixture","verify","verify-install"].includes(mode));
  const write=["install","fixture"].includes(mode);
  return drizzle(connection).transaction(async tx=>{
    await identity(tx,plan.pins);
    await tx.execute(sql`set local search_path=pg_catalog,public`);
    if(write) await tx.execute(sql`select pg_advisory_xact_lock(62410923002)`);
    if(mode==="install" && !(await query(tx,sql`select to_regnamespace('staging_control') as ns`))[0].ns) {
      const session=read("staging-upgrades/0001_session_tokens.sql"),guard=read("staging-upgrades/0002_fixture_guard.sql");
      assert.equal(hash(session),sessionHash);assert.equal(hash(guard),guardHash);
      await preparePilotSchema(tx,plan.pins,"drizzle",true);
      await tx.execute(sql`set local search_path=public`);
      const blocks=read("PILOT_PERMISSION_AUDIT.md").split("```sql").slice(1).map(b=>b.split("```")[0].trim());
      assert.deepEqual(blocks.map(hash),["2458287afd21e765754d0750b7bcabc55d1bb693988cf76fe953ac94a531b73d","4fc11958ded73856a314233952580d5acdcc6cb17518dfa503fc54c630d0236b"]);
      for(const block of [...blocks,session,guard]) await tx.execute(sql.raw(block));
      await tx.execute(sql`insert into staging_control.installation values(true,${sessionHash},${guardHash})`);
    }
    await verifyInstallation(tx);
    if(mode==="fixture") {
      assert.ok(passwords?.length===5 && passwords.every(v=>typeof v==="string" && v.length>=32) && new Set(passwords).size===5);
      await fixtures(tx,plan,passwords);
      await verifyInstallation(tx);
    }
    if(mode==="verify" || mode==="fixture") return verifyFixture(tx,plan);
    return {installed:true,admission:"closed"};
  },{accessMode:write?"read write":"read only",isolationLevel:"repeatable read"});
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    rejectInherited(process.env);
    const [mode,artifact,setupFile,output,...extra]=process.argv.slice(2);
    assert.ok(["install","verify-install","fixture","verify"].includes(mode) && !extra.length && Boolean(output)===(mode==="fixture"));
    for(const path of [artifact,setupFile,...(output?[output]:[])]) {
      assert.ok(isAbsolute(path));
      const location=realpathSync(path===output?dirname(path):path);
      const offset=relative(realpathSync("."),location);
      assert.ok(isAbsolute(offset) || offset===".." || offset.startsWith(".."+sep));
    }
    const raw=JSON.parse(read(artifact)),plan=stagingApproval(raw);
    const env=parse(read(setupFile));
    assert.deepEqual(Object.keys(env),["DATABASE_URL_UNPOOLED"]);
    const url=new URL(pilotUrl(env.DATABASE_URL_UNPOOLED,plan.pins,true));
    const client=new pg.Client({host:url.hostname,database:plan.pins.database,user:plan.pins.setupRole,password:decodeURIComponent(url.password),
      ssl:{rejectUnauthorized:true},enableChannelBinding:true,connectionTimeoutMillis:10000,statement_timeout:30000});
    try {
      await client.connect();
      let passwords;
      if(output) {
        passwords=labels.map(()=>randomBytes(32).toString("hex"));
        writeFileSync(output,JSON.stringify(labels.map((label,i)=>({email:actorEmail(plan.tournament,label),password:passwords[i]}))),{flag:"wx",mode:0o600});
      }
      console.log(JSON.stringify(await provision(client,raw,mode,{passwords})));
    } finally {await client.end();}
  } catch {console.error("Staging procedure refused. Reconcile using read-only verification.");process.exitCode=1;}
}
