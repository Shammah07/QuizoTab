import "server-only";
import { and, eq, isNotNull, like, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { quizzes } from "@/lib/db/schema";

// Quiz categories: a built-in list, plus ones hosts add themselves
// ("c-" + slug in quizzes.category, the name they typed in category_label). Was part of quiz_public.php.

export const QUIZ_CATEGORIES: Record<string, string> = {
  general: "General knowledge",
  science: "Science and nature",
  geography: "Geography",
  history: "History",
  eastafrica: "East Africa",
  sports: "Sports",
  entertainment: "Music and movies",
  faith: "Bible and faith",
  business: "Business and money",
  technology: "Technology",
  languages: "Languages",
  kids: "Kids and school",
};

export const isBuiltIn = (id: string) => Object.hasOwn(QUIZ_CATEGORIES, id);

export function categoryValid(id: unknown): id is string {
  return typeof id === "string" && (isBuiltIn(id) || /^c-[a-z0-9-]{1,28}$/.test(id));
}

export function categoryLabel(id: string | null, label?: string | null) {
  return (id && QUIZ_CATEGORIES[id]) || label || "Other";
}

// Turns a typed name into an id and label. A name that matches a built-in category, or one another
// host already added, reuses it, so "history" or "Bible Quiz" doesn't appear twice.
export async function newCategory(db: Db, name: unknown): Promise<{ id: string; label: string } | { error: string }> {
  const label = String(name ?? "").trim().replace(/\s+/gu, " ");
  const length = [...label].length;
  if (length < 3 || length > 30) return { error: "Keep the new category between 3 and 30 characters." };
  if (!/^[\p{L}\p{N} &'-]+$/u.test(label)) return { error: "Use only letters, numbers, spaces, & and - in the category name." };

  const key = label.toLowerCase();
  for (const [id, builtIn] of Object.entries(QUIZ_CATEGORIES)) {
    if (key === id || key === builtIn.toLowerCase()) return { id, label: builtIn };
  }

  // Accents are dropped (é -> e) so the id is plain letters, numbers and dashes
  const slug = label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
    .replace(/-+$/, "");
  if (slug === "") return { error: "Use some plain letters or numbers in the category name." };

  const id = `c-${slug}`;
  const [existing] = await db.select({ label: quizzes.categoryLabel }).from(quizzes).where(and(eq(quizzes.category, id), isNotNull(quizzes.categoryLabel))).limit(1);
  return { id, label: existing?.label ?? label };
}

// Categories hosts added: those on public quizzes, plus this host's own. Returned as id -> name.
export async function customCategories(db: Db, ownerId?: number) {
  const rows = await db
    .select({ category: quizzes.category, label: sql<string>`min(${quizzes.categoryLabel})` })
    .from(quizzes)
    .where(and(like(quizzes.category, "c-%"), isNotNull(quizzes.categoryLabel), ownerId === undefined ? eq(quizzes.isPublic, true) : or(eq(quizzes.isPublic, true), eq(quizzes.ownerId, ownerId))))
    .groupBy(quizzes.category)
    .orderBy(sql`min(${quizzes.categoryLabel})`);
  return Object.fromEntries(rows.map((row) => [row.category!, row.label]));
}

// Built-in categories first, then the ones hosts added
export async function allCategories(db: Db, ownerId?: number) {
  return { ...QUIZ_CATEGORIES, ...(await customCategories(db, ownerId)) };
}

// Every category with how many public quizzes it has, for the explore page's filter chips
export async function categoryCounts(db: Db) {
  const rows = await db.select({ category: quizzes.category, n: sql<number>`count(*)::int` }).from(quizzes).where(eq(quizzes.isPublic, true)).groupBy(quizzes.category);
  const counts = new Map(rows.map((row) => [row.category, row.n]));

  const builtIn = Object.entries(QUIZ_CATEGORIES).map(([id, label]) => ({ id, label, count: counts.get(id) ?? 0 }));
  // Categories hosts added show up once a public quiz uses them, busiest first
  const added = Object.entries(await customCategories(db))
    .map(([id, label]) => ({ id, label, count: counts.get(id) ?? 0 }))
    .filter((category) => category.count > 0)
    .sort((a, b) => b.count - a.count);
  return [...builtIn, ...added];
}
