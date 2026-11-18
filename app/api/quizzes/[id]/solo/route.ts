import { ApiError, body, int, route, unwrap } from "@/lib/api";
import { db } from "@/lib/db";
import { categoryLabel } from "@/lib/quiz/categories";
import { publicQuiz } from "@/lib/quiz/quizzes";
import { soloBoard, soloStart } from "@/lib/quiz/solo";
import { recordAttempt, tooManyAttempts, visitorIp } from "@/lib/rate-limit";

type Context = RouteContext<"/api/quizzes/[id]/solo">;

async function quizFor(context: Context) {
  const quiz = await publicQuiz(db(), int((await context.params).id));
  if (!quiz) throw new ApiError(404, "This quiz isn't available. The host may have made it private.");
  return quiz;
}

// What a public quiz is about and its best scores, shown before playing
export const GET = route<Context>(async (_, context) => {
  const quiz = await quizFor(context);
  return {
    title: quiz.title,
    description: quiz.description ?? "",
    categoryLabel: categoryLabel(quiz.category, quiz.categoryLabel),
    count: quiz.questions.length,
    plays: quiz.plays,
    author: quiz.author,
    board: await soloBoard(db(), quiz.id),
  };
});

// Starts playing the quiz alone
export const POST = route<Context>(async (request, context) => {
  // At most 40 new games per visitor every 10 minutes
  const key = `solo:${await visitorIp()}`;
  if (await tooManyAttempts(db(), key, 40, 600)) throw new ApiError(429, "You've started a lot of games. Wait a few minutes and try again.");

  const quiz = await quizFor(context);
  const started = unwrap(await soloStart(db(), quiz, (await body(request)).nickname));
  await recordAttempt(db(), key);
  return started;
});
