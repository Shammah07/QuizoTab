import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pilotUrl, readPins, rejectInherited, verifyPilot } from "../lib/db/pilot-target";

const pins=readPins({branch:"quizo-room-pilot-test",directHost:"ep-fixture.test.neon.tech",database:"pilot_db",runtimeRole:"runtime",setupRole:"setup"});
function url(setup=false) {
  const host=setup?pins.directHost:pins.directHost.replace(".","-pooler.");
  const address=new URL("postgresql://"+host+"/"+pins.database+"?sslmode=require");
  address.username=setup?"setup":"runtime";address.password="fixture-only";return address.href;
}
assert.throws(()=>readPins({}));
assert.throws(()=>readPins({...pins,setupRole:pins.runtimeRole}));
assert.equal(pilotUrl(url(),pins),url());
assert.equal(pilotUrl(url(true),pins,true),url(true));
for(const wrong of [url(true),url().replace("runtime","different"),url().replace("pilot_db","other"),
  url().replace("ep-fixture","ep-parent"),url()+"&host=other",url()+"&sslmode=disable",url().replace("=require","=disable")])
  assert.throws(()=>pilotUrl(wrong,pins));
for(const key of ["DATABASE_URL","DATABASE_URL_UNPOOLED","PGOPTIONS","PGUSER","PGSERVICE","NEON_DATABASE_URL","NODE_TLS_REJECT_UNAUTHORIZED"])
  assert.throws(()=>rejectInherited({[key]:"unexpected"}));
const row={endpoint:"ep-fixture",database:pins.database,role:pins.runtimeRole};
const valid=async()=>row;
await verifyPilot(pins,valid,valid,async()=>({...row,role:pins.setupRole}));
for (const invalid of [{...row,endpoint:"ep-parent"},{...row,database:"other"},{...row,role:"admin"}]) {
  await assert.rejects(verifyPilot(pins,async()=>invalid,valid),/refused/i);
  await assert.rejects(verifyPilot(pins,valid,async()=>invalid),/refused/i);
}
await assert.rejects(verifyPilot(pins,valid,valid,valid),/refused/i);
await assert.rejects(verifyPilot(pins,valid,async()=>{throw new Error(url());}),e=>e instanceof Error && !e.message.includes("fixture-only"));
const dir=mkdtempSync(join(tmpdir(),"quizotab-pilot-refusal-"));
try {
  const manifest=join(dir,"pins.json"), credentials=join(dir,"credentials");
  writeFileSync(manifest,JSON.stringify(pins));
  writeFileSync(credentials,["DATABASE_URL="+url().replace("ep-fixture","ep-other"),"SESSION_SECRET=fixture","HMAC_SECRET=fixture"].join("\n"));
  const env={...process.env};
  for(const k of Object.keys(env)) if(/^(DATABASE_URL|POSTGRES|PG|NEON_|DEV_NEON_|QUIZOTAB_PILOT|NODE_TLS|NODE_EXTRA_CA)/i.test(k)) delete env[k];
  const run=spawnSync(process.execPath,[createRequire(import.meta.url).resolve("tsx/cli"),resolve("scripts/pilot.mts"),"start",manifest,credentials],
    {cwd:dir,env,encoding:"utf8",timeout:10000,windowsHide:true});
  assert.equal(run.status,1);
  assert.match(run.stderr,/Pilot refused/);
  assert.doesNotMatch(run.stdout+run.stderr,/fixture-only|Ready in|Local:/);
} finally {rmSync(dir,{recursive:true,force:true});}
console.log("ok  pilot manifest, URL, adapter identities, sanitized failures and refused application startup");
