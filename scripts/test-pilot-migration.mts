import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readPins } from "../lib/db/pilot-target";
import { loadApproved, preparePilotSchema, requireApprovedPins } from "./pilot-migration";

const pins = readPins({ projectId: "local-project", branchId: "br-local", endpointId: "ep-local",
  directHost: "ep-local.test.neon.tech", database: "quizotab_pilot", runtimeRole: "app", setupRole: "quizotab_pilot_setup" });
assert.throws(() => requireApprovedPins(pins), /independently verified/);
const files = loadApproved("drizzle");
const folder = mkdtempSync(join(tmpdir(), "quizotab-canonical-"));
try {
  cpSync("drizzle", folder, { recursive: true });
  const path = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(path, "utf8"));
  journal.entries.reverse();
  writeFileSync(path, JSON.stringify(journal));
  assert.throws(() => loadApproved(folder), /journal/);
  cpSync("drizzle", folder, { recursive: true });
  writeFileSync(join(folder, "0000_panoramic_red_hulk.sql"), "select 1");
  assert.throws(() => loadApproved(folder), /hash/);
} finally { rmSync(folder, { recursive: true, force: true }); }

const bootstrap = new PGlite();
await bootstrap.exec("create database quizotab_pilot");
const image = await bootstrap.dumpDataDir();
await bootstrap.close();
const local = new PGlite({ database: pins.database, loadDataDir: image });
try {
  const db = drizzle(local);
  const run = (install = true) => preparePilotSchema(db, pins, "drizzle", install);
  await local.exec(`
    create role quizotab_pilot_setup login;
    create role insufficient login;
    grant create on database quizotab_pilot to quizotab_pilot_setup;
    grant usage, create on schema public to quizotab_pilot_setup;
    set neon.project_id = 'local-project';
    set neon.branch_id = 'br-local';
    set neon.endpoint_id = 'ep-other';
    set session authorization quizotab_pilot_setup;
  `);
  await assert.rejects(run(), /identity mismatch/);
  await local.exec("set neon.endpoint_id = 'ep-local'");
  await local.exec("set session authorization insufficient");
  await assert.rejects(preparePilotSchema(db, { ...pins, setupRole: "insufficient" }, "drizzle", true), /Missing setup privileges.*database_create/);
  await local.exec(`
    set session authorization quizotab_pilot_setup;
  `);
  await run(false);
  for (const [create, drop] of [
    ["create table unexpected (id int)", "drop table unexpected"],
    ["create type unexpected as enum ('value')", "drop type unexpected"],
    ["create schema unexpected", "drop schema unexpected"],
  ]) {
    await local.exec(create);
    await assert.rejects(run(), /Unexpected existing/);
    await local.exec(drop);
  }
  assert.equal((await local.query<{journal: string | null}>("select to_regnamespace('drizzle') as journal")).rows[0].journal, null);
  // Simulate a hardened default ACL that prevents Drizzle from recording its first migration.
  await local.exec("alter default privileges revoke insert on tables from quizotab_pilot_setup");
  await assert.rejects(run(), error => error instanceof Error && error.cause instanceof Error &&
    /permission denied for table __drizzle_migrations/.test(error.cause.message));
  const rolledBack = await local.query<{ clean: boolean }>(
    "select to_regnamespace('drizzle') is null and to_regclass('public.tournaments') is null as clean");
  assert.equal(rolledBack.rows[0].clean, true);
  await local.exec("alter default privileges grant insert on tables to quizotab_pilot_setup");
  await run();
  const history = await local.query("select hash, created_at::text as stamp from drizzle.__drizzle_migrations order by id");
  assert.deepEqual(history.rows, files.map(m => ({hash: m.hash, stamp: String(m.folderMillis)})));
  const gate = await local.query<{definition: string}>("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.tournaments'::regclass and conname='tournaments_legacy_engine_only' and convalidated");
  assert.match(String(gate.rows[0].definition), /scoring_engine_version = 'legacy'::scoring_engine/);
  await assert.rejects(local.exec("delete from tournament_score_events where false"), /append-only/);
  await assert.rejects(run(), /Existing Drizzle/);
  console.log("ok  pilot migration pins, order, hashes, restricted role, fresh install, journal, legacy gate, audit trigger and refusal paths");
} finally { await local.close(); }
