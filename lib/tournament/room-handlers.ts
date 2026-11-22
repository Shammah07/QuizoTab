import { readOperations, changeOperations } from "./room-operations";
import { ownerAdjudication } from "./adjudication";
import { ApiError, body, route } from "@/lib/api";
import { authenticated, requireActiveAssignment } from "./room-access";
import type { Session } from "@/lib/auth/session";
import type { Db } from "@/lib/db";
import { changeRoom, listRoomSetup } from "./room-management";
import { completionPreview, roomCompletion, ownerReopening } from "./fixture-lifecycle";
import { submitRoomScore } from "./room-scoring";
import { decideRoomScore, pendingRoomScores, proposeCorrection } from "./score-review";

type RoomContext = { params: Promise<{ id: string; roomId: string }> };

export function scoreReviewHandlers(database: () => Db, session: () => Promise<Session | null>) {
  return {
    pending: route<RoomContext>(async (_, { params }) => {
      const actor = authenticated(await session());
      const { id, roomId } = await params;
      return { scores: await pendingRoomScores(database(), id, roomId, actor) };
    }),
    decide: route<RoomContext>(async (request, { params }) => {
      const actor = authenticated(await session());
      const { id, roomId } = await params;
      return decideRoomScore(database(), id, roomId, actor, await body(request));
    }),
    correct: route<RoomContext>(async (request, { params }) => {
      const actor = authenticated(await session());
      const { id, roomId } = await params;
      const { created, ...receipt } = await proposeCorrection(database(), id, roomId, actor, await body(request));
      return Response.json(receipt, { status: created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
    }),
  };
}

export function scoreSubmissionHandler(database: () => Db, session: () => Promise<Session | null>) {
  return route<{ params: Promise<{ id: string; roomId: string }> }>(async (request, { params }) => {
    const actor = authenticated(await session());
    const { id, roomId } = await params;
    const { created, ...receipt } = await submitRoomScore(database(), id, roomId, actor, await body(request));
    return Response.json(receipt, { status: created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  });
}

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

export function lifecycleHandlers(database: () => Db, session: () => Promise<Session | null>, owner = false) {
  const service = owner ? ownerReopening : roomCompletion;
  return {
    GET: route<RoomContext>(async (request,{params}) => {
      const {id,roomId} = await params;
      if (owner && request.nextUrl.searchParams.get("preview")==="1") return ownerReopening(database(),id,roomId,await session(),request.nextUrl.searchParams.get("contextId"),"preview");
      if (!owner && request.nextUrl.searchParams.get("preview") === "1") return completionPreview(database(),id,roomId,await session(),request.nextUrl.searchParams.get("contextId"));
      return service(database(),id,roomId,await session(),request.nextUrl.searchParams.get("contextId"),true);
    }),
    POST: route<RoomContext>(async (request,{params}) => {
      const {id,roomId} = await params;
      return service(database(),id,roomId,await session(),await body(request));
    }),
  };
}

export function adjudicationHandlers(database: () => Db, session: () => Promise<Session | null>) {
  return {
    GET: route<Context>(async (_, {params}) => ownerAdjudication(database(),(await params).id,await session())),
    POST: route<Context>(async (request, {params}) => ownerAdjudication(database(),(await params).id,await session(),await body(request))),
  };
}

export function operationsHandlers(database:()=>Db,session:()=>Promise<Session|null>) {
  return {
    GET:route<Context>(async (_,{params})=>readOperations(database(),(await params).id,await session())),
    POST:route<Context>(async (req,{params})=>changeOperations(database(),(await params).id,await session(),await body(req))),
  };
}
