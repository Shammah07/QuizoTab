import { ApiError, body, route, unwrap } from "@/lib/api";
import { withRoomOwner } from "@/lib/tournament/room-access";
import { db, transactionDb } from "@/lib/db";
import { hostTournament } from "@/lib/tournament/api-helpers";
import { addTeam, deleteTeam, loadTeams, updateTeam } from "@/lib/tournament/store";

type Context = RouteContext<"/api/host/tournaments/[id]/teams">;

// The host adds a team (judges register theirs through /api/tournaments/[id]/judge)
export const POST = route<Context>(async (request, { params }) => {
  const { user, tournament } = await hostTournament(db(), (await params).id);
  unwrap(await addTeam(db(), tournament.id, await body(request), user.name));
  return { teams: await loadTeams(db(), tournament.id) };
});

export const PUT = route<Context>(async (request, { params }) => {
  const { tournament } = await hostTournament(db(), (await params).id);
  const data = await body(request);
  unwrap(await updateTeam(db(), tournament.id, data.id, data));
  return { teams: await loadTeams(db(), tournament.id) };
});

export const DELETE = route<Context>(async (request, { params }) => {
  const { tournament, user } = await hostTournament(db(), (await params).id);
  const teamId = (await body(request)).id;
  await withRoomOwner(transactionDb(), tournament.id, user, async tx => {
    if (!await deleteTeam(tx, tournament.id, teamId)) throw new ApiError(404, "Team not found.");
  });
  return { teams: await loadTeams(db(), tournament.id) };
});
