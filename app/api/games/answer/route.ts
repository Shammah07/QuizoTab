import { ApiError, body, int, route, unwrap } from "@/lib/api";
import { db } from "@/lib/db";
import { answer, gameById, playerByToken, playerView } from "@/lib/quiz/engine";

// A player taps an answer. The server decides whether it was in time and what it scored.
export const POST = route(async (request) => {
  const input = await body(request);
  const player = await playerByToken(db(), input.token);
  if (!player) throw new ApiError(401, "You're no longer in this game. Join again with the PIN.", { status: "kicked" });
  const game = await gameById(db(), player.gameId);
  if (!game) throw new ApiError(404, "Game not found.");

  unwrap(await answer(db(), game, player, int(input.index), int(input.choice)), 409);
  return playerView(db(), game, player);
});
