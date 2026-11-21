// Unit 1 tests schema guarantees only. All databases are in-memory PGlite.
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";
import { defaultConfig, FORMAT_KEYS } from "@/lib/tournament/rules";
import { applyScoreOp, readState } from "@/lib/tournament/store";

const pg = new PGlite();
const db = drizzle(pg, { schema });
const legacyFolder = await mkdtemp(join(tmpdir(), "quizotab-migration-"));
const fixtures: { id: string; teamId: string; roundId: string }[] = [];
const fixtureTables = ["users", "tournaments", "teams", "tournament_state", "guest_codes", "tournament_judges"];

async function snapshot() {
  return Promise.all(fixtureTables.map(async (table) => {
    const projection = table === "tournaments" ? "to_jsonb(t) - 'scoring_engine_version'" : "to_jsonb(t)";
    return (await pg.query(`SELECT ${projection} AS old_row FROM ${table} t ORDER BY old_row`)).rows;
  }));
}

async function refused(query: string, params: unknown[], code: string, constraint?: string) {
  await assert.rejects(pg.query(query, params), constraint ? { code, constraint } : { code });
}

try {
  // Reproduce an installation that already has 0000 recorded by Drizzle.
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  const initial = journal.entries[0];
  assert.equal(initial.tag, "0000_panoramic_red_hulk");
  await mkdir(join(legacyFolder, "meta"));
  await copyFile(`drizzle/${initial.tag}.sql`, join(legacyFolder, `${initial.tag}.sql`));
  await writeFile(join(legacyFolder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: [initial] }));
  await migrate(db, { migrationsFolder: legacyFolder });

  await pg.exec(`INSERT INTO users (id, name, email, password) VALUES
    (1, 'Owner', 'owner@example.test', 'fixture'),
    (2, 'Judge', 'judge@example.test', 'fixture'),
    (3, 'Panelist', 'panel@example.test', 'fixture')`);
  for (const format of FORMAT_KEYS) {
    const id = randomUUID();
    const teamId = randomUUID();
    const config = defaultConfig(format);
    const roundId = config.rounds[0].id;
    fixtures.push({ id, teamId, roundId });
    await pg.query("INSERT INTO tournaments (id, owner_id, name, year) VALUES ($1, 1, $2, 2026)", [id, format]);
    await pg.query("INSERT INTO teams (id, tournament_id, name) VALUES ($1, $2, 'Team A')", [teamId, id]);
    await pg.query("INSERT INTO tournament_judges (tournament_id, user_id) VALUES ($1, 2)", [id]);
    await pg.query("INSERT INTO guest_codes (tournament_id, code, code_key) VALUES ($1, 'ABCDEF', $2)", [id, id]);
    const docs = {
      config,
      scores: [{ id: "old-score", teamId, roundId, points: 5, judgeName: "Judge", enteredAt: "2026-01-01", approved: true }],
      rooms: [{ id: "hall", name: "Hall", judgeId: "2", panelistIds: [] }],
      judges: [{ id: "2", name: "Judge", email: "judge@example.test", hasLogin: true }],
      pairings: [],
      sharing: { listed: true, showStandings: true, showDraw: false, about: "Legacy" },
    };
    for (const [key, value] of Object.entries(docs)) {
      await pg.query("INSERT INTO tournament_state (tournament_id, key, value) VALUES ($1, $2, $3::jsonb)", [id, key, JSON.stringify(value)]);
    }
  }
  const before = await snapshot();
  await migrate(db, { migrationsFolder: "./drizzle" });
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual((await db.select().from(schema.tournaments)).map(t => t.scoringEngineVersion), FORMAT_KEYS.map(() => "legacy"));
  for (const { id, roundId, teamId } of fixtures) {
    assert.equal((await readState(db, id)).scores[0].points, 5);
    const result = await applyScoreOp(db, id, { op: "enter", teamId, roundId, points: 6 }, { name: "Judge", isHost: false });
    assert.ok(result.ok);
    assert.deepEqual(result.value.map(s => [s.id, s.points, s.approved]), [["old-score", 6, false]]);
    const approved = await applyScoreOp(db, id, { op: "approve", scoreId: "old-score", approved: true }, { name: "Owner", isHost: true });
    assert.ok(approved.ok && approved.value[0].approved);
  }
  console.log("ok  populated migration preserves historical rows and scoring in all four formats");

  const { id, teamId } = fixtures[0];
  await refused("UPDATE tournaments SET scoring_engine_version = 'room_v1' WHERE id = $1", [id], "23514", "tournaments_legacy_engine_only");
  for (const table of ["tournament_room_staff", "tournament_score_entries", "tournament_score_events"]) {
    assert.deepEqual((await pg.query(`SELECT * FROM ${table}`)).rows, []);
  }
  console.log("ok  room engine remains disabled and legacy scoring leaves the new tables empty");

  const staff = "INSERT INTO tournament_room_staff (tournament_id, room_id, user_id, role) VALUES ($1, 'hall', $2, $3)";
  await pg.query(staff, [id, 1, "room_host"]);
  await refused(staff, [id, 2, "room_host"], "23505", "room_staff_active_host");
  await refused(staff, [id, 1, "judge"], "23505", "room_staff_active_user");
  await pg.query(staff, [id, 2, "judge"]);
  await pg.query(staff, [id, 3, "judge"]);
  await pg.exec("UPDATE tournament_room_staff SET revoked_at = now() WHERE user_id = 1");
  await pg.query(staff, [id, 1, "room_host"]);
  console.log("ok  one active host, distinct active roles, multiple judges and retained assignments");

  const add = `INSERT INTO tournament_score_entries
    (tournament_id, room_id, context_id, team_id, round_id, question_key, points, judge_user_id, client_request_id, revision, correction_of, reason)
    VALUES ($1, 'hall', 'fixture', $2, 'r1', $3, 5, 2, $4, $5, $6, $7) RETURNING id`;
  const request = randomUUID();
  const first = (await pg.query<{ id: string }>(add, [id, teamId, "q1", request, 1, null, null])).rows[0].id;
  await refused(add, [id, teamId, "q2", request, 1, null, null], "23505", "score_request_unique");
  await refused(add, [id, fixtures[1].teamId, "q2", randomUUID(), 1, null, null], "23503", "score_team_in_tournament");
  await refused(add, [id, teamId, "q2", randomUUID(), 2, first, "Fix"], "23503", "score_correction_same_attempt");
  await refused(add, [id, teamId, "q1", randomUUID(), 2, first, "Fix"], "23505", "score_attempt_pending");
  const approve = "UPDATE tournament_score_entries SET status = 'approved', reviewer_user_id = $2, reviewed_at = now() WHERE id = $1";
  await refused(approve, [first, 2], "23514", "score_review_valid");
  await pg.query(approve, [first, 1]);
  const correction = (await pg.query<{ id: string }>(add, [id, teamId, "q1", randomUUID(), 2, first, "Fix"])).rows[0].id;
  await refused(approve, [correction, 1], "23505", "score_attempt_approved");
  console.log("ok  request uniqueness, team and revision scope, independent review and one official score");

  await pg.query("INSERT INTO tournament_score_events (score_entry_id, actor_user_id, event_type) VALUES ($1, 2, 'submitted')", [first]);
  await refused("UPDATE tournament_score_events SET details = '{}'", [], "55000");
  await refused("DELETE FROM tournament_score_events", [], "55000");
  await refused("TRUNCATE tournament_score_events", [], "55000");
  await refused("DELETE FROM teams WHERE id = $1", [teamId], "23503");
  console.log("ok  audit events are append-only and referenced teams are retained");
} finally {
  await pg.close();
  await rm(legacyFolder, { recursive: true, force: true });
}
