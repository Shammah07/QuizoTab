import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { hashToken, looksLikePlayerToken, newToken } from "@/lib/auth/tokens";
import type { Db } from "@/lib/db";
import { quizSoloRuns, quizzes } from "@/lib/db/schema";
import type { PublicQuiz } from "./quizzes";
import { pointsFor, QUIZ_GRACE_MS } from "./rules";

// Solo play: anyone can play a public quiz on their own. It runs by itself (no host needed),
// the server keeps the clock and the score, and each quiz keeps a leaderboard of its best runs.
// Moved over from quiz_public.php.

export const SOLO_LEAD_MS = 2500; // "Get ready" before each question's answers open
export const SOLO_RESULT_MS = 3200; // how long the phone shows "Correct!" and the new total before the next "Get ready"

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });
const fromNow = (ms: number) => sql`clock_timestamp() + ${ms}::int * interval '1 millisecond'`;

// The best finished runs of a quiz
export async function soloBoard(db: Db, quizId: number, limit = 10) {
  const rows = await db
    .select({ id: quizSoloRuns.id, nickname: quizSoloRuns.nickname, score: quizSoloRuns.score, correct: quizSoloRuns.correctCount })
    .from(quizSoloRuns)
    .where(and(eq(quizSoloRuns.quizId, quizId), isNotNull(quizSoloRuns.finishedAt)))
    .orderBy(desc(quizSoloRuns.score), asc(quizSoloRuns.id))
    .limit(limit);
  return rows.map((row, i) => ({ rank: i + 1, id: row.id, name: row.nickname, score: row.score, correct: row.correct }));
}

// One question as the player may see it: never the right answer.
// `lead` is how many milliseconds from now its answers open.
function soloQuestion(quiz: PublicQuiz, index: number, lead = SOLO_LEAD_MS) {
  const q = quiz.questions[index];
  return { index, total: quiz.questions.length, text: q.text, answers: q.answers, time: q.time, points: q.points, media: q.media ?? null, opens_in_ms: lead };
}

export async function soloRunByToken(db: Db, token: unknown) {
  if (!looksLikePlayerToken(token)) return null;
  const [run] = await db
    .select({
      id: quizSoloRuns.id,
      quizId: quizSoloRuns.quizId,
      currentIndex: quizSoloRuns.currentIndex,
      score: quizSoloRuns.score,
      correctCount: quizSoloRuns.correctCount,
      finishedAt: quizSoloRuns.finishedAt,
      // Time since the current question's answers opened, by the database's clock (negative before they open)
      elapsedMs: sql<number>`coalesce(trunc(extract(epoch from (clock_timestamp() - ${quizSoloRuns.questionOpenedAt})) * 1000), 0)::int`,
    })
    .from(quizSoloRuns)
    .where(eq(quizSoloRuns.tokenHash, hashToken(token)));
  return run ?? null;
}

export type SoloRun = NonNullable<Awaited<ReturnType<typeof soloRunByToken>>>;

// Starts a run and opens question 1
export async function soloStart(db: Db, quiz: PublicQuiz, nicknameInput: unknown): Promise<Result<{ token: string; question: ReturnType<typeof soloQuestion> }>> {
  const nickname = String(nicknameInput ?? "").trim().replace(/\s+/g, " ");
  if (nickname === "" || [...nickname].length > 24) return fail("Choose a nickname of up to 24 characters.");

  const { token, hash } = newToken(24);
  await db.insert(quizSoloRuns).values({ quizId: quiz.id, nickname, tokenHash: hash, questionOpenedAt: fromNow(SOLO_LEAD_MS) });
  await db.update(quizzes).set({ plays: sql`${quizzes.plays} + 1` }).where(eq(quizzes.id, quiz.id));
  return { ok: true, value: { token, question: soloQuestion(quiz, 0) } };
}

// Scores one answer (choice -1 means time ran out) and opens the next question
export async function soloAnswer(db: Db, run: SoloRun, quiz: PublicQuiz, index: number, choice: number) {
  if (run.finishedAt) return fail("This game is over. Start again to play another round.");
  if (index !== run.currentIndex) return fail("That question has already been answered.");
  const q = quiz.questions[index];
  if (!q) return fail("That question has already been answered.");

  const elapsed = run.elapsedMs;
  if (choice >= 0 && elapsed < -300) return fail("Answers aren't open yet.");
  const inTime = elapsed <= q.time * 1000 + QUIZ_GRACE_MS;
  const correct = choice === q.correct && inTime;
  const points = correct ? pointsFor(q, Math.max(0, elapsed)) : 0;
  const next = index + 1;
  const last = next >= quiz.questions.length;

  // The current_index check means a double tap can't score the same question twice
  const [updated] = await db
    .update(quizSoloRuns)
    .set({
      score: sql`${quizSoloRuns.score} + ${points}`,
      correctCount: sql`${quizSoloRuns.correctCount} + ${correct ? 1 : 0}`,
      currentIndex: next,
      questionOpenedAt: fromNow(SOLO_RESULT_MS + SOLO_LEAD_MS),
      finishedAt: last ? sql`now()` : null,
    })
    .where(and(eq(quizSoloRuns.id, run.id), eq(quizSoloRuns.currentIndex, index), isNull(quizSoloRuns.finishedAt)))
    .returning({ score: quizSoloRuns.score, correctCount: quizSoloRuns.correctCount });
  if (!updated) return fail("That question has already been answered.");

  const result = { correct, timedOut: !inTime || choice < 0, points, rightAnswer: q.correct, score: updated.score };
  if (!last) {
    // The next question opens after the result screen and its "Get ready", so no thinking time is lost
    return { ok: true as const, value: { ...result, question: soloQuestion(quiz, next, SOLO_RESULT_MS + SOLO_LEAD_MS) } };
  }

  // Finished: where this run lands among everyone who has played
  const finished = and(eq(quizSoloRuns.quizId, quiz.id), isNotNull(quizSoloRuns.finishedAt));
  const [{ ahead, players }] = await db
    .select({
      ahead: sql<number>`count(*) filter (where ${quizSoloRuns.score} > ${updated.score} or (${quizSoloRuns.score} = ${updated.score} and ${quizSoloRuns.id} < ${run.id}))::int`,
      players: sql<number>`count(*)::int`,
    })
    .from(quizSoloRuns)
    .where(finished);

  return {
    ok: true as const,
    value: { ...result, finished: true, rank: ahead + 1, players, correctCount: updated.correctCount, total: quiz.questions.length, runId: run.id, board: await soloBoard(db, quiz.id) },
  };
}
