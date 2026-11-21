import { ApiError, body, requireUser, route } from "@/lib/api";
import { db, transactionDb } from "@/lib/db";
import { withRoomOwner } from "@/lib/tournament/room-access";
import { saveRoomPairings } from "@/lib/tournament/room-management";
import { saveScoringPlan } from "@/lib/tournament/scoring-plan";
import { hostTournament } from "@/lib/tournament/api-helpers";
import { configProblem, normalizeConfig, normalizeJudges } from "@/lib/tournament/rules";
import { deleteTournament, hostView, saveConfig, writeState } from "@/lib/tournament/store";

type Context = RouteContext<"/api/host/tournaments/[id]">;

// Everything the host's dashboard shows for one tournament
export const GET = route<Context>(async (_, { params }) => {
  const { tournament } = await hostTournament(db(), (await params).id);
  return hostView(db(), tournament);
});

// Room edits have their own versioned command endpoint.
// Scores have their own route (each change is merged on the server); sharing has its own too.
export const PATCH = route<Context>(async (request, { params }) => {
  const { user, tournament } = await hostTournament(db(), (await params).id);
  const data = await body(request);
  if ("rooms" in data) throw new ApiError(409, "Refresh the dashboard and use the room editor.");
  await withRoomOwner(transactionDb(), tournament.id, user, async tx => {
    if ("config" in data) {
      const config = normalizeConfig(data.config);
      const problem = configProblem(config);
      if (problem) throw new ApiError(400, problem);
      await saveConfig(tx, tournament.id, config);
    }
    if ("pairings" in data) await saveRoomPairings(tx, tournament.id, data.pairings, data.expectedPairings);
    if ("scoringPlan" in data) await saveScoringPlan(tx, tournament.id, data.scoringPlan);
    if ("judges" in data) await writeState(tx, tournament.id, "judges", normalizeJudges(data.judges));
  });
  return hostView(db(), tournament);
});

export const DELETE = route<Context>(async (_, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  await withRoomOwner(transactionDb(), id, user, tx => deleteTournament(tx, id, user.userId));
  return { deleted: true };
});
