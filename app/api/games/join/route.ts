import { body, route, unwrap } from "@/lib/api";
import { db } from "@/lib/db";
import { gameForPin } from "@/lib/quiz/api-helpers";
import { join } from "@/lib/quiz/engine";

// Joins a game. No account needed: the phone keeps the returned token as its place in the game.
export const POST = route(async (request) => {
  const input = await body(request);
  const game = await gameForPin(db(), input.pin);
  return { token: unwrap(await join(db(), game, input.nickname, input.team_id)) };
});
