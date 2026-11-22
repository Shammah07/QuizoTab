import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";
import { PgDialect, type PgDatabase, type PgSession } from "drizzle-orm/pg-core";
import type { NeonQueryResultHKT } from "drizzle-orm/neon-serverless";
import type { PgliteQueryResultHKT } from "drizzle-orm/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { probeIdentity, type PilotPins } from "../lib/db/pilot-target";

export class PilotMigrationRefusal extends Error {}

const approved = [
  { tag: "0000_panoramic_red_hulk", when: 1795023943629, hash: "a6d553f2abece110df79e303e04888a9fd0573dcbeebe874d578c5857a848e36" },
  { tag: "0001_dormant_room_scoring", when: 1795258859019, hash: "c9629c36b54ba47d01a40405c7ea33a10d0ecdc52fbf917bce31c99a6fed7efb" },
];

export function requireApprovedPins(p: PilotPins) {
  const fields = [p.projectId, p.branchId, p.endpointId, p.directHost, p.database, p.runtimeRole, p.setupRole];
  const digest = createHash("sha256").update(JSON.stringify(fields)).digest("hex");
  if (digest !== "6197f894dfeb1acc69e95ac39779ea692c85460ed5eeff05fe5487268ee70ddf")
    throw new PilotMigrationRefusal("Manifest differs from the independently verified pilot.");
}

export function loadApproved(folder: string) {
  const expected = approved.map(({ tag, when }, idx) => ({ idx, version: "7", when, tag, breakpoints: true }));
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));
  if (!isDeepStrictEqual(journal, { version: "7", dialect: "postgresql", entries: expected }) ||
      !isDeepStrictEqual(readdirSync(folder).filter(n => n.endsWith(".sql")).sort(), approved.map(m => m.tag + ".sql")))
    throw new PilotMigrationRefusal("Unexpected migration files or journal.");
  const batch = readMigrationFiles({ migrationsFolder: folder });
  if (batch.length !== approved.length || batch.some((m, i) => m.hash !== approved[i].hash || m.folderMillis !== approved[i].when || !m.bps))
    throw new PilotMigrationRefusal("Canonical migration hash or order mismatch.");
  return batch;
}

// This procedure only installs on a fresh database. An existing journal, even a
// complete one, requires inspection and can never cause a silent skip or resume.
export async function preparePilotSchema(db: PgDatabase<NeonQueryResultHKT | PgliteQueryResultHKT>, pins: PilotPins, folder: string, install: boolean) {
  const batch = loadApproved(folder);
  await db.transaction(async tx => {
    await tx.execute(sql`set local search_path = pg_catalog`);
    const id = await probeIdentity(tx);
    if (id?.project_id !== pins.projectId || id.branch_id !== pins.branchId || id.endpoint_id !== pins.endpointId ||
        id.database !== pins.database || id.login_role !== pins.setupRole || id.effective_role !== pins.setupRole)
      throw new PilotMigrationRefusal("Direct migration session identity mismatch.");
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(62410923001) as acquired`);
    if (lock.rows[0]?.acquired !== true) throw new PilotMigrationRefusal("Another pilot procedure holds the lock.");
    const state = await tx.execute(sql`
      select exists(select from pg_namespace where nspname = 'drizzle') as history,
        exists(select from pg_depend where refclassid = 'pg_namespace'::regclass
          and refobjid = to_regnamespace('public') and classid <> 'pg_default_acl'::regclass) or
        exists(select from pg_namespace where nspname !~ '^pg_' and nspname not in ('public','information_schema')) or
        exists(select from pg_event_trigger) as occupied,
        has_database_privilege(current_database(),'CREATE') as database_create,
        has_schema_privilege('public','USAGE') as public_usage,
        has_schema_privilege('public','CREATE') as public_create,
        has_language_privilege('plpgsql','USAGE') as plpgsql_usage`);
    const row = state.rows[0];
    if (row?.history !== false) throw new PilotMigrationRefusal("Existing Drizzle schema or migration history. Inspect before retrying.");
    if (row.occupied !== false) throw new PilotMigrationRefusal("Unexpected existing database objects.");
    const missing = ["database_create", "public_usage", "public_create", "plpgsql_usage"].filter(k => row[k] !== true);
    if (missing.length) throw new PilotMigrationRefusal("Missing setup privileges: " + missing.join(", "));
    if (!install) return;

    await tx.execute(sql`set local search_path = public`);
    // Drizzle normally opens its own top-level transaction after creating the
    // journal. Bind that call to a savepoint so journal DDL and postchecks are atomic.
    const session: PgSession = Object.assign(Object.create(tx._.session), { transaction: tx.transaction.bind(tx) });
    await new PgDialect().migrate(batch, session, { migrationsFolder: folder });
    const history = await tx.execute(sql`select id, hash, created_at from drizzle.__drizzle_migrations order by id`);
    if (history.rows.length !== approved.length || history.rows.some((r, i) =>
      Number(r.id) !== i + 1 || r.hash !== approved[i].hash || Number(r.created_at) !== approved[i].when))
      throw new PilotMigrationRefusal("Installed migration journal mismatch.");
    const guards = await tx.execute(sql`
      select exists(select from pg_constraint where conrelid = 'public.tournaments'::regclass
        and conname = 'tournaments_legacy_engine_only' and contype = 'c' and convalidated) and
        exists(select from pg_trigger where tgrelid = 'public.tournament_score_events'::regclass
          and tgname = 'tournament_score_events_append_only' and tgenabled = 'O'
          and tgfoid = 'public.prevent_tournament_score_event_changes()'::regprocedure) as protected`);
    if (guards.rows[0]?.protected !== true) throw new PilotMigrationRefusal("Installed schema protection check failed.");
  }, { accessMode: install ? "read write" : "read only" });
}
