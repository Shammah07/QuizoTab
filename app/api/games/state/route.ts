import { ApiError, body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { gameById, playerByToken, playerView } from "@/lib/quiz/engine";

// What a player's phone should show right now
export const POST = route(async (request) => {
  const player = await playerByToken(db(), (await body(request)).token);
  if (!player) throw new ApiError(401, "You're no longer in this game. Join again with the PIN.", { status: "kicked" });
  const game = await gameById(db(), player.gameId);
  if (!game) throw new ApiError(404, "Game not found.");
  return playerView(db(), game, player);
});
