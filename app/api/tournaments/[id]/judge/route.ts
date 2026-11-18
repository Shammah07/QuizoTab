import { ApiError, body, route, unwrap } from "@/lib/api";
import { db } from "@/lib/db";
import { judgedTournament } from "@/lib/tournament/api-helpers";
import { addTeam, applyScoreOp, judgeView } from "@/lib/tournament/store";

type Context = RouteContext<"/api/tournaments/[id]/judge">;

// The judge's view of a tournament: rules, teams, scores and the draw
export const GET = route<Context>(async (_, { params }) => {
  const { tournament } = await judgedTournament(db(), (await params).id);
  return judgeView(db(), tournament);
});

// A judge registers a team ({ action: "register", name, category, members }) or enters a score
// ({ action: "score", teamId, roundId, points }). A judge's scores wait for the host's approval.
export const POST = route<Context>(async (request, { params }) => {
  const { user, tournament, isHost } = await judgedTournament(db(), (await params).id);
  const data = await body(request);
  if (data.action === "register") unwrap(await addTeam(db(), tournament.id, data, user.name));
  else if (data.action === "score") unwrap(await applyScoreOp(db(), tournament.id, { ...data, op: "enter" }, { name: user.name, isHost }));
  else throw new ApiError(400, "Unknown action.");
  return judgeView(db(), tournament);
});
