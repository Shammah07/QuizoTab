import { sql } from "drizzle-orm";
import { requirePilotSession, type PilotPins } from "../lib/db/pilot-target";
import { PilotMigrationRefusal } from "./pilot-migration";
import { inspectScoringPermissions, type Database } from "./pilot-upgrade";

export type ScoringMode = "scoring-preflight" | "scoring-apply" | "scoring-verify";

export async function pilotScorePermissions(db: Database, pins: PilotPins, mode: ScoringMode) {
  const apply = mode === "scoring-apply";
  return db.transaction(async tx => {
    await tx.execute(sql`set local search_path = pg_catalog`);
    await requirePilotSession(tx, pins, pins.setupRole);
    if (apply) {
      await tx.execute(sql`set local lock_timeout = '5s'`);
      const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(62410923001) as acquired`);
      if (lock.rows[0]?.acquired !== true) throw new PilotMigrationRefusal("Another pilot procedure is running.");
      // Block changes to the readiness inputs through commit. READ COMMITTED sees
      // transactions that finished while we waited for the locks.
      await tx.execute(sql`lock table pilot_admission.policy, pilot_admission.hosts, pilot_admission.upgrades,
        public.tournaments, public.tournament_score_entries, public.tournament_score_events in share row exclusive mode`);
    }

    const profile = await inspectScoringPermissions(tx);
    const counts = await tx.execute(sql`select (select count(*) from pilot_admission.hosts) as hosts,
      (select count(*) from public.tournaments where scoring_engine_version='room_v1') as rooms,
      (select count(*) from public.tournament_score_entries) as entries,
      (select count(*) from public.tournament_score_events) as events`);
    const state = counts.rows[0];
    if (mode === "scoring-verify") return { profile, counts: state };
    if (profile !== "legacy") throw new PilotMigrationRefusal("Expected legacy-only permissions. Inspect before retrying.");
    if (["hosts","rooms","entries","events"].some(k => Number(state[k]) !== 0))
      throw new PilotMigrationRefusal("Expected an empty allowlist and zero room-scoring records.");
    if (apply) {
      await tx.execute(sql`grant insert, update (status, reviewer_user_id, reviewed_at, reason)
        on table public.tournament_score_entries to quizotab_pilot_app`);
      await tx.execute(sql`grant insert on table public.tournament_score_events to quizotab_pilot_app`);
      if (await inspectScoringPermissions(tx) !== "full")
        throw new PilotMigrationRefusal("Complete scoring privileges failed verification.");
      return { profile: "full", counts: state };
    }
    return { profile, counts: state };
  }, { isolationLevel: apply ? "read committed" : "repeatable read", accessMode: apply ? "read write" : "read only" });
}
