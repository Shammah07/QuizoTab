import { guardSeedInputs } from "@/lib/tournament/adjudication";
import { teams } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { looksLikeId } from "@/lib/tournament/store";
import { ApiError, body, route, unwrap } from "@/lib/api";
import { withRoomOwner } from "@/lib/tournament/room-access";
import { db, transactionDb } from "@/lib/db";
import { hostTournament } from "@/lib/tournament/api-helpers";
import { addTeam, deleteTeam, loadTeams, updateTeam } from "@/lib/tournament/store";

type Context = RouteContext<"/api/host/tournaments/[id]/teams">;

// The host adds a team (judges register theirs through /api/tournaments/[id]/judge)
export const POST = route<Context>(async (request, { params }) => {
  const { user, tournament } = await hostTournament(db(), (await params).id);
  const input = await body(request);
  await withRoomOwner(transactionDb(), tournament.id, user, async tx => {
    await guardSeedInputs(tx,tournament.id);
    unwrap(await addTeam(tx,tournament.id,input,user.name));
  });
  return { teams: await loadTeams(db(), tournament.id) };
});

export const PUT = route<Context>(async (request, { params }) => {
  const { user, tournament } = await hostTournament(db(), (await params).id);
  const data = await body(request);
  await withRoomOwner(transactionDb(),tournament.id,user,async tx => {
    if (!looksLikeId(data.id)) throw new ApiError(404,"Team not found.");
    const [current] = await tx.select({name:teams.name}).from(teams).where(and(eq(teams.tournamentId,tournament.id),eq(teams.id,data.id)));
    if (current && current.name !== String(data.name ?? "").trim()) await guardSeedInputs(tx,tournament.id);
    unwrap(await updateTeam(tx,tournament.id,data.id,data));
  });
  return { teams: await loadTeams(db(), tournament.id) };
});

export const DELETE = route<Context>(async (request, { params }) => {
  const { tournament, user } = await hostTournament(db(), (await params).id);
  const teamId = (await body(request)).id;
  await withRoomOwner(transactionDb(), tournament.id, user, async tx => {
    await guardSeedInputs(tx,tournament.id);
    if (!await deleteTeam(tx, tournament.id, teamId)) throw new ApiError(404, "Team not found.");
  });
  return { teams: await loadTeams(db(), tournament.id) };
});
