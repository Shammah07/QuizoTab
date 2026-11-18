import { ApiError, body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { hostTournament } from "@/lib/tournament/api-helpers";
import { configProblem, normalizeConfig, normalizeJudges, normalizePairings, normalizeRooms } from "@/lib/tournament/rules";
import { deleteTournament, hostView, saveConfig, writeState } from "@/lib/tournament/store";

type Context = RouteContext<"/api/host/tournaments/[id]">;

// Everything the host's dashboard shows for one tournament
export const GET = route<Context>(async (_, { params }) => {
  const { tournament } = await hostTournament(db(), (await params).id);
  return hostView(db(), tournament);
});

// Saves one or more of the tournament's documents: config, pairings, rooms, judges.
// Scores have their own route (each change is merged on the server); sharing has its own too.
export const PATCH = route<Context>(async (request, { params }) => {
  const { tournament } = await hostTournament(db(), (await params).id);
  const data = await body(request);
  if ("config" in data) {
    const config = normalizeConfig(data.config);
    const problem = configProblem(config);
    if (problem) throw new ApiError(400, problem);
    await saveConfig(db(), tournament.id, config);
  }
  if ("pairings" in data) await writeState(db(), tournament.id, "pairings", normalizePairings(data.pairings));
  if ("rooms" in data) await writeState(db(), tournament.id, "rooms", normalizeRooms(data.rooms));
  if ("judges" in data) await writeState(db(), tournament.id, "judges", normalizeJudges(data.judges));
  return hostView(db(), tournament);
});

export const DELETE = route<Context>(async (_, { params }) => {
  const { user, tournament } = await hostTournament(db(), (await params).id);
  await deleteTournament(db(), tournament.id, user.userId);
  return { deleted: true };
});
