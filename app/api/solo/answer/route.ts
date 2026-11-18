import { ApiError, body, int, route, unwrap } from "@/lib/api";
import { db } from "@/lib/db";
import { publicQuiz } from "@/lib/quiz/quizzes";
import { soloAnswer, soloRunByToken } from "@/lib/quiz/solo";

// Scores one answer of a solo game and hands back the next question (choice -1 = time ran out)
export const POST = route(async (request) => {
  const input = await body(request);
  const run = await soloRunByToken(db(), input.token);
  if (!run) throw new ApiError(401, "This game has expired. Start again.");
  const quiz = await publicQuiz(db(), run.quizId);
  if (!quiz) throw new ApiError(404, "This quiz isn't available any more.");
  return unwrap(await soloAnswer(db(), run, quiz, int(input.index), int(input.choice)), 409);
});
