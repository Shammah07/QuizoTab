import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { categoryCounts } from "@/lib/quiz/categories";
import { exploreQuizzes } from "@/lib/quiz/quizzes";

// Public quizzes anyone can browse: /api/quizzes/explore?category=&search=&sort=popular|newest&limit=
export const GET = route(async (request) => {
  const query = request.nextUrl.searchParams;
  return {
    quizzes: await exploreQuizzes(db(), {
      category: query.get("category") ?? "",
      search: query.get("search") ?? "",
      sort: query.get("sort") ?? "popular",
      limit: Number(query.get("limit") ?? 48),
    }),
    categories: await categoryCounts(db()),
  };
});
