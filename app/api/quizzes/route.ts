import { body, requireUser, route, unwrap } from "@/lib/api";
import { db } from "@/lib/db";
import { listOwnQuizzes, saveQuiz } from "@/lib/quiz/quizzes";

// The logged-in host's quizzes
export const GET = route(async () => {
  const user = await requireUser();
  return { quizzes: await listOwnQuizzes(db(), user.userId) };
});

// Creates a quiz
export const POST = route(async (request) => {
  const user = await requireUser();
  const input = await body(request);
  return unwrap(await saveQuiz(db(), user.userId, { ...input, id: undefined }));
});
