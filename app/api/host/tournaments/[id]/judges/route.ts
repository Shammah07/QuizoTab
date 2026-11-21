import { body, route, unwrap } from "@/lib/api";
import { db, transactionDb } from "@/lib/db";
import { withRoomOwner } from "@/lib/tournament/room-access";
import { hostTournament } from "@/lib/tournament/api-helpers";
import { addJudge, readState, removeJudge } from "@/lib/tournament/store";

type Context = RouteContext<"/api/host/tournaments/[id]/judges">;

// Creates a judge login for this tournament (or adds an existing judge account to it)
export const POST = route<Context>(async (request, { params }) => {
  const { user, tournament } = await hostTournament(db(), (await params).id);
  const input = await body(request);
  const { judge, existing } = await withRoomOwner(transactionDb(), tournament.id, user, async tx => unwrap(await addJudge(tx, tournament.id, input)));
  return { judge, existing, judges: (await readState(db(), tournament.id)).judges };
});

// Removes a judge from this tournament; a login that judges nothing else is deleted
export const DELETE = route<Context>(async (request, { params }) => {
  const { user, tournament } = await hostTournament(db(), (await params).id);
  const { id } = await body(request);
  await withRoomOwner(transactionDb(), tournament.id, user, tx => removeJudge(tx, tournament.id, id));
  return { judges: (await readState(db(), tournament.id)).judges };
});
