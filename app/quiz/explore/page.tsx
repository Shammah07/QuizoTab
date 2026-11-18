import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { QuizFrame } from "@/components/quiz/frame";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { categoryCounts, categoryValid } from "@/lib/quiz/categories";
import { exploreQuizzes } from "@/lib/quiz/quizzes";

export const metadata: Metadata = { title: "Play a quiz" };

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

// Public quizzes anyone can play on their own: browse by category, search, sort (was quiz/explore.php).
// Everything is in the address, so a filtered list can be shared and the page needs no script.
export default async function ExplorePage({ searchParams }: PageProps<"/quiz/explore">) {
  const params = await searchParams;
  const category = typeof params.category === "string" && categoryValid(params.category) ? params.category : "";
  const sort = params.sort === "newest" ? "newest" : "popular";
  const search = typeof params.q === "string" ? [...params.q.trim()].slice(0, 60).join("") : "";

  const [quizzes, categories] = await Promise.all([exploreQuizzes(db(), { category, search, sort }), categoryCounts(db())]);
  const label = categories.find((c) => c.id === category)?.label;
  const heading = label ? `${label} quizzes` : "Play a quiz";

  const href = (changes: { category?: string; sort?: string; q?: string }) => {
    const next = { category, sort, q: search, ...changes };
    const query = new URLSearchParams();
    if (next.category) query.set("category", next.category);
    if (next.sort !== "popular") query.set("sort", next.sort);
    if (next.q) query.set("q", next.q);
    const text = query.toString();
    return `/quiz/explore${text ? `?${text}` : ""}`;
  };

  const chip = (active: boolean) => cn("border px-3 py-1.5 text-sm font-medium transition-colors", active ? "border-live bg-live text-white" : "border-line text-muted hover:border-text hover:text-white");

  return (
    <QuizFrame
      width="max-w-page"
      links={[
        { href: "/play", label: "Join with a PIN" },
        { href: "/quiz", label: "Create your own quiz" },
        { href: "/", label: "Back to QuizoTab" },
      ]}
    >
      <h1 className="text-[clamp(34px,5vw,52px)] leading-[1.05] font-extrabold text-white">{heading}</h1>
      <p className="mt-4 mb-8 max-w-[62ch] text-[17px] leading-relaxed text-muted">
        Pick a quiz and play it now on your own. Every question has a timer, faster right answers score more, and your best score goes on the quiz&apos;s leaderboard. Free, no account needed.
      </p>

      <form role="search" className="flex flex-wrap items-center gap-3">
        {category && <input type="hidden" name="category" value={category} />}
        {sort !== "popular" && <input type="hidden" name="sort" value={sort} />}
        <label className="relative min-w-[240px] flex-1">
          <span className="sr-only">Search quizzes</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input type="search" name="q" defaultValue={search} placeholder="Search quizzes" maxLength={60} className="h-11 w-full border border-line bg-white/5 pr-3 pl-9 text-base text-text focus:border-live focus:outline-none" />
        </label>
        <div role="group" aria-label="Sort" className="flex">
          <Link href={href({ sort: "popular" })} aria-current={sort === "popular" ? "true" : undefined} className={chip(sort === "popular")}>
            Most played
          </Link>
          <Link href={href({ sort: "newest" })} aria-current={sort === "newest" ? "true" : undefined} className={cn(chip(sort === "newest"), "-ml-px")}>
            Newest
          </Link>
        </div>
      </form>

      <div role="group" aria-label="Categories" className="mt-5 flex flex-wrap gap-2">
        <Link href={href({ category: "" })} aria-current={!category ? "true" : undefined} className={chip(!category)}>
          All
        </Link>
        {categories.map((c) => (
          <Link key={c.id} href={href({ category: c.id })} aria-current={category === c.id ? "true" : undefined} className={chip(category === c.id)}>
            {c.label} <span className="ml-1 opacity-70">{c.count}</span>
          </Link>
        ))}
      </div>

      {quizzes.length === 0 ? (
        <div className="mt-10 border border-line bg-panel px-6 py-10 text-center text-muted">
          <p>
            {search ? `No quizzes match "${search}".` : "No quizzes here yet."} Build one and tick <strong className="text-white">Let anyone play this quiz</strong> to be the first.
          </p>
          <ButtonLink href="/quiz/new" size="sm" className="mt-5">
            Create a quiz
          </ButtonLink>
        </div>
      ) : (
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {quizzes.map((q) => (
            <li key={q.id} className="flex flex-col border border-line bg-panel p-5">
              <p className="text-sm font-medium text-live">{q.categoryLabel}</p>
              <h2 className="mt-1 text-xl leading-tight font-extrabold text-white">{q.title}</h2>
              {q.description && <p className="mt-2 text-sm leading-relaxed text-muted">{q.description}</p>}
              <p className="mt-3 mb-5 text-sm text-muted">
                {plural(q.count, "question")}, played {plural(q.plays, "time")}. By {q.author}
              </p>
              <ButtonLink href={`/play/solo/${q.id}`} size="sm" className="mt-auto self-start">
                Play now
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}
    </QuizFrame>
  );
}
