import { ApiError, body, route, unwrap } from "@/lib/api";
import { db } from "@/lib/db";
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
  const { tournament } = await hostTournament(db(), (await params).id);
  if (!(await deleteTeam(db(), tournament.id, (await body(request)).id))) throw new ApiError(404, "Team not found.");
  return { teams: await loadTeams(db(), tournament.id) };
});
