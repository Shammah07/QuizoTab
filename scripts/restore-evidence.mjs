import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import {inspectScoringPermissions} from "./pilot-upgrade.ts";
import {officialAwards} from "../lib/tournament/official-standings.ts";

// Caller supplies independently obtained expected identity for this target.
// The same read-only snapshot covers identity, privileges, catalog and all comparisons.
export function restoreEvidence(db, expected, verifyProtection) {
  return db.transaction(async tx=>{
    await tx.execute(sql`set local timezone='UTC'`);
    await tx.execute(sql`set local statement_timeout='30s'`);
    const [identity] = (await tx.execute(sql`select current_database() as database, session_user as login,
      current_user as role,current_setting('neon.project_id',true) as project,
      current_setting('neon.branch_id',true) as branch,current_setting('neon.endpoint_id',true) as endpoint`)).rows;
    assert.deepEqual(identity,expected,"Restore evidence identity mismatch");
    // The catalog routines use fully qualified relations and expect this path.
    await tx.execute(sql`set local search_path=pg_catalog`);
    if(verifyProtection) await verifyProtection(tx);
    else {
      assert.equal(await inspectScoringPermissions(tx),"full");
      assert.equal((await tx.execute(sql`select 1 from pilot_admission.hosts`)).rows.length,0);
    }
    const evidence = {};
    for(const table of ["tournament_score_entries","tournament_score_events","tournaments","teams","tournament_room_staff","tournament_state"]) {
      const {rows} = await tx.execute(sql.raw("select to_jsonb(r)::text as record from public."+table+" r order by to_jsonb(r)::text collate \"C\""));
      evidence[table] = {count:rows.length,sha256:createHash("sha256").update(JSON.stringify(rows.map(row=>row.record))).digest("hex")};
    }
    await tx.execute(sql`set local search_path=pg_catalog,public`);
    const awards = [];
    for(const {id} of (await tx.execute(sql`select id from public.tournaments order by id`)).rows) {
      const totals = new Map();
      for(const row of await officialAwards(tx,id)) totals.set(row.teamId,(totals.get(row.teamId)??0)+row.points);
      awards.push([id,[...totals].sort(([a],[b])=>a.localeCompare(b))]);
    }
    evidence.awards = createHash("sha256").update(JSON.stringify(awards)).digest("hex");
    return evidence;
  },{isolationLevel:"repeatable read",accessMode:"read only"});
}
