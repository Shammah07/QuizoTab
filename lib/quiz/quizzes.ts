import "server-only";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { quizzes, users, type QuizQuestion } from "@/lib/db/schema";
import { categoryLabel, categoryValid, customCategories, isBuiltIn, newCategory } from "./categories";
import { mediaAllowed } from "./media";
import { cleanQuestions } from "./rules";

// A host's own quizzes (list, read, save, delete) and the public ones anyone can browse.
// Moved over from quiz/api.php and quiz_public.php.

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

const questionCount = sql<number>`jsonb_array_length(${quizzes.questions})::int`;

export function listOwnQuizzes(db: Db, ownerId: number) {
  return db
    .select({ id: quizzes.id, title: quizzes.title, category: quizzes.category, is_public: quizzes.isPublic, plays: quizzes.plays, count: questionCount, updated_at: quizzes.updatedAt })
    .from(quizzes)
    .where(eq(quizzes.ownerId, ownerId))
    .orderBy(desc(quizzes.updatedAt));
}

// Null when the quiz doesn't exist or belongs to someone else: the two look the same from outside
export async function ownQuiz(db: Db, id: number, ownerId: number) {
  if (!Number.isInteger(id)) return null;
  const [quiz] = await db.select().from(quizzes).where(and(eq(quizzes.id, id), eq(quizzes.ownerId, ownerId)));
  return quiz ?? null;
}

export type QuizInput = {
  id?: number;
  title?: unknown;
  description?: unknown;
  category?: unknown;
  new_category?: unknown;
  is_public?: unknown;
  questions?: unknown;
};

export async function saveQuiz(db: Db, ownerId: number, input: QuizInput): Promise<Result<{ id: number; category: string | null; categoryLabel: string | null }>> {
  const title = String(input.title ?? "").trim();
  if (title === "" || [...title].length > 120) return fail(400, "Give the quiz a title (up to 120 characters).");

  const cleaned = cleanQuestions(input.questions, mediaAllowed);
  if (cleaned.error !== null) return fail(400, cleaned.error);

  const description = [...String(input.description ?? "").trim()].slice(0, 200).join("") || null;

  let category: string | null = null;
  let label: string | null = null;
  if (String(input.new_category ?? "").trim() !== "") {
    const added = await newCategory(db, input.new_category);
    if ("error" in added) return fail(400, added.error);
    category = added.id;
    label = isBuiltIn(added.id) ? null : added.label;
  } else if (categoryValid(input.category)) {
    category = input.category;
    // A host-added category must already exist (on a public quiz, or on one of this host's own)
    label = isBuiltIn(category) ? null : ((await customCategories(db, ownerId))[category] ?? null);
    if (!isBuiltIn(category) && !label) category = null;
  }

  const isPublic = Boolean(input.is_public);
  if (isPublic && !category) return fail(400, "Choose a category so people can find your quiz.");

  const values = { title, description, category, categoryLabel: label, isPublic, questions: cleaned.questions };
  const saved = { category, categoryLabel: category ? categoryLabel(category, label) : null };

  if (input.id) {
    const [row] = await db
      .update(quizzes)
      .set({ ...values, updatedAt: sql`now()` })
      .where(and(eq(quizzes.id, input.id), eq(quizzes.ownerId, ownerId)))
      .returning({ id: quizzes.id });
    if (!row) return fail(404, "Quiz not found.");
    return { ok: true, value: { id: row.id, ...saved } };
  }

  const [row] = await db.insert(quizzes).values({ ...values, ownerId }).returning({ id: quizzes.id });
  return { ok: true, value: { id: row.id, ...saved } };
}

export async function deleteQuiz(db: Db, id: number, ownerId: number) {
  const rows = await db.delete(quizzes).where(and(eq(quizzes.id, id), eq(quizzes.ownerId, ownerId))).returning({ id: quizzes.id });
  return rows.length === 1;
}

// ---------- Public quizzes ----------

// First name only: public pages never show emails or full names
const firstName = (name: string | null) => (name ? name.trim().split(/\s+/)[0] : "A QuizoTab host");

// Public quizzes for the explore page and the Play menu
export async function exploreQuizzes(db: Db, options: { category?: string; search?: string; sort?: string; limit?: number }) {
  const search = [...(options.search ?? "").trim()].slice(0, 60).join("");
  // % and _ typed by the visitor are searched for as themselves, not treated as wildcards
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const limit = Math.max(1, Math.min(60, Math.trunc(options.limit ?? 48) || 48));

  const rows = await db
    .select({ id: quizzes.id, title: quizzes.title, description: quizzes.description, category: quizzes.category, label: quizzes.categoryLabel, plays: quizzes.plays, count: questionCount, author: users.name })
    .from(quizzes)
    .leftJoin(users, eq(users.id, quizzes.ownerId))
    .where(
      and(
        eq(quizzes.isPublic, true),
        options.category && categoryValid(options.category) ? eq(quizzes.category, options.category) : undefined,
        search !== "" ? or(ilike(quizzes.title, pattern), ilike(quizzes.description, pattern)) : undefined,
      ),
    )
    .orderBy(...(options.sort === "newest" ? [desc(quizzes.createdAt)] : [desc(quizzes.plays), desc(quizzes.createdAt)]))
    .limit(limit);

  return rows.map((q) => ({
    id: q.id,
    title: q.title,
    description: q.description ?? "",
    category: q.category,
    categoryLabel: categoryLabel(q.category, q.label),
    plays: q.plays,
    count: q.count,
    author: firstName(q.author),
  }));
}

export type PublicQuiz = { id: number; title: string; description: string | null; category: string | null; categoryLabel: string | null; plays: number; questions: QuizQuestion[]; author: string };

export async function publicQuiz(db: Db, id: number): Promise<PublicQuiz | null> {
  if (!Number.isInteger(id)) return null;
  const [quiz] = await db
    .select({ id: quizzes.id, title: quizzes.title, description: quizzes.description, category: quizzes.category, categoryLabel: quizzes.categoryLabel, plays: quizzes.plays, questions: quizzes.questions, author: users.name })
    .from(quizzes)
    .leftJoin(users, eq(users.id, quizzes.ownerId))
    .where(and(eq(quizzes.id, id), eq(quizzes.isPublic, true)));
  return quiz ? { ...quiz, author: firstName(quiz.author) } : null;
}
