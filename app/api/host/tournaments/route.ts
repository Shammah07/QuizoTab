import { body, requireUser, route, unwrap } from "@/lib/api";
import { db } from "@/lib/db";
import { hostTournaments } from "@/lib/quiz/tournament-link";
import { createTournament } from "@/lib/tournament/store";

// The host's tournaments and their rounds, for linking a game's scores to a round
export const GET = route(async () => {
  const user = await requireUser();
  return { tournaments: await hostTournaments(db(), user.userId) };
});

// Creates a tournament. Payments are skipped for now: every format is free.
export const POST = route(async (request) => {
  const user = await requireUser("Log in to QuizoTab to host a tournament.");
  return { tournament: unwrap(await createTournament(db(), user.userId, await body(request))) };
});
