import { requireUser, route } from "@/lib/api";
import { db } from "@/lib/db";
import { allCategories } from "@/lib/quiz/categories";

// Categories the host can file a quiz under: the built-in ones, public ones others added, and their own
export const GET = route(async () => {
  const user = await requireUser();
  return { categories: await allCategories(db(), user.userId) };
});
