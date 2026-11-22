import { body, route, unwrap } from "@/lib/api";
import { db, transactionDb } from "@/lib/db";
import { hostTournament } from "@/lib/tournament/api-helpers";
import { applyScoreOp } from "@/lib/tournament/store";

// One change to the scores: enter a team's points, approve a round, approve or delete one score.
// The host's own entries count straight away.
export const POST = route<RouteContext<"/api/host/tournaments/[id]/scores">>(async (request, { params }) => {
  const { user, tournament } = await hostTournament(db(), (await params).id);
  return { scores: unwrap(await applyScoreOp(transactionDb(), tournament.id, await body(request), { name: user.name, isHost: true })) };
});
