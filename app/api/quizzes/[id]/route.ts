import { ApiError, body, int, requireUser, route, unwrap } from "@/lib/api";
import { db } from "@/lib/db";
import { allCategories } from "@/lib/quiz/categories";
import { deleteQuiz, ownQuiz, saveQuiz } from "@/lib/quiz/quizzes";

type Context = RouteContext<"/api/quizzes/[id]">;

// One of the host's quizzes with its questions, for the editor
export const GET = route<Context>(async (_, { params }) => {
  const user = await requireUser();
  const quiz = await ownQuiz(db(), int((await params).id), user.userId);
  if (!quiz) throw new ApiError(404, "Quiz not found.");
  return {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description ?? "",
    category: quiz.category ?? "",
    is_public: quiz.isPublic,
    questions: quiz.questions,
    categories: await allCategories(db(), user.userId),
  };
});

// Saves changes to a quiz
export const PUT = route<Context>(async (request, { params }) => {
  const user = await requireUser();
  const id = int((await params).id);
  if (Number.isNaN(id)) throw new ApiError(404, "Quiz not found.");
  return unwrap(await saveQuiz(db(), user.userId, { ...(await body(request)), id }));
});

export const DELETE = route<Context>(async (_, { params }) => {
  const user = await requireUser();
  const id = int((await params).id);
  if (Number.isNaN(id) || !(await deleteQuiz(db(), id, user.userId))) throw new ApiError(404, "Quiz not found.");
  return { ok: true };
});
