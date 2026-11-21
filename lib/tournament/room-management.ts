import "server-only";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import type { Session } from "@/lib/auth/session";
import type { Db } from "@/lib/db";
import { tournamentRoomStaff as staff, tournamentScoreEntries, tournamentState, users } from "@/lib/db/schema";
import { withRoomOwner } from "./room-access";
import { normalizePairings, type Room } from "./rules";
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

async function roomSetup(tx: Db, id: string) {
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
  const { pairings } = await readState(tx, id);
  if (!isDeepStrictEqual(pairings, expected)) throw new ApiError(409, "The draw changed. Refresh before saving.");
  if (!Array.isArray(proposed)) throw new ApiError(400, "Invalid draw.");
  const rooms = await storedRooms(tx, id);
  const next = normalizePairings(proposed);
  if (next.some(p => p.roomId && !rooms.some(r => r.id === p.roomId))) throw new ApiError(409, "A selected room no longer exists.");
  await writeState(tx, id, "pairings", next);
}

async function deleteRoom(tx: Db, id: string, roomId: string) {
  const [score] = await tx.select({ id: tournamentScoreEntries.id }).from(tournamentScoreEntries)
    .where(and(eq(tournamentScoreEntries.tournamentId, id), eq(tournamentScoreEntries.roomId, roomId))).limit(1);
  if (score) throw new ApiError(409, "This room has scoring history and must be kept.");
  const { pairings } = await readState(tx, id);
  if (pairings.some(p => p.roomId === roomId && p.released)) throw new ApiError(409, "A released pairing still uses this room.");
  if (pairings.some(p => p.roomId === roomId)) {
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
