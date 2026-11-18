import { z } from "zod";
import type { QuizMedia, QuizQuestion } from "@/lib/db/schema";

// The live quiz rules, moved over from quiz_engine.php. No database here: just the numbers and checks,
// so the builder in the browser and the server agree on what a valid quiz is.

export const QUIZ_LEAD_MS = 3000; // "Get ready" time before answers open
export const QUIZ_GRACE_MS = 600; // allowance for a slow network after the clock hits zero
export const QUIZ_MAX_PLAYERS = 300;
export const QUIZ_MAX_QUESTIONS = 100;
export const QUIZ_TIMES = [5, 10, 20, 30, 45, 60, 90, 120] as const;
export const QUIZ_POINT_CHOICES = [0, 1, 2] as const;

export function pointsMax(question: Pick<QuizQuestion, "points">) {
  return 1000 * question.points;
}

// Kahoot-style: a right answer earns between half and all of its points, more the faster it comes
export function pointsFor(question: Pick<QuizQuestion, "points" | "time">, elapsedMs: number) {
  const limit = Math.max(1, question.time) * 1000;
  const ratio = Math.min(1, Math.max(0, elapsedMs / limit));
  return Math.round(pointsMax(question) * (1 - ratio / 2));
}

// A quiz result scaled to a tournament round's points range
export function scaleToRound(score: number, possible: number, minPoints: number, maxPoints: number) {
  return Math.round(minPoints + Math.min(1, score / (possible || 1)) * (maxPoints - minPoints));
}

const mediaSchema = z.object({
  type: z.enum(["image", "video"]),
  src: z.string().min(1).max(500),
});

// Checks and tidies a quiz from the editor. Returns the cleaned questions, or the first problem
// worded for the host ("Question 3 needs 2 to 4 answers.").
// `allowMedia` decides whether a picture or video is one QuizoTab stored itself (see media.ts).
export function cleanQuestions(
  input: unknown,
  allowMedia: (media: QuizMedia) => QuizMedia | null = (media) => media,
): { questions: QuizQuestion[]; error: null } | { questions: null; error: string } {
  const fail = (error: string) => ({ questions: null, error });

  if (!Array.isArray(input) || input.length === 0) return fail("Add at least one question.");
  if (input.length > QUIZ_MAX_QUESTIONS) return fail(`A quiz can have up to ${QUIZ_MAX_QUESTIONS} questions.`);

  const questions: QuizQuestion[] = [];
  for (const [i, raw] of input.entries()) {
    const n = i + 1;
    const q = (raw ?? {}) as Record<string, unknown>;

    const text = String(q.text ?? "").trim();
    const answers = (Array.isArray(q.answers) ? q.answers : []).map((a) => String(a ?? "").trim()).filter((a) => a !== "");
    const correct = Number.isInteger(q.correct) ? (q.correct as number) : -1;

    if (text === "") return fail(`Question ${n} needs its question text.`);
    if ([...text].length > 300) return fail(`Question ${n} is too long (300 characters at most).`);
    if (answers.length < 2 || answers.length > 4) return fail(`Question ${n} needs 2 to 4 answers.`);
    if (answers.some((a) => [...a].length > 90)) return fail(`An answer in question ${n} is too long (90 characters at most).`);
    if (correct < 0 || correct >= answers.length) return fail(`Mark the right answer for question ${n}.`);

    const time = QUIZ_TIMES.find((t) => t === q.time) ?? 20;
    const points = QUIZ_POINT_CHOICES.find((p) => p === q.points) ?? 1;
    const question: QuizQuestion = { text, answers, correct, time, points };

    if (q.media) {
      const parsed = mediaSchema.safeParse(q.media);
      const media = parsed.success ? allowMedia(parsed.data) : null;
      if (!media) return fail(`The picture or video on question ${n} is missing. Add it again.`);
      question.media = media;
    }
    questions.push(question);
  }
  return { questions, error: null };
}
