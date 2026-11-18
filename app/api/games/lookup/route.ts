import { body, route } from "@/lib/api";
import { db } from "@/lib/db";
import { gameForPin } from "@/lib/quiz/api-helpers";

// A player typed a PIN: is there a game, and does it use teams?
export const POST = route(async (request) => {
  const game = await gameForPin(db(), (await body(request)).pin);
  return { title: game.title, teams: game.teams, started: game.status !== "lobby" };
});
