import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { ApiError } from "@/lib/api";
import type { Session } from "@/lib/auth/session";
import type { Db } from "@/lib/db";
import { tournamentRoomStaff as staff, tournaments } from "@/lib/db/schema";
import { looksLikeId, storedRooms } from "./store";

export type RoomRole = "room_host" | "judge";
export function authenticated(session: Session | null) {
  if (!session) throw new ApiError(401, "Log in to access this tournament.");
  return session;
}

// Every writer of room definitions, assignments and pairing references takes this lock first.
export async function withRoomOwner<T>(db: Db, id: string, session: Session | null, work: (tx: Db) => Promise<T>) {
  const { userId } = authenticated(session);
  if (!looksLikeId(id)) throw new ApiError(404, "Tournament not found.");
  return db.transaction(async tx => {
    const [owner] = await tx.select({ id: tournaments.id }).from(tournaments)
      .where(and(eq(tournaments.id, id), eq(tournaments.ownerId, userId))).for("update");
    if (!owner) throw new ApiError(404, "Tournament not found.");
    return work(tx);
  });
}


// Assignment checks also apply to preparation while scoring is disabled.
export async function requireActiveAssignment(db: Db, id: string, roomId: string, session: Session | null, role: RoomRole) {
  const { userId } = authenticated(session);
  if (!looksLikeId(id)) throw new ApiError(404, "Tournament not found.");
  // Check membership before revealing whether a room exists.
  const [assigned] = await db.select({ id: staff.id }).from(staff).where(and(eq(staff.tournamentId, id),
    eq(staff.roomId, roomId), eq(staff.userId, userId), eq(staff.role, role), isNull(staff.revokedAt)));
  if (!assigned) throw new ApiError(403, "No active assignment for this room and role.");
  const room = (await storedRooms(db, id)).find(r => r.id === roomId);
  if (!room) throw new ApiError(404, "Room not found.");
  return { roomId: room.id, name: room.name, role };
}

// Future scoring commands must call these inside their own locked transaction.
async function requireRoomRole(db: Db, id: string, roomId: string, session: Session | null, role: RoomRole) {
  await requireActiveAssignment(db, id, roomId, session, role);
  const [row] = await db.select({ engine: tournaments.scoringEngineVersion }).from(tournaments).where(eq(tournaments.id, id));
  if (row?.engine !== "room_v1") throw new ApiError(409, "Room scoring is disabled.");
}
export const requireRoomJudge = (db: Db, id: string, roomId: string, session: Session | null) => requireRoomRole(db, id, roomId, session, "judge");
export const requireRoomHost = (db: Db, id: string, roomId: string, session: Session | null) => requireRoomRole(db, id, roomId, session, "room_host");
