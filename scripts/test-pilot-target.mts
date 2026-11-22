import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pilotUrl, probeIdentity, readPins, rejectInherited, verifyPilot } from "../lib/db/pilot-target";

const fixture = {
  projectId: "pilot-project-123", branchId: "br-test-123", endpointId: "ep-fixture",
  directHost: "ep-fixture.test.neon.tech", database: "quizotab_pilot",
  runtimeRole: "quizotab_pilot_app", setupRole: "quizotab_pilot_setup",
};
const pins = readPins(fixture);
assert.deepEqual(pins, fixture);
for (const key of Object.keys(fixture)) {
  const incomplete: Record<string, string> = {...fixture};
  delete incomplete[key];
  assert.throws(() => readPins(incomplete), /Invalid independent/);
}
const obsolete = {branch:"quizo-room-pilot-test", database:pins.database, directHost:pins.directHost,
  runtimeRole:pins.runtimeRole, setupRole:pins.setupRole};
for (const invalid of [obsolete, {...pins, branch:"production"}, {...pins, projectId:"Bad Project!"},
  {...pins, branchId:"production"}, {...pins, endpointId:"fixture"}, {...pins, database:"neondb"},
  {...pins, directHost:"ep-other.test.neon.tech"}, {...pins, directHost:"ep-fixture.example.test"},
  {...pins, endpointId:"ep-fixture-pooler", directHost:"ep-fixture-pooler.test.neon.tech"},
  {...pins, runtimeRole:""}, {...pins, setupRole:pins.runtimeRole},
  {...pins, runtimeRole:"quizotab_pilot_owner"}, {...pins, setupRole:"quizotab_pilot_owner"}]) {
  assert.throws(() => readPins(invalid), /Invalid independent/);
}

function url(direct = false) {
  const host = direct ? pins.directHost : pins.directHost.replace(".", "-pooler.");
  const address = new URL("postgresql://" + host + "/" + pins.database + "?sslmode=require");
  address.username = direct ? pins.setupRole : pins.runtimeRole;
  address.password = "fixture-only";
  return address.href;
}
assert.equal(pilotUrl(url(), pins), url());
assert.equal(pilotUrl(url(true), pins, true), url(true));
for (const wrong of [url(true), url().replace(pins.runtimeRole, "different"), url().replace("/quizotab_pilot?", "/other?"),
  url().replace("ep-fixture", "ep-other"), url()+"&host=other", url()+"&sslmode=disable",
  url().replace("=require","=disable"), url()+"&channel_binding=disable"]) assert.throws(() => pilotUrl(wrong, pins));
assert.throws(() => pilotUrl(url(true).replace(pins.setupRole, pins.runtimeRole), pins, true));
for (const key of ["DATABASE_URL","DATABASE_URL_UNPOOLED","DIRECT_URL","DB_HOST","PRISMA_DATABASE_URL","PGOPTIONS","PGUSER","PGSERVICE","NEON_DATABASE_URL","NODE_TLS_REJECT_UNAUTHORIZED"])
  assert.throws(() => rejectInherited({[key]:"unexpected"}));

// Exercise the actual identity SELECT against an in-memory PostgreSQL engine, including absent GUCs.
const local = new PGlite();
try {
  const db = drizzle(local);
  const row = await probeIdentity(db);
  assert.deepEqual([row.project_id, row.branch_id, row.endpoint_id], [null, null, null]);
  await local.query("select set_config('neon.project_id',$1,false), set_config('neon.branch_id',$2,false), set_config('neon.endpoint_id',$3,false)",
    [pins.projectId, pins.branchId, pins.endpointId]);
  const expected = await local.query<Record<string, string>>("select current_database() as database, session_user as login_role, current_user as effective_role");
  assert.deepEqual(await probeIdentity(db), {...expected.rows[0], project_id:pins.projectId, branch_id:pins.branchId, endpoint_id:pins.endpointId});
} finally { await local.close(); }

function identity(role: string) {
  return {project_id:pins.projectId, branch_id:pins.branchId, endpoint_id:pins.endpointId,
    database:pins.database, login_role:role, effective_role:role};
}
const runtime = identity(pins.runtimeRole);
const setup = identity(pins.setupRole);
const valid = async () => runtime;
await verifyPilot(pins, valid, valid);
await verifyPilot(pins, valid, valid, async () => setup);
for (const adapter of ["http","transaction","direct"]) {
  const expected = adapter === "direct" ? setup : runtime;
  const wrongRole = adapter === "direct" ? pins.runtimeRole : pins.setupRole;
  const invalid = [
    {...expected, project_id:"website-project-456"}, {...expected, branch_id:"br-other"},
    {...expected, endpoint_id:"ep-other"}, {...expected, database:"other"},
    {...expected, login_role:wrongRole}, {...expected, effective_role:wrongRole},
    ...Object.keys(expected).map(key => ({...expected, [key]:null})), undefined,
  ];
  for (const row of invalid) {
    const bad = async () => row;
    await assert.rejects(verifyPilot(pins, adapter === "http" ? bad : valid,
      adapter === "transaction" ? bad : valid, adapter === "direct" ? bad : async () => setup), /refused/i);
  }
}
await assert.rejects(verifyPilot(pins,valid,async()=>{throw new Error(url());}),
  e=>e instanceof Error && /refused/i.test(e.message) && !e.message.includes("fixture-only"));

// Both fixtures have the same human-facing branch name and database. Feed the real launcher
// a valid URL, but return the other project's identity through a local replacement for fetch.
const pilot = {branchName:"production", row:runtime};
const website = {branchName:"production", row:{...runtime, project_id:"website-project-456", branch_id:"br-website", endpoint_id:"ep-website"}};
assert.equal(pilot.branchName, website.branchName);
assert.equal(pilot.row.database, website.row.database);
const dir = mkdtempSync(join(tmpdir(), "quizotab-pilot-refusal-"));
try {
  const manifest = join(dir, "pins.json"), credentials = join(dir, "credentials"), mock = join(dir, "offline.cjs");
  writeFileSync(manifest, JSON.stringify(pins));
  writeFileSync(credentials, ["DATABASE_URL="+url(),"SESSION_SECRET=fixture","HMAC_SECRET=fixture"].join("\n"));
  writeFileSync(mock, `
    globalThis.WebSocket = class { constructor() { throw Error("Unexpected pooled connection"); } };
    globalThis.fetch = async () => {
      console.log("Synthetic HTTP identity probe");
      const row = ${JSON.stringify(website.row)};
      return Response.json({fields:Object.keys(row).map(name => ({name, dataTypeID:25})), rows:[Object.values(row)], rowCount:1, command:"SELECT"});
    };
  `);
  const env = {...process.env};
  for (const k of Object.keys(env)) if (/^(DATABASE_URL|POSTGRES|PG|NEON_|DEV_NEON_|QUIZOTAB_PILOT|NODE_TLS|NODE_EXTRA_CA)/i.test(k)) delete env[k];
  const run = spawnSync(process.execPath, ["--require",mock,"--import",pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
    resolve("scripts/pilot.mts"),"start",manifest,credentials], {cwd:dir,env,encoding:"utf8",timeout:30000,windowsHide:true});
  assert.equal(run.status, 1);
  assert.match(run.stdout, /Synthetic HTTP identity probe/);
  assert.match(run.stderr, /Pilot refused/);
  assert.doesNotMatch(run.stdout+run.stderr, /fixture-only|Ready in|Local:/);
} finally { rmSync(dir, {recursive:true, force:true}); }
console.log("ok  separate-project manifest, identity SQL, three adapters, same-name project isolation and refused startup");
