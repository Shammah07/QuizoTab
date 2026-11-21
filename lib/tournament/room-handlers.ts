import { ApiError, body, route } from "@/lib/api";
import { authenticated, requireActiveAssignment } from "./room-access";
import type { Session } from "@/lib/auth/session";
import type { Db } from "@/lib/db";
import { changeRoom, listRoomSetup } from "./room-management";

type Context = { params: Promise<{ id: string }> };
// Staff can confirm their own assignment during setup, independently of score entry.
export function assignmentHandler(database: () => Db, session: () => Promise<Session | null>) {
  return route<{ params: Promise<{ id: string; roomId: string }> }>(async (request, { params }) => {
    const actor = authenticated(await session());
    const role = request.nextUrl.searchParams.get("role");
    if (role !== "judge" && role !== "room_host") throw new ApiError(400, "Choose a room staff role.");
    const { id, roomId } = await params;
    return requireActiveAssignment(database(), id, roomId, actor, role);
  });
}
export function roomHandlers(database: () => Db, session: () => Promise<Session | null>) {
  return {
    GET: route<Context>(async (_, { params }) => listRoomSetup(database(), (await params).id, await session())),
    POST: route<Context>(async (request, { params }) => changeRoom(database(), (await params).id, await session(), await body(request))),
  };
}
