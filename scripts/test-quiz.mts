import { fixtureAdapter } from "./score-submission-fixture";
// Checks the quiz backend (quizzes, public and solo play, live games, tournament scores) against a
// throwaway Postgres that runs inside this script, with the real migrations applied. Run with: npm test
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";
import { categoryCounts } from "@/lib/quiz/categories";
import { advance, answer, gameById, gameByPin, hostView, join, kick, launch, playerByToken, playerView, type Game } from "@/lib/quiz/engine";
import { mediaAllowed } from "@/lib/quiz/media";
import { deleteQuiz, exploreQuizzes, listOwnQuizzes, ownQuiz, publicQuiz, saveQuiz } from "@/lib/quiz/quizzes";
import { soloAnswer, soloRunByToken, soloStart } from "@/lib/quiz/solo";
import { hostTournaments, sendScores, tournamentTeams } from "@/lib/quiz/tournament-link";

const db = drizzle(new PGlite(), { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

let passed = 0;
async function check(name: string, run: () => Promise<void> | void) {
  await run();
  passed++;
  console.log("ok  " + name);
}
function value<R extends { ok: true; value: unknown } | { ok: false; error: string }>(result: R): Extract<R, { ok: true }>["value"] {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const error = (result: { ok: boolean; error?: string }) => {
  assert.equal(result.ok, false);
  return result.error;
};

const [asha] = await db.insert(schema.users).values({ name: "Asha Mrema", email: "asha@example.com", password: "x", emailVerifiedAt: new Date() }).returning();
const [baraka] = await db.insert(schema.users).values({ name: "Baraka", email: "baraka@example.com", password: "x", emailVerifiedAt: new Date() }).returning();

const questions = [
  { text: "Capital of Tanzania?", answers: ["Dodoma", "Arusha", "Mwanza"], correct: 0, time: 20, points: 1 },
  { text: "2 + 2?", answers: ["3", "4"], correct: 1, time: 10, points: 2 },
];
let quizId = 0;

// The game's clock is the database's. Tests move it instead of waiting.
const game = async (id: number) => (await gameById(db, id))!;
const openNow = (id: number, agoMs: number) =>
  db.update(schema.quizGames).set({ questionStartedAt: sql`clock_timestamp() - ${agoMs}::int * interval '1 millisecond'`, questionEndsAt: sql`question_ends_at - (question_started_at - (clock_timestamp() - ${agoMs}::int * interval '1 millisecond'))` }).where(eq(schema.quizGames.id, id));

await check("saving a quiz: title, questions and category rules", async () => {
  assert.equal(error(await saveQuiz(db, asha.id, { title: " ", questions })), "Give the quiz a title (up to 120 characters).");
  assert.equal(error(await saveQuiz(db, asha.id, { title: "Quiz", questions: [] })), "Add at least one question.");
  assert.equal(error(await saveQuiz(db, asha.id, { title: "Quiz", questions, is_public: true })), "Choose a category so people can find your quiz.");
  assert.equal(error(await saveQuiz(db, asha.id, { title: "Quiz", questions, new_category: "ab" })), "Keep the new category between 3 and 30 characters.");

  const saved = value(await saveQuiz(db, asha.id, { title: " Tanzania basics ", description: "Warm-up", questions, category: "geography", is_public: true }));
  quizId = saved.id;
  assert.equal(saved.categoryLabel, "Geography");
  const stored = (await ownQuiz(db, quizId, asha.id))!;
  assert.equal(stored.title, "Tanzania basics");
  assert.deepEqual(stored.questions, questions);
});

await check("a host-added category is created once and reused", async () => {
  const first = value(await saveQuiz(db, asha.id, { title: "Methali", questions, new_category: "Swahili  Proverbs", is_public: true }));
  assert.equal(first.category, "c-swahili-proverbs");
  const second = value(await saveQuiz(db, baraka.id, { title: "Methali 2", questions, new_category: "swahili proverbs", is_public: true }));
  assert.deepEqual([second.category, second.categoryLabel], ["c-swahili-proverbs", "Swahili Proverbs"]);
  assert.equal(value(await saveQuiz(db, baraka.id, { title: "H", questions, new_category: "History" })).category, "history");
  // A made-up custom id that no quiz uses is dropped
  assert.equal(value(await saveQuiz(db, baraka.id, { title: "X", questions, category: "c-nothing-here" })).category, null);
});

await check("only the owner can read, change or delete a quiz", async () => {
  assert.equal(await ownQuiz(db, quizId, baraka.id), null);
  assert.equal(error(await saveQuiz(db, baraka.id, { id: quizId, title: "Stolen", questions })), "Quiz not found.");
  assert.equal(await deleteQuiz(db, quizId, baraka.id), false);
  assert.equal((await listOwnQuizzes(db, asha.id)).length, 2);
  assert.equal((await listOwnQuizzes(db, asha.id))[0].count, 2);
});

await check("explore shows public quizzes only, with first names and safe search", async () => {
  const all = await exploreQuizzes(db, {});
  assert.deepEqual(all.map((q) => q.title).sort(), ["Methali", "Methali 2", "Tanzania basics"]);
  assert.equal(all.find((q) => q.title === "Tanzania basics")!.author, "Asha");
  assert.equal((await exploreQuizzes(db, { search: "tanzania" })).length, 1);
  assert.equal((await exploreQuizzes(db, { search: "%" })).length, 0);
  assert.equal((await exploreQuizzes(db, { category: "c-swahili-proverbs" })).length, 2);
  const counts = await categoryCounts(db);
  assert.equal(counts.find((c) => c.id === "geography")!.count, 1);
  assert.deepEqual(counts.at(-1), { id: "c-swahili-proverbs", label: "Swahili Proverbs", count: 2 });
});

await check("media: only QuizoTab's own files are accepted", () => {
  assert.deepEqual(mediaAllowed({ type: "video", src: "0adabda0b1712f0ef435356c611e19b3.jpg" }), { type: "image", src: "0adabda0b1712f0ef435356c611e19b3.jpg" });
  assert.equal(mediaAllowed({ type: "image", src: "https://evil.example/x.jpg" }), null);
  assert.equal(mediaAllowed({ type: "image", src: "../../etc/passwd" }), null);
  process.env.MEDIA_HOSTS = "files.example.com";
  assert.deepEqual(mediaAllowed({ type: "image", src: "https://files.example.com/a/clip.mp4" }), { type: "video", src: "https://files.example.com/a/clip.mp4" });
  assert.equal(mediaAllowed({ type: "image", src: "http://files.example.com/a.jpg" }), null);
});

await check("solo play: the server keeps the clock, the score and the leaderboard", async () => {
  const quiz = (await publicQuiz(db, quizId))!;
  assert.equal(error(await soloStart(db, quiz, "  ")), "Choose a nickname of up to 24 characters.");
  const started = value(await soloStart(db, quiz, " Neema "));
  assert.equal("correct" in started.question, false);
  assert.equal((await publicQuiz(db, quizId))!.plays, 1);

  let run = (await soloRunByToken(db, started.token))!;
  assert.equal(error(await soloAnswer(db, run, quiz, 0, 0)), "Answers aren't open yet.");

  // One second after answers opened
  await db.update(schema.quizSoloRuns).set({ questionOpenedAt: sql`clock_timestamp() - interval '1 second'` });
  run = (await soloRunByToken(db, started.token))!;
  const first = value(await soloAnswer(db, run, quiz, 0, 0));
  assert.equal(first.correct, true);
  assert.ok(first.points >= 970 && first.points <= 976, String(first.points));
  assert.equal(error(await soloAnswer(db, run, quiz, 0, 0)), "That question has already been answered.");

  // Question 2: time ran out
  await db.update(schema.quizSoloRuns).set({ questionOpenedAt: sql`clock_timestamp() - interval '1 second'` });
  run = (await soloRunByToken(db, started.token))!;
  const last = value(await soloAnswer(db, run, quiz, 1, -1));
  assert.equal(last.timedOut, true);
  // The last answer finishes the game: no next question, but the final ranking
  const done = last as unknown as { question?: unknown; finished: boolean; rank: number; players: number; correctCount: number; total: number; board: Array<{ name: string }> };
  assert.equal(done.question, undefined);
  assert.deepEqual([done.finished, done.rank, done.players, done.correctCount, done.total, done.board[0].name], [true, 1, 1, 1, 2, "Neema"]);
  assert.equal(error(await soloAnswer(db, (await soloRunByToken(db, started.token))!, quiz, 1, 1)), "This game is over. Start again to play another round.");
  assert.equal(await soloRunByToken(db, "nope"), null);
});

let gameId = 0;
let tokenA = "";
let tokenB = "";

await check("live game: launch, PIN and joining", async () => {
  const quiz = (await ownQuiz(db, quizId, asha.id))!;
  gameId = value(await launch(db, quiz, asha.id, null));
  const g = await game(gameId);
  assert.match(g.pin, /^\d{6}$/);
  assert.equal((await gameByPin(db, g.pin))!.id, gameId);

  tokenA = value(await join(db, g, " Amina ", null));
  tokenB = value(await join(db, g, "Juma", null));
  assert.match(tokenA, /^[0-9a-f]{48}$/);
  assert.equal(error(await join(db, g, "Amina", null)), "That nickname is taken in this game. Try another.");
  assert.equal(error(await join(db, g, "x".repeat(25), null)), "Choose a nickname of up to 24 characters.");
  assert.equal((await game(gameId)).version, 3); // launch = 1, then one bump per player
  assert.deepEqual((await hostView(db, await game(gameId))).players.map((p) => p.name), ["Amina", "Juma"]);
});

await check("live game: the right answer stays hidden until the reveal", async () => {
  const started = value(await advance(db, await game(gameId), "start"));
  assert.equal(started.status, "question");
  assert.ok(started.opensInMs > 2500 && started.opensInMs <= 3000);
  assert.equal(error(await advance(db, started, "start")), "The game has already started.");

  const a = (await playerByToken(db, tokenA))!;
  const view = await playerView(db, started, a);
  assert.equal("correct" in view, false);
  assert.equal(JSON.stringify(view).includes('"correct"'), false);
  assert.equal(error(await answer(db, started, a, 0, 0)), "Answers aren't open yet.");
});

await check("live game: answers are scored once, by speed", async () => {
  await openNow(gameId, 2000); // answers opened 2 seconds ago
  const g = await game(gameId);
  const a = (await playerByToken(db, tokenA))!;
  const b = (await playerByToken(db, tokenB))!;

  assert.equal(error(await answer(db, g, a, 0, 7)), "Choose one of the answers.");
  assert.equal(error(await answer(db, g, a, 1, 0)), "Too late: this question has closed.");
  value(await answer(db, g, a, 0, 0)); // right
  value(await answer(db, g, b, 0, 1)); // wrong
  assert.equal(error(await answer(db, g, a, 0, 0)), "You've already answered this question.");

  const host = await hostView(db, await game(gameId));
  assert.deepEqual(host.counts, [1, 1, 0]);
  assert.equal(host.answered, 2);
  const scoreA = host.players.find((p) => p.name === "Amina")!.score;
  assert.ok(scoreA >= 945 && scoreA <= 952, String(scoreA)); // 1000 x (1 - 2s/20s/2)
  assert.equal(host.players.find((p) => p.name === "Juma")!.score, 0);
});

await check("live game: reveal, leaderboard, next question, finish", async () => {
  let g = value(await advance(db, await game(gameId), "reveal"));
  assert.equal(g.status, "reveal");
  assert.ok(g.remainingMs <= 0);
  const a = (await playerByToken(db, tokenA))!;
  const revealed = await playerView(db, g, a);
  assert.equal("correct" in revealed && revealed.correct, 0);
  assert.equal("result" in revealed && revealed.result?.correct, true);
  assert.equal(error(await answer(db, g, (await playerByToken(db, tokenB))!, 0, 0)), "Too late: this question has closed.");

  g = value(await advance(db, g, "next"));
  assert.equal(g.status, "leaderboard");
  const board = await playerView(db, g, a);
  assert.deepEqual("leaderboard" in board && board.leaderboard!.map((r) => r.name), ["Amina", "Juma"]);

  g = value(await advance(db, g, "next"));
  assert.deepEqual([g.status, g.currentIndex], ["question", 1]);

  // The clock ran out more than the grace period ago
  await db.update(schema.quizGames).set({ questionStartedAt: sql`clock_timestamp() - interval '12 seconds'`, questionEndsAt: sql`clock_timestamp() - interval '2 seconds'` }).where(eq(schema.quizGames.id, gameId));
  assert.equal(error(await answer(db, await game(gameId), a, 1, 1)), "Too late: time ran out.");

  g = value(await advance(db, await game(gameId), "reveal"));
  g = value(await advance(db, g, "next")); // last question: straight to the end
  assert.equal(g.status, "finished");
  const final = await playerView(db, g, (await playerByToken(db, tokenB))!);
  assert.deepEqual([final.status, "you" in final && final.you.rank, "you" in final && final.you.of], ["finished", 2, 2]);
  assert.equal(error(await join(db, g, "Late", null)), "This game has ended.");
  assert.equal(await gameByPin(db, "000000"), null);
});

await check("two clicks at once can't skip a step", async () => {
  const quiz = (await ownQuiz(db, quizId, asha.id))!;
  const id = value(await launch(db, quiz, asha.id, null));
  const stale = await game(id);
  const [first, second] = await Promise.all([advance(db, stale, "start"), advance(db, stale, "start")]);
  assert.equal(value(first).currentIndex, 0);
  assert.equal(value(second).currentIndex, 0);
  assert.equal((await game(id)).version, 2); // moved on exactly once
});

await check("a removed player is out of the game", async () => {
  const quiz = (await ownQuiz(db, quizId, asha.id))!;
  const id = value(await launch(db, quiz, asha.id, null));
  const token = value(await join(db, await game(id), "Trouble", null));
  const player = (await playerByToken(db, token))!;
  await kick(db, await game(id), player.id);
  assert.equal(await playerByToken(db, token), null);
  assert.deepEqual(await playerView(db, await game(id), player), { status: "kicked" });
  assert.equal((await hostView(db, await game(id))).players.length, 0);
});

await check("tournament games: teams play, and scores go to the round once", async () => {
  const [tournament] = await db.insert(schema.tournaments).values({ ownerId: asha.id, name: "Lake Zone Quiz", category: "Schools", year: 2026, status: "active" }).returning();
  const existing = [{ id: "old", teamId: "t0", roundId: "r1", points: 40, approved: true }];
  await db.insert(schema.tournamentState).values([
    { tournamentId: tournament.id, key: "config", value: { maxScorePerRound: 100, rounds: [{ id: "r1", stage: "preliminary", match: "1", name: "Opening", minPoints: 10, maxPoints: 60 }] } },
    { tournamentId: tournament.id, key: "scores", value: existing },
  ]);
  const [owls, lions] = await db.insert(schema.teams).values([{ tournamentId: tournament.id, name: "Owls" }, { tournamentId: tournament.id, name: "Lions" }]).returning();

  const mine = await hostTournaments(db, asha.id);
  assert.deepEqual(mine, [{ id: tournament.id, name: "Lake Zone Quiz (Schools)", rounds: [{ id: "r1", label: "Preliminary 1: Opening" }] }]);
  assert.deepEqual(await hostTournaments(db, baraka.id), []);

  const quiz = (await ownQuiz(db, quizId, asha.id))!;
  const teams = await tournamentTeams(db, tournament.id);
  const id = value(await launch(db, quiz, asha.id, { tournamentId: tournament.id, roundId: "r1", label: "Lake Zone Quiz, Preliminary 1: Opening", teams }));
  let g: Game = await game(id);
  assert.equal(error(await join(db, g, "Someone", "not-a-team")), "Choose your team.");
  const owlsToken = value(await join(db, g, null, owls.id));
  value(await join(db, g, null, lions.id));
  assert.equal(error(await join(db, g, null, owls.id)), "Someone has already joined as this team.");
  assert.equal(await sendScores(db, g), "Finish the game first.");

  g = value(await advance(db, g, "start"));
  await db.update(schema.quizGames).set({ questionStartedAt: sql`clock_timestamp()`, questionEndsAt: sql`clock_timestamp() + interval '20 seconds'` }).where(eq(schema.quizGames.id, id));
  value(await answer(db, await game(id), (await playerByToken(db, owlsToken))!, 0, 0)); // Owls: ~1000 of 3000 possible
  g = value(await advance(db, await game(id), "end"));

  const before=await db.select().from(schema.tournamentState).where(eq(schema.tournamentState.tournamentId,tournament.id));
  await assert.rejects(sendScores(fixtureAdapter(db,tournament.id),g),{status:409});
  assert.equal((await game(id)).scoresSentAt,null);
  assert.deepEqual(await db.select().from(schema.tournamentState).where(eq(schema.tournamentState.tournamentId,tournament.id)),before);
  assert.equal(await sendScores(db, g), null);
  assert.equal(await sendScores(db, await game(id)), "These scores were already sent.");
  assert.equal(await sendScores(db, g), "These scores were already sent."); // a second click with the old page

  const [state] = await db.select().from(schema.tournamentState).where(sql`tournament_id = ${tournament.id} and key = 'scores'`);
  const scores = state.value as Array<{ teamId: string; points: number; approved: boolean; judgeName?: string }>;
  assert.equal(scores.length, 3);
  assert.deepEqual(scores[0], existing[0]); // scores already there are kept
  const byTeam = Object.fromEntries(scores.slice(1).map((s) => [s.teamId, s]));
  assert.ok(byTeam[owls.id].points >= 26 && byTeam[owls.id].points <= 27, String(byTeam[owls.id].points)); // 10 + (1000/3000) x 50
  assert.equal(byTeam[lions.id].points, 10); // nothing right: the round's minimum
  assert.deepEqual([byTeam[owls.id].approved, byTeam[owls.id].judgeName], [false, "Online quiz"]);
  assert.equal((await hostView(db, await game(id))).tournament?.sent, true);
});

console.log(`\n${passed} checks passed`);
