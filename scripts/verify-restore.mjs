// The fifth argument is the separately reviewed provider recovery approval.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {isAbsolute} from "node:path";
import {parse} from "dotenv";
import pg from "pg";
import {drizzle} from "drizzle-orm/node-postgres";
import {readPins,requireApprovedPins,pilotUrl,rejectInherited} from "../lib/db/pilot-target.ts";
import {restoreEvidence} from "./restore-evidence.mjs";
import {stagingApproval} from "../lib/db/staging-approval.ts";
import {verifyStagingRecovery} from "./staging-provision.mjs";

async function main() {
  rejectInherited(process.env);
  const files=process.argv.slice(2);
  assert.ok(files.length===5 && files.every(file=>isAbsolute(file)) && new Set(files).size===5);
  const pinsAt = file=>readPins(JSON.parse(readFileSync(file,"utf8")));
  const source=pinsAt(files[0]), target=pinsAt(files[2]);
  const approval=JSON.parse(readFileSync(files[4],"utf8"));
  const staging=approval.stagingFixture ? stagingApproval(approval.stagingFixture) : undefined;
  if(staging) assert.deepEqual(staging.pins,source);
  else requireApprovedPins(source);
  for(const key of ["projectId","database","runtimeRole","setupRole"]) assert.equal(source[key],target[key]);
  for(const key of ["branchId","endpointId","directHost"]) assert.notEqual(source[key],target[key]);
  assert.equal(approval.projectId,source.projectId);
  assert.equal(approval.parentBranchId,source.branchId);
  assert.equal(approval.sourceEndpointId,source.endpointId);
  assert.equal(approval.childBranchId,target.branchId);
  assert.equal(approval.childEndpointId,target.endpointId);
  for(const field of ["operatorApproval","recoveryPoint"]) assert.ok(typeof approval[field]==="string" && approval[field].trim().length>0);
  assert.ok(typeof approval.cutoffUtc==="string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(approval.cutoffUtc) &&
    Date.parse(approval.cutoffUtc)<=Date.now());
  function connection(pins,file) {
    const env=parse(readFileSync(file));
    const url=new URL(pilotUrl(env.DATABASE_URL_UNPOOLED,pins,true));
    return new pg.Client({host:url.hostname,port:5432,database:pins.database,user:pins.setupRole,
      password:decodeURIComponent(url.password),ssl:{rejectUnauthorized:true},enableChannelBinding:true,
      options:"-c default_transaction_read_only=on",connectionTimeoutMillis:10000});
  }
  // Validate both credential endpoints before opening either connection.
  const clients=[connection(source,files[1]),connection(target,files[3])];
  const snapshots=[];
  for(const [i,pins] of [source,target].entries()) {
    const client=clients[i];
    try {
      await client.connect();
      snapshots.push(await restoreEvidence(drizzle(client),{database:pins.database,login:pins.setupRole,role:pins.setupRole,
        project:pins.projectId,branch:pins.branchId,endpoint:pins.endpointId},staging ? tx=>verifyStagingRecovery(tx,staging) : undefined));
    } finally { await client.end(); }
  }
  for(const key of Object.keys(snapshots[0])) {
    if(JSON.stringify(snapshots[0][key])!==JSON.stringify(snapshots[1][key])) {
      console.error("Restore discrepancy in",key);
      throw new Error();
    }
  }
  console.log("Verified distinct source and restore identities, protections and scoring snapshot.", {
    entries:snapshots[1].tournament_score_entries.count,events:snapshots[1].tournament_score_events.count});
}
main().catch(()=>{console.error("Restore verification refused. Check pins, credentials, catalog and snapshot consistency.");process.exitCode=1;});
