import { lockedEngine, withLegacyScoring } from "./legacy-scoring";
import "server-only";
import { and, asc, desc, eq, inArray, notExists, or, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { guardDisputedChanges } from "./adjudication";
import { readScoringPlan, validRound } from "./scoring-plan";
import { officialAwards, officialFixture, roundTotals } from "./official-standings";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { guestCodeKey, makeGuestCode } from "@/lib/auth/tokens";
import { readPins, requirePilotSession } from "@/lib/db/pilot-target";
import type { Db } from "@/lib/db";
import { guestCodes, quizGames, teams, tournamentJudges, tournamentRoomStaff, tournamentScoreEntries, tournamentScoreEvents, tournaments, tournamentState, users } from "@/lib/db/schema";
import {
  defaultConfig,
  FORMAT_KEYS,
  normalizeConfig,
  normalizeJudges,
  normalizePairings,
  normalizeRooms,
  normalizeScores,
  normalizeSharing,
  roundRange,
  stageRoundsFor,
  prelimMatches,
  uid,
  type Format,
  type Judge,
  type Pairing,
  type Room,
  type Score,
  type Sharing,
  type Team,
  type TournamentConfig,
  type TournamentRow,
} from "./rules";

// Reading and writing tournaments on Neon. The tournament app in ../Quiz Web talked to Supabase
// from the browser; here every change goes through these functions on the server, so only the
// owner can change a tournament and only its judges can enter scores.
//
// A tournament's data is one row in `tournaments` plus named JSON documents in `tournament_state`
// (config, scores, pairings, rooms, judges, sharing) and rows in `teams`. The config and scores
// documents are also what lib/quiz/tournament-link.ts reads, so live quizzes keep feeding rounds.

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<never> => ({ ok: false, status, error });

export type State = { config: TournamentConfig; scores: Score[]; pairings: Pairing[]; rooms: Room[]; judges: Judge[]; sharing: Sharing };
export type StateKey = keyof State;
export const STATE_KEYS: StateKey[] = ["config", "scores", "pairings", "rooms", "judges", "sharing"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const looksLikeId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

const row = {
  id: tournaments.id,
  name: tournaments.name,
  category: tournaments.category,
  year: tournaments.year,
  startDate: tournaments.startDate,
  endDate: tournaments.endDate,
  status: tournaments.status,
  createdAt: tournaments.createdAt,
};
const toRow = (t: { createdAt: Date } & Omit<TournamentRow, "createdAt">): TournamentRow => ({ ...t, createdAt: t.createdAt.toISOString() });

// ---------- Tournaments ----------

export async function listOwnTournaments(db: Db, ownerId: number): Promise<TournamentRow[]> {
  const list = await db.select(row).from(tournaments).where(eq(tournaments.ownerId, ownerId)).orderBy(desc(tournaments.createdAt));
  return list.map(toRow);
}

// Null when the tournament doesn't exist or belongs to someone else: the two look the same from outside
export async function ownTournament(db: Db, id: unknown, ownerId: number): Promise<TournamentRow | null> {
  if (!looksLikeId(id)) return null;
  const [t] = await db
    .select(row)
    .from(tournaments)
    .where(and(eq(tournaments.id, id), eq(tournaments.ownerId, ownerId)));
  return t ? toRow(t) : null;
}

export async function tournamentById(db: Db, id: unknown): Promise<(TournamentRow & { ownerId: number }) | null> {
  if (!looksLikeId(id)) return null;
  const [t] = await db
    .select({ ...row, ownerId: tournaments.ownerId })
    .from(tournaments)
    .where(eq(tournaments.id, id));
  return t ? { ...toRow(t), ownerId: t.ownerId } : null;
}

const detailsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  year: z.coerce.number().int().min(2000).max(2100),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""),
  format: z.enum(FORMAT_KEYS as [Format, ...Format[]]).default("championship"),
});

export type TournamentInput = {
  name?: unknown;
  category?: unknown;
  year?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  format?: unknown;
  scoringEngineVersion?: unknown;
  // The rules of a tournament to copy (same format), or nothing to start from the format's usual rounds
  template?: unknown;
};

// Payments are skipped for now: every format is free and the tournament is made straight away
// (on the PHP site, payments.php created it once Pesapal confirmed the payment)
export async function createTournament(db: Db, ownerId: number, input: TournamentInput): Promise<Result<TournamentRow>> {
  const engine = input.scoringEngineVersion === undefined ? "legacy" : input.scoringEngineVersion;
  if (engine !== "legacy" && engine !== "room_v1") {
    return fail(409, "Only legacy tournament scoring is enabled.");
  }
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "name" || field === "category" || field === "year") return fail(400, "Enter a tournament name, category, and year.");
    return fail(400, "Check the dates and the format, then try again.");
  }
  const d = parsed.data;
  if (d.startDate && d.endDate && d.endDate < d.startDate) return fail(400, "The end date is before the start date.");

  const template = input.template && typeof input.template === "object" ? normalizeConfig(input.template) : null;
  const base = template && template.format === d.format ? { ...template, rounds: template.rounds.map((r) => ({ ...r, id: uid() })) } : defaultConfig(d.format);
  const config: TournamentConfig = { ...base, name: d.name, startDate: d.startDate, endDate: d.endDate, setupDone: true };

  return db.transaction(async tx=>{
    if (engine === "room_v1") {
      try {
        const pins = readPins(JSON.parse(process.env.QUIZOTAB_PILOT_PINS ?? ""));
        await requirePilotSession(tx, pins, pins.runtimeRole);
      } catch { return fail(409, "Only legacy tournament scoring is enabled."); }
      const guard = await tx.execute(sql`select exists(select from pg_catalog.pg_trigger t
        join pg_catalog.pg_proc p on p.oid=t.tgfoid join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where tgrelid='public.tournaments'::regclass and tgname='pilot_engine_guard_v1'
          and tgenabled='A' and tgtype=21 and tgqual is null and tgattr=''::int2vector and not tgisinternal
          and p.prosecdef and pg_get_userbyid(p.proowner)='quizotab_pilot_setup' and n.nspname='pilot_admission' and p.proname='guard_engine') as ready`);
      if (guard.rows[0]?.ready !== true) return fail(409, "Pilot admission is unavailable.");
    }
    const [account]=await tx.select({role:users.role}).from(users).where(eq(users.id,ownerId)).for("share");
    if(account?.role!=="host") return fail(403,"A host account is required to create a tournament.");
    const [created] = await tx
      .insert(tournaments)
      .values({ ownerId, name: d.name, category: d.category, year: d.year, startDate: d.startDate || null, endDate: d.endDate || null, status: "active", scoringEngineVersion: engine })
      .returning({ ...row, engine: tournaments.scoringEngineVersion });
    if (created.engine !== engine) throw new ApiError(409, "Tournament scoring engine did not match the request.");
    await tx.insert(tournamentState).values([
      { tournamentId: created.id, key: "config", value: config },
      { tournamentId: created.id, key: "scores", value: [] },
      { tournamentId: created.id, key: "pairings", value: [] },
      { tournamentId: created.id, key: "rooms", value: [] },
      { tournamentId: created.id, key: "judges", value: [] },
      { tournamentId: created.id, key: "sharing", value: normalizeSharing({}) },
    ]);
    return { ok: true as const, value: toRow(created) };
  }).catch(error => {
    if (error?.cause?.code === "QT403") return fail(403, "Room tournament admission denied.");
    throw error;
  });
}

// Removes the tournament and everything in it. Live quiz games that sent scores to it are unlinked;
// judge logins that judged nothing else are removed too.
export async function deleteTournament(db: Db, id: string, ownerId: number) {
  const own = await ownTournament(db, id, ownerId);
  if (!own) return false;
  if (await lockedEngine(db,id)!=="legacy") throw new ApiError(409,"Room-scored tournaments must retain their history.");
  const [assignment] = await db.select({ id: tournamentRoomStaff.id }).from(tournamentRoomStaff).where(eq(tournamentRoomStaff.tournamentId, id)).limit(1);
  const [entry] = await db.select({ id: tournamentScoreEntries.id }).from(tournamentScoreEntries).where(eq(tournamentScoreEntries.tournamentId, id)).limit(1);
  if (assignment || entry) throw new ApiError(409, "This tournament has room staff or scoring history and must be kept.");
  const judgeIds = (await db.select({ userId: tournamentJudges.userId }).from(tournamentJudges).where(eq(tournamentJudges.tournamentId, id))).map((j) => j.userId);
  await db.update(quizGames).set({ tournamentId: null, tournamentLabel: null }).where(eq(quizGames.tournamentId, id));
  // teams, tournament_state, tournament_judges and guest_codes go with it (ON DELETE CASCADE)
  await db.delete(tournaments).where(and(eq(tournaments.id, id), eq(tournaments.ownerId, ownerId)));
  for (const userId of judgeIds) await removeJudgeLoginIfIdle(db, userId);
  return true;
}

// ---------- The state documents ----------

const normalizers: { [K in StateKey]: (input: unknown) => State[K] } = {
  config: normalizeConfig,
  scores: normalizeScores,
  pairings: normalizePairings,
  rooms: normalizeRooms,
  judges: normalizeJudges,
  sharing: normalizeSharing,
};

export async function storedRooms(db: Db, id: string) {
  const [row] = await db.select({ value: tournamentState.value }).from(tournamentState)
    .where(and(eq(tournamentState.tournamentId, id), eq(tournamentState.key, "rooms")));
  const raw = row ? row.value : [];
  if (!Array.isArray(raw) || raw.length > 200 || raw.some(r => typeof r?.id !== "string" || r.id.length > 80 || !r.id.trim() || r.id !== r.id.trim()) ||
      new Set(raw.map(r => r.id)).size !== raw.length) {
    throw new ApiError(409, "Room IDs are missing or duplicated. Review the stored room configuration.");
  }
  return normalizeRooms(raw);
}

export async function readState(db: Db, tournamentId: string): Promise<State> {
  const rows = await db
    .select({ key: tournamentState.key, value: tournamentState.value })
    .from(tournamentState)
    .where(and(eq(tournamentState.tournamentId, tournamentId), inArray(tournamentState.key, STATE_KEYS)));
  const read = <K extends StateKey>(key: K): State[K] => normalizers[key](rows.find((r) => r.key === key)?.value);
  return { config: read("config"), scores: read("scores"), pairings: read("pairings"), rooms: read("rooms"), judges: read("judges"), sharing: read("sharing") };
}

export async function writeState<K extends StateKey>(db: Db, tournamentId: string, key: K, value: State[K]) {
  if (key==="scores") return withLegacyScoring(db,tournamentId,tx=>persistState(tx,tournamentId,key,value));
  return persistState(db,tournamentId,key,value);
}

async function persistState<K extends StateKey>(db: Db, tournamentId: string, key: K, value: State[K]) {
  await db
    .insert(tournamentState)
    .values({ tournamentId, key, value })
    .onConflictDoUpdate({ target: [tournamentState.tournamentId, tournamentState.key], set: {
      value,
      updatedAt: key === "rooms" ? sql`greatest(clock_timestamp(), ${tournamentState.updatedAt} + interval '1 microsecond')` : sql`now()`,
    } });
}

// The config also carries the name and dates, which the tournament row shows in lists
async function storedScoringPlan(db: Db, id: string) {
  const [doc] = await db.select({value:tournamentState.value}).from(tournamentState)
    .where(and(eq(tournamentState.tournamentId,id),eq(tournamentState.key,"scoringPlan")));
  return readScoringPlan(doc?.value);
}

export async function saveConfig(db: Db, tournamentId: string, config: TournamentConfig) {
  await guardDisputedChanges(db,tournamentId);
  const plan = await storedScoringPlan(db, tournamentId);
  if (plan.rounds.length) {
    const {config:prior} = await readState(db,tournamentId);
    if (plan.rounds.some(r=>!validRound(config,r)) || prior.format!==config.format ||
        plan.rounds.some(r=>{
          const before=prior.rounds.find(round=>round.id===r.id);
          const after=config.rounds.find(round=>round.id===r.id);
          return before?.stage!==after?.stage || before?.match!==after?.match;
        })) throw new ApiError(409,"Update the affected room question plans before changing their round definitions.");
  }
  if (plan.completedContexts?.length) {
    const { config: previous, pairings } = await readState(db, tournamentId);
    const changed = plan.completedContexts.some(id => {
      const pair = pairings.find(p => p.id === id);
      const roster = plan.rosters.find(r => r.id === id);
      const rounds = (c: TournamentConfig) => pair ? stageRoundsFor(c, pair.stage, pair.matchLabel)
        : c.rounds.filter(r => r.id === roster?.roundId);
      return !isDeepStrictEqual(rounds(previous), rounds(config));
    });
    if (changed || previous.format !== config.format || previous.maxScorePerRound !== config.maxScorePerRound ||
        previous.qualificationCount !== config.qualificationCount || !isDeepStrictEqual(prelimMatches(previous), prelimMatches(config))) {
      throw new ApiError(409, "Reopen affected contexts before changing scoring rules.");
    }
  }
  await writeState(db, tournamentId, "config", config);
  await db
    .update(tournaments)
    .set({ name: config.name, startDate: config.startDate || null, endDate: config.endDate || null })
    .where(eq(tournaments.id, tournamentId));
}

// ---------- Teams ----------

const toTeam = (t: typeof teams.$inferSelect): Team => ({
  id: t.id,
  name: t.name,
  category: t.category ?? "",
  members: t.members ?? "",
  registeredBy: t.registeredBy ?? "",
  createdAt: t.createdAt.toISOString(),
});

export async function loadTeams(db: Db, tournamentId: string): Promise<Team[]> {
  const list = await db.select().from(teams).where(eq(teams.tournamentId, tournamentId)).orderBy(asc(teams.createdAt));
  return list.map(toTeam);
}

const teamSchema = z.object({
  name: z.string().trim().min(1, "Enter the team's name.").max(120, "Keep the team's name under 120 characters."),
  category: z.string().trim().max(80).default(""),
  members: z.string().trim().max(500).default(""),
});

// Postgres refused a second team with the same name (drizzle wraps the database error as the cause)
function isDuplicate(error: unknown) {
  const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505" || /duplicate key|unique/i.test(`${e?.message ?? ""} ${e?.cause?.message ?? ""}`);
}

export async function addTeam(db: Db, tournamentId: string, input: Record<string, unknown>, registeredBy: string): Promise<Result<Team>> {
  const parsed = teamSchema.safeParse(input);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Check the team's details.");
  const t = parsed.data;
  try {
    const [created] = await db
      .insert(teams)
      .values({ tournamentId, name: t.name, category: t.category || null, members: t.members || null, registeredBy: registeredBy.slice(0, 120) || null })
      .returning();
    return { ok: true, value: toTeam(created) };
  } catch (error) {
    if (isDuplicate(error)) return fail(409, "A team with that name already exists.");
    throw error;
  }
}

export async function updateTeam(db: Db, tournamentId: string, teamId: unknown, input: Record<string, unknown>): Promise<Result<Team>> {
  if (!looksLikeId(teamId)) return fail(404, "Team not found.");
  const parsed = teamSchema.safeParse(input);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Check the team's details.");
  const t = parsed.data;
  try {
    const [updated] = await db
      .update(teams)
      .set({ name: t.name, category: t.category || null, members: t.members || null })
      .where(and(eq(teams.id, teamId), eq(teams.tournamentId, tournamentId)))
      .returning();
    if (!updated) return fail(404, "Team not found.");
    return { ok: true, value: toTeam(updated) };
  } catch (error) {
    if (isDuplicate(error)) return fail(409, "A team with that name already exists.");
    throw error;
  }
}

// Removes the team and the scores it had
export async function deleteTeam(db: Db, tournamentId: string, teamId: unknown) {
  if (!looksLikeId(teamId)) return false;
  const plan = await storedScoringPlan(db,tournamentId);
  if (plan.rosters.some(r=>r.teamIds.includes(teamId))) throw new ApiError(409,"Remove this team from its room roster first.");
  if (plan.completedContexts?.length) {
    const closed = new Set(plan.completedContexts);
    const { pairings } = await readState(db,tournamentId);
    if (pairings.some(p => closed.has(p.id) && [p.teamAId,p.teamBId].includes(teamId)) ||
        plan.rosters.some(r => closed.has(r.id) && r.teamIds.includes(teamId))) {
      throw new ApiError(409,"A completed context still references this team.");
    }
  }
  const [gone] = await db
    .delete(teams)
    .where(and(eq(teams.id, teamId), eq(teams.tournamentId, tournamentId)))
    .returning({ id: teams.id });
  if (!gone) return false;
  if (await lockedEngine(db,tournamentId)==="legacy") {
    const { scores } = await readState(db, tournamentId);
    await writeState(db,tournamentId,"scores",scores.filter(s=>s.teamId!==teamId));
  }
  return true;
}

// ---------- Scores ----------

// One change to the scores document. Each change is applied on the server to what is stored right
// now, so two judges saving at the same moment don't overwrite each other's entries.
export type ScoreOp =
  | { op: "enter"; teamId: string; roundId: string; points: number }
  | { op: "approve-round"; roundId: string; approved: boolean }
  | { op: "approve"; scoreId: string; approved: boolean }
  | { op: "delete"; scoreId: string };

export async function applyScoreOp(db: Db, tournamentId: string, input: Record<string, unknown>, who: { name: string; isHost: boolean }): Promise<Result<Score[]>> {
  return withLegacyScoring(db,tournamentId,tx=>applyLegacyScore(tx,tournamentId,input,who));
}

async function applyLegacyScore(db: Db, tournamentId: string, input: Record<string, unknown>, who: { name: string; isHost: boolean }): Promise<Result<Score[]>> {
  const { config, scores } = await readState(db, tournamentId);
  let next: Score[];

  if (input.op === "enter") {
    const teamId = String(input.teamId ?? "");
    const roundId = String(input.roundId ?? "");
    const round = config.rounds.find((r) => r.id === roundId);
    if (!round) return fail(400, "Choose a round.");
    const [team] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.tournamentId, tournamentId), eq(teams.id, looksLikeId(teamId) ? teamId : "00000000-0000-0000-0000-000000000000")));
    if (!team) return fail(400, "Choose a team.");
    const points = Number(input.points);
    const { min, max } = roundRange(config, round);
    if (!Number.isFinite(points) || points < min || points > max) return fail(400, `Points for this round must be between ${min} and ${max}.`);
    const existing = scores.find((s) => s.teamId === teamId && s.roundId === roundId);
    // The host's own entries count straight away; a judge's wait for approval
    const entry: Score = { id: existing?.id ?? uid(), teamId, roundId, points, judgeName: who.name.slice(0, 120), enteredAt: new Date().toISOString(), ...(who.isHost ? { approvedAt: new Date().toISOString() } : {}), approved: who.isHost };
    next = existing ? scores.map((s) => (s.id === existing.id ? entry : s)) : [...scores, entry];
  } else if (!who.isHost) {
    return fail(403, "Only the host can approve or remove scores.");
  } else if (input.op === "approve-round") {
    const roundId = String(input.roundId ?? "");
    next = scores.map((s) => (s.roundId === roundId ? { ...s, approved: input.approved === true, approvedAt: input.approved === true ? (s.approved ? s.approvedAt : new Date().toISOString()) : undefined } : s));
  } else if (input.op === "approve") {
    const scoreId = String(input.scoreId ?? "");
    next = scores.map((s) => (s.id === scoreId ? { ...s, approved: input.approved === true, approvedAt: input.approved === true ? (s.approved ? s.approvedAt : new Date().toISOString()) : undefined } : s));
  } else if (input.op === "delete") {
    const scoreId = String(input.scoreId ?? "");
    next = scores.filter((s) => s.id !== scoreId);
  } else {
    return fail(400, "Unknown change.");
  }

  await persistState(db, tournamentId, "scores", next);
  return { ok: true, value: next };
}

// ---------- Judges ----------

export async function isJudgeFor(db: Db, tournamentId: string, userId: number) {
  const [found] = await db
    .select({ userId: tournamentJudges.userId })
    .from(tournamentJudges)
    .where(and(eq(tournamentJudges.tournamentId, tournamentId), eq(tournamentJudges.userId, userId)));
  return Boolean(found);
}

const judgeSchema = z.object({
  name: z.string().trim().min(1, "Enter the judge's name.").max(100, "Keep the judge's name under 100 characters."),
  email: z.email("Enter a valid email address for the judge.").max(255),
  password: z.string().min(MIN_PASSWORD_LENGTH, `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`).max(200),
});

// Creates a judge login for this tournament, or adds an existing judge account to it.
// Returns the judge entry for the judges document and whether the login already existed.
export async function addJudge(db: Db, tournamentId: string, input: Record<string, unknown>): Promise<Result<{ judge: Judge; existing: boolean }>> {
  const parsed = judgeSchema.safeParse({ ...input, email: String(input.email ?? "").trim().toLowerCase() });
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Check the judge's details.");
  const { name, email, password } = parsed.data;

  const [found] = await db.select({ id: users.id, role: users.role, name: users.name }).from(users).where(eq(users.email, email));
  let userId: number;
  let existing = false;
  if (found) {
    // Someone who already judges another tournament can be added here too; a host's account can't become a judge
    if (found.role !== "judge") return fail(409, "This email already belongs to another account. Use a different email for the judge.");
    userId = found.id;
    existing = true;
  } else {
    const [created] = await db
      .insert(users)
      .values({ name, email, password: await hashPassword(password), role: "judge", emailVerifiedAt: sql`now()` })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });
    if (!created) return fail(409, "This email was just registered. Try again.");
    userId = created.id;
  }
  await db.insert(tournamentJudges).values({ tournamentId, userId }).onConflictDoNothing();

  const judge: Judge = { id: String(userId), name: found ? found.name : name, email, hasLogin: true };
  const { judges } = await readState(db, tournamentId);
  await writeState(db, tournamentId, "judges", [...judges.filter((j) => j.id !== judge.id), judge]);
  return { ok: true, value: { judge, existing } };
}

// A judge login that judges nothing anymore is removed completely
async function removeJudgeLoginIfIdle(db: Db, userId: number) {
  await db.delete(users).where(and(eq(users.id, userId), eq(users.role, "judge"),
    notExists(db.select().from(tournaments).where(eq(tournaments.ownerId, userId))),
    notExists(db.select().from(tournamentJudges).where(eq(tournamentJudges.userId, userId))),
    notExists(db.select().from(tournamentRoomStaff).where(eq(tournamentRoomStaff.userId, userId))),
    notExists(db.select().from(tournamentScoreEntries).where(or(eq(tournamentScoreEntries.judgeUserId, userId), eq(tournamentScoreEntries.reviewerUserId, userId)))),
    notExists(db.select().from(tournamentScoreEvents).where(eq(tournamentScoreEvents.actorUserId, userId))),
  ));
}

export async function removeJudge(db: Db, tournamentId: string, judgeId: unknown) {
  const id = String(judgeId ?? "");
  const { judges, rooms } = await readState(db, tournamentId);
  await writeState(db, tournamentId, "judges", judges.filter((j) => j.id !== id));
  if (rooms.some(r => r.judgeId === id || r.panelistIds.includes(id))) {
    const validated = await storedRooms(db, tournamentId);
    await writeState(db, tournamentId, "rooms", validated.map(r => ({
      ...r, judgeId: r.judgeId === id ? "" : r.judgeId, panelistIds: r.panelistIds.filter(p => p !== id),
    })));
  }
  if (!/^\d+$/.test(id)) return; // a name-only judge with no login
  const userId = Number(id);
  // Room roles have an independent assignment lifecycle in the room editor.
  const removed = await db.delete(tournamentJudges).where(and(eq(tournamentJudges.tournamentId, tournamentId), eq(tournamentJudges.userId, userId)))
    .returning({ userId: tournamentJudges.userId });
  if (removed.length) await removeJudgeLoginIfIdle(db, userId);
}

// ---------- Sharing and guest codes ----------

// The owner's plain guest code, made on first use
export async function guestCodeFor(db: Db, tournamentId: string) {
  const [found] = await db.select({ code: guestCodes.code }).from(guestCodes).where(eq(guestCodes.tournamentId, tournamentId));
  if (found) return found.code;
  return newGuestCode(db, tournamentId);
}

// A new code; the old one stops working at once
export async function newGuestCode(db: Db, tournamentId: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = makeGuestCode();
    const [saved] = await db
      .insert(guestCodes)
      .values({ tournamentId, code, codeKey: guestCodeKey(code) })
      .onConflictDoUpdate({ target: guestCodes.tournamentId, setWhere: sql`${guestCodes.code} <> ${code}`, set: { code, codeKey: guestCodeKey(code), createdAt: sql`now()` } })
      .returning({ code: guestCodes.code });
    if (saved) return saved.code;
  }
  throw new Error("Could not make a guest code that no other tournament uses.");
}

export async function saveSharing(db: Db, tournamentId: string, input: Record<string, unknown>): Promise<Result<Sharing>> {
  const sharing = normalizeSharing({ ...input, showStandings: input.showStandings === true, showDraw: input.showDraw === true });
  if (sharing.listed && !sharing.showStandings && !sharing.showDraw) return fail(400, "Share at least the standings or the draw.");
  await writeState(db, tournamentId, "sharing", sharing);
  return { ok: true, value: sharing };
}

// The tournament a guest code opens, with what its host shares, or null
export async function tournamentForGuestCode(db: Db, code: string) {
  const [found] = await db
    .select({ tournamentId: guestCodes.tournamentId })
    .from(guestCodes)
    .where(eq(guestCodes.codeKey, guestCodeKey(code)));
  if (!found) return null;
  const tournament = await tournamentById(db, found.tournamentId);
  if (!tournament) return null;
  const { sharing } = await readState(db, found.tournamentId);
  return sharing.showStandings || sharing.showDraw ? { tournament, sharing } : null;
}

// ---------- Whole views ----------

// Clears every team, score and pairing of a tournament; its settings, rooms and judges are kept
export async function resetTournament(database: Db, tournamentId: string) {
  return withLegacyScoring(database,tournamentId,async db=>{
    const plan=await storedScoringPlan(db,tournamentId);
    if (plan.rosters.length) throw new ApiError(409,"Remove room rosters before clearing tournament teams.");
    if (plan.completedContexts?.length) throw new ApiError(409,"Completed contexts must be retained.");
    await db.delete(teams).where(eq(teams.tournamentId, tournamentId));
    await persistState(db, tournamentId, "scores", []);
    await writeState(db, tournamentId, "pairings", []);
  });
}

// Everything the host's dashboard shows
export async function hostView(db: Db, tournament: TournamentRow) {
  const [state, teamList, code] = await Promise.all([readState(db, tournament.id), loadTeams(db, tournament.id), guestCodeFor(db, tournament.id)]);
  const [source] = await db.select({ engine: tournaments.scoringEngineVersion }).from(tournaments).where(eq(tournaments.id,tournament.id));
  const awards = source.engine === "room_v1" ? await officialAwards(db,tournament.id) : null;
  const [doc] = awards ? await db.select({ value: tournamentState.value }).from(tournamentState)
    .where(and(eq(tournamentState.tournamentId,tournament.id),eq(tournamentState.key,"scoringPlan"))) : [];
  const plan = readScoringPlan(doc?.value);
  const fixtureResults = awards ? Object.fromEntries(state.pairings.map(p => [p.id,officialFixture(p,state.config,plan,awards)])) : null;
  return { tournament, ...state, teams: teamList, code, roomAwards: awards && roundTotals(awards), fixtureResults };
}

// What a judge sees: the rules, teams, scores and the draw, never the sharing settings or guest code
export async function isLegacyJudgeTournament(db: Db, id: string) {
  const [row] = await db.select({ engine: tournaments.scoringEngineVersion }).from(tournaments).where(eq(tournaments.id, id));
  return row?.engine === "legacy";
}

export async function judgeView(db: Db, tournament: TournamentRow) {
  if (!await isLegacyJudgeTournament(db, tournament.id)) throw new ApiError(409, "Use your assigned workspace at /staff.");
  const [state, teamList] = await Promise.all([readState(db, tournament.id), loadTeams(db, tournament.id)]);
  return { tournament, config:state.config, teams:teamList, scores:state.scores, pairings:state.pairings,roomScoring:false };
}

export type HostView = Awaited<ReturnType<typeof hostView>>;
export type JudgeView = Awaited<ReturnType<typeof judgeView>>;

// The host's tournaments for the home page leaderboard: the preliminary (or every) round's approved totals
export async function standingsSummary(db: Db, ownerId: number) {
  const list = (await listOwnTournaments(db, ownerId)).slice(0, 5);
  const out = [];
  for (const tournament of list) {
    const state = await readState(db, tournament.id);
    const [source] = await db.select({ engine: tournaments.scoringEngineVersion }).from(tournaments).where(eq(tournaments.id,tournament.id));
    const view = { config: state.config, teams: await loadTeams(db,tournament.id), scores: source.engine === "room_v1"
      ? roundTotals(await officialAwards(db,tournament.id)) : state.scores.filter(s => s.approved) };
    const rounds = view.config.format === "championship" ? view.config.rounds.filter((r) => r.stage === "preliminary") : view.config.rounds;
    const ids = new Set(rounds.map((r) => r.id));
    const totals = new Map<string, number>();
    const played = new Set<string>();
    for (const s of view.scores) {
      if (!ids.has(s.roundId)) continue;
      totals.set(s.teamId, (totals.get(s.teamId) ?? 0) + s.points);
      played.add(s.roundId);
    }
    const rows = view.teams.map((t) => ({ name: t.name, total: totals.get(t.id) ?? 0 })).sort((a, b) => b.total - a.total);
    out.push({ id: tournament.id, name: tournament.name, category: tournament.category, roundsPlayed: played.size, roundsTotal: rounds.length, rows: rows.slice(0, 8), teamCount: rows.length });
  }
  return out;
}
