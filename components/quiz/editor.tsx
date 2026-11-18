"use client";

import { ArrowDown, ArrowUp, Copy, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { QuizMedia } from "@/lib/db/schema";
import { QUIZ_TIMES } from "@/lib/quiz/rules";
import { api } from "./api";
import { MediaView } from "./media";
import { ANSWER_NAMES, ANSWER_STYLES, Shape } from "./shapes";

// Building and editing one quiz (was the editor half of quiz/builder.js).
// Pictures and videos already on a question are kept and can be removed; adding new ones arrives
// with file uploads (see lib/quiz/media.ts).

type Draft = { text: string; answers: [string, string, string, string]; correct: number; time: number; points: number; media: QuizMedia | null };
type Loaded = { title: string; description: string; category: string; is_public: boolean; questions: Array<Omit<Draft, "answers" | "media"> & { answers: string[]; media?: QuizMedia }>; categories: Record<string, string> };
type Saved = { id: number; category: string | null; categoryLabel: string | null };

const NEW_CATEGORY = "__new";
const POINTS: Array<[number, string]> = [
  [1, "Standard"],
  [2, "Double points"],
  [0, "No points"],
];
const blank = (): Draft => ({ text: "", answers: ["", "", "", ""], correct: 0, time: 20, points: 1, media: null });

const fieldClass = "w-full border border-line bg-white/5 px-3 text-base text-text focus:border-live focus:outline-none";
const iconButton = "grid size-9 cursor-pointer place-items-center text-muted transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";

export function QuizEditor({ quizId: initialId }: { quizId: number | null }) {
  const router = useRouter();
  const [quizId, setQuizId] = useState(initialId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [questions, setQuestions] = useState<Draft[]>([blank()]);
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // What is in the quiz when the page opens
  useEffect(() => {
    (async () => {
      if (initialId) {
        const result = await api<Loaded>(`/api/quizzes/${initialId}`);
        if (!result.ok) return setStatus(result.error);
        setCategories(result.categories);
        setTitle(result.title);
        setDescription(result.description);
        setCategory(result.category || "");
        setIsPublic(result.is_public);
        setQuestions(result.questions.map((q) => ({ ...q, answers: [0, 1, 2, 3].map((i) => q.answers[i] ?? "") as Draft["answers"], media: q.media ?? null })));
      } else {
        const result = await api<{ categories: Record<string, string> }>("/api/quizzes/categories");
        if (result.ok) setCategories(result.categories);
      }
    })();
  }, [initialId]);

  // Leaving with unsaved changes asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const changed = () => {
    setDirty(true);
    setStatus("Unsaved changes");
  };

  function edit(index: number, patch: Partial<Draft>) {
    setQuestions((list) => list.map((q, i) => (i === index ? { ...q, ...patch } : q)));
    changed();
  }

  function editAnswer(index: number, slot: number, text: string) {
    setQuestions((list) => list.map((q, i) => (i === index ? { ...q, answers: q.answers.map((a, s) => (s === slot ? text : a)) as Draft["answers"] } : q)));
    changed();
  }

  function act(index: number, action: "up" | "down" | "copy" | "remove") {
    setQuestions((list) => {
      const next = [...list];
      if (action === "remove" && next.length > 1) next.splice(index, 1);
      if (action === "copy") next.splice(index + 1, 0, structuredClone(next[index]));
      if (action === "up" && index > 0) [next[index - 1], next[index]] = [next[index], next[index - 1]];
      if (action === "down" && index < next.length - 1) [next[index + 1], next[index]] = [next[index], next[index + 1]];
      return next;
    });
    changed();
  }

  function addQuestion() {
    setQuestions((list) => [...list, blank()]);
    changed();
    // Once the new card is on the page, bring it into view and start typing in it
    setTimeout(() => {
      const cards = document.querySelectorAll<HTMLElement>("[data-question]");
      const added = cards[cards.length - 1];
      added?.scrollIntoView({ behavior: "smooth", block: "center" });
      added?.querySelector("textarea")?.focus({ preventScroll: true });
    }, 50);
  }

  async function save() {
    // Empty optional answers are dropped; the right answer moves with its text
    const payload = questions.map((q) => {
      const kept = q.answers.map((text, i) => ({ text: text.trim(), i })).filter((a) => a.text);
      return { text: q.text, answers: kept.map((a) => a.text), correct: kept.findIndex((a) => a.i === q.correct), time: q.time, points: q.points, media: q.media };
    });
    const body = {
      title,
      description,
      category: category === NEW_CATEGORY ? "" : category,
      new_category: category === NEW_CATEGORY ? newCategory : "",
      is_public: isPublic,
      questions: payload,
    };
    setSaving(true);
    setStatus("Saving…");
    const result = quizId ? await api<Saved>(`/api/quizzes/${quizId}`, { method: "PUT", body }) : await api<Saved>("/api/quizzes", { body });
    setSaving(false);
    if (!result.ok) return setStatus(result.error);
    setDirty(false);
    // A new category becomes a normal choice in the list
    if (result.category) {
      if (result.categoryLabel && !categories[result.category]) setCategories({ ...categories, [result.category]: result.categoryLabel });
      setCategory(result.category);
    }
    setNewCategory("");
    if (!quizId) {
      setQuizId(result.id);
      router.replace(`/quiz/${result.id}/edit`);
    }
    setStatus(isPublic ? "Saved. Anyone can now play it from Play on QuizoTab." : "Saved. Host it from All quizzes.");
  }

  const entries = Object.entries(categories);
  const builtIn = entries.filter(([id]) => !id.startsWith("c-"));
  const added = entries.filter(([id]) => id.startsWith("c-"));

  return (
    <div className="pb-24">
      <label htmlFor="quizTitle" className="text-sm font-medium text-muted">
        Quiz title
      </label>
      <input
        id="quizTitle"
        value={title}
        maxLength={120}
        placeholder="e.g. East African Geography"
        onChange={(e) => {
          setTitle(e.target.value);
          changed();
        }}
        className="wide mt-2 w-full border-b-2 border-line bg-transparent py-2 font-display text-[clamp(26px,4vw,40px)] font-extrabold text-white placeholder:font-normal placeholder:text-muted/60 focus:border-live focus:outline-none"
      />

      <div className="mt-8 grid gap-5 border border-line bg-panel p-5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">
            Short description <span className="text-muted">(optional)</span>
          </span>
          <input
            value={description}
            maxLength={200}
            placeholder="What is this quiz about?"
            onChange={(e) => {
              setDescription(e.target.value);
              changed();
            }}
            className={cn(fieldClass, "h-12")}
          />
        </label>
        <div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Category</span>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                changed();
              }}
              className={cn(fieldClass, "h-12")}
            >
              <option value="">Choose a category</option>
              {builtIn.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
              {added.length > 0 && (
                <optgroup label="Added by hosts">
                  {added.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value={NEW_CATEGORY}>+ Add a new category</option>
            </select>
          </label>
          {category === NEW_CATEGORY && (
            <input
              autoFocus
              value={newCategory}
              maxLength={30}
              placeholder="Name your category, e.g. Swahili proverbs"
              aria-label="New category name"
              onChange={(e) => {
                setNewCategory(e.target.value);
                changed();
              }}
              className={cn(fieldClass, "mt-2 h-12")}
            />
          )}
        </div>
        <label className="flex cursor-pointer items-start gap-3 sm:col-span-2">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => {
              setIsPublic(e.target.checked);
              changed();
            }}
            className="mt-1 size-4 accent-live"
          />
          <span className="text-sm text-muted">
            <strong className="block text-white">Let anyone play this quiz</strong>
            It appears under Play on QuizoTab. Anyone can play it on their own, and it runs by itself with a timer and a leaderboard. You can still host it live.
          </span>
        </label>
      </div>

      <div className="mt-8 flex flex-col gap-6">
        {questions.map((q, i) => (
          <section key={i} data-question className="border border-line bg-panel">
            <div className="flex items-center gap-1 border-b border-line px-4 py-2">
              <strong className="mr-auto font-semibold text-white">Question {i + 1}</strong>
              <button type="button" className={iconButton} onClick={() => act(i, "up")} disabled={i === 0} aria-label={`Move question ${i + 1} up`}>
                <ArrowUp className="size-4" aria-hidden="true" />
              </button>
              <button type="button" className={iconButton} onClick={() => act(i, "down")} disabled={i === questions.length - 1} aria-label={`Move question ${i + 1} down`}>
                <ArrowDown className="size-4" aria-hidden="true" />
              </button>
              <button type="button" className={iconButton} onClick={() => act(i, "copy")} aria-label={`Duplicate question ${i + 1}`}>
                <Copy className="size-4" aria-hidden="true" />
              </button>
              <button type="button" className={iconButton} onClick={() => act(i, "remove")} disabled={questions.length === 1} aria-label={`Delete question ${i + 1}`}>
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-4">
              <textarea
                value={q.text}
                maxLength={300}
                rows={2}
                placeholder="Type the question"
                aria-label={`Question ${i + 1}`}
                onChange={(e) => edit(i, { text: e.target.value })}
                className={cn(fieldClass, "min-h-[72px] resize-y py-3 text-lg font-medium")}
              />

              {q.media && (
                <div className="mt-4">
                  <MediaView media={q.media} className="max-w-sm" />
                  <Button variant="line" size="sm" className="mt-2" onClick={() => edit(i, { media: null })}>
                    Remove {q.media.type === "video" ? "video" : "picture"}
                  </Button>
                </div>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {q.answers.map((text, a) => (
                  <label key={a} className={cn("flex items-center gap-3 px-3 py-2", ANSWER_STYLES[a])}>
                    <Shape index={a} />
                    <input
                      type="text"
                      value={text}
                      maxLength={90}
                      placeholder={`Answer ${a + 1}${a > 1 ? " (optional)" : ""}`}
                      aria-label={`${ANSWER_NAMES[a]} answer`}
                      onChange={(e) => editAnswer(i, a, e.target.value)}
                      className="h-10 min-w-0 flex-1 bg-white/15 px-3 text-[15px] font-medium text-inherit placeholder:text-current/60 focus:bg-white/25 focus:outline-none"
                    />
                    <input type="radio" name={`correct-${i}`} value={a} checked={q.correct === a} onChange={() => edit(i, { correct: a })} aria-label={`Mark ${ANSWER_NAMES[a]} as the right answer`} title="Right answer" className="size-5 accent-white" />
                  </label>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                <label className="flex items-center gap-2">
                  Time
                  <select value={q.time} onChange={(e) => edit(i, { time: Number(e.target.value) })} className={cn(fieldClass, "h-9 w-auto")}>
                    {QUIZ_TIMES.map((t) => (
                      <option key={t} value={t}>
                        {t} seconds
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  Points
                  <select value={q.points} onChange={(e) => edit(i, { points: Number(e.target.value) })} className={cn(fieldClass, "h-9 w-auto")}>
                    {POINTS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="text-muted">Tick the circle next to the right answer.</span>
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* The bar along the bottom: status, add a question, save */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-studio/95 px-(--edge) backdrop-blur">
        <div className="mx-auto flex max-w-[920px] flex-wrap items-center gap-3 py-3">
          <span role="status" className="mr-auto text-sm text-muted">
            {status}
          </span>
          <Button variant="line" size="sm" className="h-11 px-5" onClick={addQuestion}>
            Add question
          </Button>
          <Button size="sm" className="h-11 px-6" onClick={save} disabled={saving}>
            Save quiz
          </Button>
        </div>
      </div>
    </div>
  );
}
