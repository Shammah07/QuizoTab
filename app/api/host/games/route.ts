import { ApiError, body, int, requireUser, route, unwrap } from "@/lib/api";
import { db } from "@/lib/db";
import { launch } from "@/lib/quiz/engine";
import { ownQuiz } from "@/lib/quiz/quizzes";
import { hostTournaments, tournamentTeams } from "@/lib/quiz/tournament-link";

// Starts a game from one of the host's quizzes and gives it a PIN.
// With tournament_id and round_id, the tournament's teams play and the scores can be sent to that round.
export const POST = route(async (request) => {
  const user = await requireUser();
  const input = await body(request);
  const quiz = await ownQuiz(db(), int(input.quiz_id), user.userId);
  if (!quiz) throw new ApiError(404, "Quiz not found.");

  let link = null;
  if (input.tournament_id) {
    const tournament = (await hostTournaments(db(), user.userId)).find((t) => t.id === input.tournament_id);
    if (!tournament) throw new ApiError(404, "Tournament not found.");
    const round = tournament.rounds.find((r) => r.id === input.round_id);
    if (!round) throw new ApiError(400, "Choose the round these scores belong to.");
    const teams = await tournamentTeams(db(), tournament.id);
    if (teams.length === 0) throw new ApiError(400, "Register the tournament's teams first: each team joins the game as one player.");
    link = { tournamentId: tournament.id, roundId: round.id, label: [...`${tournament.name}, ${round.label}`].slice(0, 200).join(""), teams };
  }

  return { game_id: unwrap(await launch(db(), quiz, user.userId, link), 503) };
});
