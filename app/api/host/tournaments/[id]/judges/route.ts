import { body, route, unwrap } from "@/lib/api";
import { db } from "@/lib/db";
import { hostTournament } from "@/lib/tournament/api-helpers";
import { addJudge, readState, removeJudge } from "@/lib/tournament/store";

type Context = RouteContext<"/api/host/tournaments/[id]/judges">;

// Creates a judge login for this tournament (or adds an existing judge account to it)
export const POST = route<Context>(async (request, { params }) => {
  const { tournament } = await hostTournament(db(), (await params).id);
  const { judge, existing } = unwrap(await addJudge(db(), tournament.id, await body(request)));
  return { judge, existing, judges: (await readState(db(), tournament.id)).judges };
});

// Removes a judge from this tournament; a login that judges nothing else is deleted
export const DELETE = route<Context>(async (request, { params }) => {
  const { tournament } = await hostTournament(db(), (await params).id);
  await removeJudge(db(), tournament.id, (await body(request)).id);
  return { judges: (await readState(db(), tournament.id)).judges };
});
