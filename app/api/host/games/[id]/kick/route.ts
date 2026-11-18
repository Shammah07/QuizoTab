import { body, int, requireUser, route } from "@/lib/api";
import { db } from "@/lib/db";
import { ownGame } from "@/lib/quiz/api-helpers";
import { hostView, kick } from "@/lib/quiz/engine";

// Removes a player from the game: { player_id }
export const POST = route<RouteContext<"/api/host/games/[id]/kick">>(async (request, { params }) => {
  const user = await requireUser();
  const game = await ownGame(db(), (await params).id, user.userId);
  const playerId = int((await body(request)).player_id);
  return hostView(db(), Number.isNaN(playerId) ? game : await kick(db(), game, playerId));
});
