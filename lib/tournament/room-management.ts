import "server-only";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import type { Session } from "@/lib/auth/session";
import type { Db } from "@/lib/db";
import { teams, tournaments, tournamentRoomStaff as staff, tournamentScoreEntries, tournamentState, users } from "@/lib/db/schema";
import { withRoomOwner } from "./room-access";
import { guardDisputedChanges } from "./adjudication";
import { hasLaterDraw } from "./fixture-lifecycle";
import { officialAwards, officialFixture, roundTotals } from "./official-standings";
import { contextReadiness, readScoringPlan } from "./scoring-plan";
import { computeStandings, firstKnockoutStage, knockoutStagesFrom, prelimMatches, normalizePairings, stageRoundsFor, type TournamentConfig, type Pairing, type Room } from "./rules";
import { readState, storedRooms, writeState } from "./store";

const roomId = z.string().min(1).max(80);
const name = z.string().trim().min(1).max(80);
const command = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), name }),
  z.strictObject({ action: z.literal("rename"), roomId, name }),
  z.strictObject({ action: z.literal("delete"), roomId }),
  z.strictObject({ action: z.literal("panel"), roomId, judgeId: z.string().max(80), panelistIds: z.array(z.string().max(80)).max(20) }),
  z.strictObject({ action: z.literal("assign"), roomId, role: z.enum(["judge", "room_host"]), email: z.email().max(255) }),
  z.strictObject({ action: z.literal("revoke"), roomId, assignmentId: z.uuid() }),
]);
export type RoomCommand = z.infer<typeof command>;

export async function roomSetup(tx: Db, id: string) {
  const rooms = await storedRooms(tx, id);
  const assignments = await tx.select({ id: staff.id, role: staff.role, roomId: staff.roomId, name: users.name, email: users.email })
    .from(staff).innerJoin(users, eq(users.id, staff.userId))
    .where(and(eq(staff.tournamentId, id), isNull(staff.revokedAt))).orderBy(asc(staff.id));
  // Use PostgreSQL's full timestamp precision. Every room/assignment mutation touches this document.
  const [doc] = await tx.select({ revision: sql<string>`${tournamentState.updatedAt}::text` }).from(tournamentState)
    .where(and(eq(tournamentState.tournamentId, id), eq(tournamentState.key, "rooms")));
  return { rooms, assignments, revision: doc?.revision ?? "initial" };
}
export type RoomSetup = Awaited<ReturnType<typeof roomSetup>>;

export function listRoomSetup(db: Db, id: string, session: Session | null) {
  return withRoomOwner(db, id, session, tx => roomSetup(tx, id));
}

export async function saveRoomPairings(tx: Db, id: string, proposed: unknown, expected: unknown) {
  const [source] = await tx.select({ engine: tournaments.scoringEngineVersion }).from(tournaments).where(eq(tournaments.id,id)).for("update");
  const { pairings, config } = await readState(tx, id);
  if (!isDeepStrictEqual(pairings, expected)) throw new ApiError(409, "The draw changed. Refresh before saving.");
  if (!Array.isArray(proposed)) throw new ApiError(400, "Invalid draw.");
  const rooms = await storedRooms(tx, id);
  const next = normalizePairings(proposed);
  if (next.some(p => p.roomId && !rooms.some(r => r.id === p.roomId))) throw new ApiError(409, "A selected room no longer exists.");
  if (source.engine === "room_v1") {
    await guardDisputedChanges(tx,id);
    for (const fixture of pairings) {
      if (fixture.released && pairings.some(upstream => hasLaterDraw(upstream,[fixture],config))) {
        const proposed = next.find(p => p.id === fixture.id);
        // A released dependent fixture can acquire a tiebreak, but cannot be
        // converted back to a draft or assigned different participants.
        if (!proposed || !isDeepStrictEqual({...fixture,tiebreakWinnerId:null},{...proposed,tiebreakWinnerId:null})) {
          throw new ApiError(409,"A released dependent fixture must be preserved.");
        }
      }
    }
    const used = await tx.selectDistinct({ contextId: tournamentScoreEntries.contextId }).from(tournamentScoreEntries)
      .where(eq(tournamentScoreEntries.tournamentId,id));
    for (const { contextId } of used) {
      const before = pairings.find(p => p.id === contextId);
      const after = next.find(p => p.id === contextId);
      if (before && (!after || before.stage !== after.stage || before.matchLabel !== after.matchLabel ||
          before.roomId !== after.roomId || before.teamAId !== after.teamAId || before.teamBId !== after.teamBId)) {
        throw new ApiError(409,"Keep the original participants, room and stage of a scored fixture.");
      }
    }
    const [doc] = await tx.select({ value: tournamentState.value }).from(tournamentState)
      .where(and(eq(tournamentState.tournamentId,id),eq(tournamentState.key,"scoringPlan")));
    const plan = readScoringPlan(doc?.value);
    for (const closed of plan.completedContexts ?? []) {
      const original = pairings.find(p => p.id === closed);
      if (original && (!isDeepStrictEqual(original,next.find(p => p.id === closed)) ||
          (hasLaterDraw(original,pairings,config) && !hasLaterDraw(original,next,config)))) {
        throw new ApiError(409,"A completed fixture or its downstream draw is protected.");
      }
    }
    const awards = await officialAwards(tx,id);
    const registered = await tx.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.tournamentId,id));
    validateDrawDependencies(config,next,pairings,registered,awards,plan);
    const releases=next.filter(p=>p.released && !pairings.some(old=>old.id===p.id && old.released &&
      old.roomId===p.roomId && old.stage===p.stage && old.matchLabel===p.matchLabel && old.teamAId===p.teamAId && old.teamBId===p.teamBId));
    if (releases.length) {
      const setup=await roomSetup(tx,id);
      const [t]=await tx.select({status:tournaments.status}).from(tournaments).where(eq(tournaments.id,id));
      for (const p of releases) {
        const reasons=contextReadiness({...setup,config,plan,registered,status:t.status},{roomId:p.roomId ?? null,
          members:[p.teamAId,p.teamBId].filter((id):id is string=>!!id),rounds:stageRoundsFor(config,p.stage,p.matchLabel)});
        if (reasons.length) throw new ApiError(409,reasons.join(" "));
      }
    }
  }
  await writeState(tx, id, "pairings", next);
}

export function validateDrawDependencies(config: TournamentConfig, next: Pairing[], pairings: Pairing[],
  registered: {id:string;name:string}[], awards: Awaited<ReturnType<typeof officialAwards>>, plan: ReturnType<typeof readScoringPlan>) {
  const prelim = config.format === "championship" ? prelimMatches(config) : [];
  const stages = knockoutStagesFrom(firstKnockoutStage(config.format === "championship" ? config.qualificationCount : registered.length));
  const groups: string[] = [...prelim,...stages];
  const group = (p: Pairing) => p.stage === "preliminary" ? p.matchLabel ?? "" : p.stage;
  const refuse = () => { throw new ApiError(409,"Complete and release the prerequisite fixtures before advancing eligible teams."); };
  if (next.some(p => !groups.includes(group(p))) || new Set(next.map(p => p.id)).size !== next.length) refuse();
  const last = Math.max(...next.map(p => groups.indexOf(group(p))));
  let eligible = registered.map(t => t.id);
  for (let i=0; i<=last; i++) {
    const fixtures = next.filter(p => group(p) === groups[i]);
    if (i === prelim.length && prelim.length) eligible = computeStandings(registered,roundTotals(awards),
      config.rounds.filter(r => r.stage === "preliminary")).slice(0,config.qualificationCount).map(t => t.id);
    const entrants = fixtures.flatMap(p => [p.teamAId,p.teamBId]).filter((id): id is string => !!id);
    if (new Set(entrants).size !== entrants.length || entrants.some(id => !eligible.includes(id))) refuse();
    if (i === last) break;
    if (!fixtures.length || fixtures.length !== Math.ceil(eligible.length/2) || entrants.length !== eligible.length ||
        !isDeepStrictEqual(fixtures,pairings.filter(p => group(p) === groups[i]))) refuse();
    const results = fixtures.map(p => officialFixture(p,config,plan,awards));
    if (results.some(r => !r.complete)) refuse();
    if (i >= prelim.length) {
      eligible = results.flatMap(r => r.winnerId ? [r.winnerId] : []);
      if (eligible.length !== results.length) refuse();
    }
  }
}

async function deleteRoom(tx: Db, id: string, roomId: string) {
  const [score] = await tx.select({ id: tournamentScoreEntries.id }).from(tournamentScoreEntries)
    .where(and(eq(tournamentScoreEntries.tournamentId, id), eq(tournamentScoreEntries.roomId, roomId))).limit(1);
  if (score) throw new ApiError(409, "This room has scoring history and must be kept.");
  const [doc] = await tx.select({value:tournamentState.value}).from(tournamentState).where(and(eq(tournamentState.tournamentId,id),eq(tournamentState.key,"scoringPlan")));
  if (readScoringPlan(doc?.value).rosters.some(r=>r.roomId===roomId)) throw new ApiError(409,"Remove this room’s roster references first.");
  const { pairings } = await readState(tx, id);
  if (pairings.some(p => p.roomId === roomId && p.released)) throw new ApiError(409, "A released pairing still uses this room.");
  if (pairings.some(p => p.roomId === roomId)) {
    await guardDisputedChanges(tx,id);
    await writeState(tx, id, "pairings", pairings.map(p => p.roomId === roomId ? { ...p, roomId: null } : p));
  }
  await tx.update(staff).set({ revokedAt: sql`clock_timestamp()` })
    .where(and(eq(staff.tournamentId, id), eq(staff.roomId, roomId), isNull(staff.revokedAt)));
}

async function assign(tx: Db, id: string, action: Extract<RoomCommand, { action: "assign" }>) {
  const [account] = await tx.select({ id: users.id }).from(users)
    .where(and(eq(users.email, action.email.toLowerCase()), isNotNull(users.emailVerifiedAt))).for("key share");
  if (!account) throw new ApiError(400, "Enter the email of a verified QuizoTab account.");
  const activeRoom = and(eq(staff.tournamentId, id), eq(staff.roomId, action.roomId), isNull(staff.revokedAt));
  const [existing] = await tx.select({ id: staff.id }).from(staff).where(and(activeRoom, eq(staff.userId, account.id)));
  if (existing) throw new ApiError(409, "This account already has an active role in the room.");
  if (action.role === "room_host") {
    await tx.update(staff).set({ revokedAt: sql`clock_timestamp()` }).where(and(activeRoom, eq(staff.role, "room_host")));
  }
  await tx.insert(staff).values({ tournamentId: id, roomId: action.roomId, userId: account.id, role: action.role });
}

export function changeRoom(db: Db, id: string, session: Session | null, input: Record<string, unknown>) {
  return withRoomOwner(db, id, session, async tx => {
    const current = await roomSetup(tx, id);
    if (input.revision !== current.revision) throw new ApiError(409, "Room setup changed. Refresh and try again.");
    const parsed = command.safeParse(input.command);
    if (!parsed.success) throw new ApiError(400, "Invalid room command.");
    const action = parsed.data;
    let rooms = current.rooms;
    if ("roomId" in action && !rooms.some(r => r.id === action.roomId)) throw new ApiError(404, "Room not found.");
    switch (action.action) {
      case "create":
        if (rooms.length >= 200) throw new ApiError(409, "The room limit is 200.");
        rooms = [...rooms, { id: randomUUID(), name: action.name, judgeId: "", panelistIds: [] }];
        break;
      case "rename":
        rooms = rooms.map(r => r.id === action.roomId ? { ...r, name: action.name } : r);
        break;
      case "panel": {
        const { judges } = await readState(tx, id);
        const labels = [action.judgeId, ...action.panelistIds].filter(Boolean);
        const taken = rooms.filter(r => r.id !== action.roomId).flatMap(r => [r.judgeId, ...r.panelistIds]);
        if (new Set(labels).size !== labels.length || labels.some(label => taken.includes(label) || !judges.some(j => j.id === label))) {
          throw new ApiError(400, "Choose available tournament panelists.");
        }
        rooms = rooms.map((r): Room => r.id === action.roomId ? { ...r, judgeId: action.judgeId, panelistIds: action.panelistIds } : r);
        break;
      }
      case "delete":
        await deleteRoom(tx, id, action.roomId);
        rooms = rooms.filter(r => r.id !== action.roomId);
        break;
      case "assign":
        await assign(tx, id, action);
        break;
      case "revoke": {
        const revoked = await tx.update(staff).set({ revokedAt: sql`clock_timestamp()` }).where(and(eq(staff.id, action.assignmentId),
          eq(staff.tournamentId, id), eq(staff.roomId, action.roomId), isNull(staff.revokedAt))).returning({ id: staff.id });
        if (!revoked.length) throw new ApiError(409, "Assignment is no longer active.");
        break;
      }
    }
    await writeState(tx, id, "rooms", rooms);
    return roomSetup(tx, id);
  });
}
