import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { NeonQueryResultHKT } from "drizzle-orm/neon-serverless";
import type { PgliteQueryResultHKT } from "drizzle-orm/pglite";
import { requirePilotSession, type PilotPins } from "../lib/db/pilot-target";
import { loadApproved, PilotMigrationRefusal } from "./pilot-migration";

type Database = PgDatabase<NeonQueryResultHKT | PgliteQueryResultHKT>;
export type AdmissionMode = "admission-preflight" | "admission-upgrade" | "admission-verify";
const version = "0001_room_admission";
const hash = "d54a4e515c2c6464a7e610252f3f00e2049fa3af6f8ffb0662b3de4f314ffb7f";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const read = (path: string) => readFileSync(path,"utf8").replaceAll("\r\n","\n");
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new PilotMigrationRefusal("Pilot admission refused. Check " + message + ".");
}
const empty = (v: unknown) => Array.isArray(v) && v.length === 0;
const setup = "quizotab_pilot_setup";
const runtime = "quizotab_pilot_app";

async function inspect(db: Database, upgraded: boolean) {
  const rows = async (q: string) => (await db.execute(sql.raw(q))).rows;
  const catalog = await rows(read("scripts/pilot-catalog.sql"));
  // Generated from unmodified canonical files, and again after the reviewed closed upgrade.
  const fingerprint = digest(JSON.stringify(catalog.map(r => r.item)));
  check(fingerprint === (upgraded ? "14699534914ebe61bdd9d0df77c9d0d6282979e2bf1fe2ca94cd4a3cacc16549" : "d04106638e9fda9ef593a75669df26f24279188c153bd3b3aa0f600231d0fdc6"), "schema fingerprint");
  const verifier = read("scripts/verify-pilot-permissions.sql");
  check(digest(verifier) === "ea40e1a5ddaaf7f8dcf184464c8db53e5653560d3ca74fa60b92ed6fbf2ef7bd","permission verifier hash");
  const queries = verifier.replace(/^\s*--.*$/gm,"").split(";").map(s=>s.trim()).filter(Boolean);
  check(queries.length === 15,"permission verifier structure");
  const results = [];
  for (const query of queries) results.push(await rows(query));
  const [,roles, databases, schemas, tables, columns, sequences, functions, defaults,, , history, maintain, builtins, profiles] = results;
  const role = roles[0], database = databases[0];
  check(roles.length === 1 && role.rolname === runtime &&
    ["rolsuper","rolcreaterole","rolcreatedb","rolreplication","rolbypassrls"].every(k=>role[k]===false),"runtime memberships");
  check(database.owner === "quizotab_pilot_owner" && database.connect && !database.create_schema && !database.temp,"database privileges");
  check(schemas.length === (upgraded ? 3 : 2) && schemas.every(n =>
    !n.create_object && (n.nspname === "public" ? n.owner==="pg_database_owner" && n.use_schema :
    (n.nspname==="drizzle" || (upgraded && n.nspname==="pilot_admission")) && n.owner===setup && !n.use_schema)), "schema privileges");
  check(tables.length===19 && tables.every(t=>t.owner===setup && empty(t.grantable) && Array.isArray(t.effective) &&
    t.effective.every(p=>["SELECT","INSERT","UPDATE","DELETE"].includes(p)) && (t.nspname!=="drizzle" || empty(t.effective))), "table or journal privileges");
  check(columns.every(c=>c.nspname==="public" && empty(c.grantable) && Array.isArray(c.effective) && !c.effective.includes("REFERENCES")), "column privileges");
  check(sequences.length===9 && sequences.every(s=>s.owner===setup && empty(s.effective)), "sequence privileges");
  check(functions.length===1 && functions[0].owner===setup && !functions[0].prosecdef &&
    defaults.every(d=>["cloud_admin","neon_superuser"].includes(String(d.creator))), "functions or default ACLs");
  const batch = loadApproved("drizzle");
  check(history.length===batch.length && history.every((r,i)=> Number(r.id)===i+1 && r.hash===batch[i].hash &&
    Number(r.created_at)===batch[i].folderMillis),"canonical migration history");
  const legacy = profiles.find(p=>p.profile==="legacy");
  check(legacy && Number(legacy.missing)===0 && Number(legacy.excess)===0 && !maintain.length && !builtins.length,"legacy privilege matrix");
  const guards = await rows(`select
    has_database_privilege('quizotab_pilot_app',current_database(),'CONNECT WITH GRANT OPTION') or
    has_schema_privilege('quizotab_pilot_app','public','USAGE WITH GRANT OPTION') as grantable, has_parameter_privilege('quizotab_pilot_app','session_replication_role','SET') as bypass,
    exists(select from pg_type join pg_namespace n on n.oid=typnamespace where nspname in ('public','drizzle','pilot_admission')
      and pg_get_userbyid(typowner)<>'quizotab_pilot_setup') as wrong_owner`);
  check(!guards[0].grantable && !guards[0].bypass && !guards[0].wrong_owner,"trigger bypass or object ownership");
  if (!upgraded) {
    const state = await rows(`select has_database_privilege(current_database(),'CREATE') and has_language_privilege('plpgsql','USAGE') as can_install,
      exists(select from public.tournaments where scoring_engine_version <> 'legacy') or
      exists(select from public.tournament_score_entries) or exists(select from public.tournament_score_events) as room_records`);
    check(state[0].can_install && !state[0].room_records,"setup permissions or existing room-scoring records");
    return;
  }
  const unexpected = await rows(`select 1 from pg_namespace n cross join lateral
    aclexplode(coalesce(nspacl,acldefault('n',nspowner))) a where nspname='pilot_admission' and a.grantee<>nspowner
    union all select 1 from pg_class c where relnamespace='pilot_admission'::regnamespace
    and (pg_get_userbyid(relowner)<>'quizotab_pilot_setup' or relacl is not null)
    union all select 1 from pg_proc p where pronamespace='pilot_admission'::regnamespace and
    (pg_get_userbyid(proowner)<>'quizotab_pilot_setup' or exists(select from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee<>proowner))
    union all select 1 from pg_attribute a join pg_class c on c.oid=attrelid
    where relnamespace='pilot_admission'::regnamespace and attacl is not null`);
  check(!unexpected.length,"admission ownership or privileges");
  const policy = await rows("select singleton,enabled from pilot_admission.policy");
  check(policy.length===1 && policy[0].singleton===true && policy[0].enabled===false,"closed policy");
  const records = await rows("select version,sha256 from pilot_admission.upgrades");
  check(records.length===1 && records[0].version===version && records[0].sha256===hash,"upgrade history");
}

export async function pilotAdmission(db: Database, pins: PilotPins, mode: AdmissionMode) {
  const script = readFileSync("pilot-upgrades/" + version + ".sql","utf8");
  check(digest(script)===hash,"upgrade SQL hash");
  await db.transaction(async tx=>{
    await tx.execute(sql`set local search_path = pg_catalog`);
    await requirePilotSession(tx,pins,pins.setupRole);
    if (mode !== "admission-upgrade") {
      await inspect(tx,mode==="admission-verify");
      return;
    }
    await tx.execute(sql`set local lock_timeout = '5s'`);
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(62410923001) as acquired`);
    check(lock.rows[0]?.acquired===true,"pilot procedure lock");
    await tx.execute(sql`lock table public.tournaments in access exclusive mode`);
    await inspect(tx,false);
    for (const statement of script.split("--> statement-breakpoint")) await tx.execute(sql.raw(statement));
    await tx.execute(sql`insert into pilot_admission.upgrades(version,sha256) values (${version},${hash})`);
    check(!(await tx.execute(sql`select 1 from pilot_admission.hosts limit 1`)).rows.length,"empty allowlist");
    await inspect(tx,true);
  }, { isolationLevel: "repeatable read", accessMode: mode==="admission-upgrade" ? "read write" : "read only" });
}
