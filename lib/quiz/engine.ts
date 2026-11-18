import "server-only";
import { and, asc, desc, eq, getTableColumns, inArray, ne, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { hashToken, looksLikePlayerToken, newToken } from "@/lib/auth/tokens";
import type { Db } from "@/lib/db";
import { quizAnswers, quizGames, quizPlayers, type GameTeam, type QuizQuestion } from "@/lib/db/schema";
import { ring } from "@/lib/realtime";
import { pointsFor, QUIZ_GRACE_MS, QUIZ_LEAD_MS, QUIZ_MAX_PLAYERS } from "./rules";

// Live quiz engine, moved over from quiz_engine.php. The server is the referee: it keeps the clock,
// hides the right answer until the reveal, and scores every answer. Screens learn about changes through
// a realtime "doorbell" (and by checking every few seconds) and then fetch the state from here,
// so a player can never fake a question or a score.

// Milliseconds from the database's own clock until a moment (negative once it has passed).
// Worked out by Postgres, so the server's clock and the database's clock can't disagree.
const msUntil = (column: AnyColumn) => sql<number>`coalesce(trunc(extract(epoch from (${column} - clock_timestamp())) * 1000), 0)::int`;

const gameFields = {
  ...getTableColumns(quizGames),
  opensInMs: msUntil(quizGames.questionStartedAt),
  remainingMs: msUntil(quizGames.questionEndsAt),
};

const fromNow = (ms: number) => sql`clock_timestamp() + ${ms}::int * interval '1 millisecond'`;

export type Game = NonNullable<Awaited<ReturnType<typeof gameById>>>;
export type Player = typeof quizPlayers.$inferSelect;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });

export async function gameById(db: Db, id: number) {
  const [game] = await db.select(gameFields).from(quizGames).where(eq(quizGames.id, id));
  return game ?? null;
}

// The newest game with this PIN (PINs are only reused once a game has finished)
export async function gameByPin(db: Db, pin: string) {
  const [game] = await db.select(gameFields).from(quizGames).where(eq(quizGames.pin, pin)).orderBy(desc(quizGames.id)).limit(1);
  return game ?? null;
}

export async function newPin(db: Db) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const pin = String(100000 + Math.floor(Math.random() * 900000));
    const [taken] = await db.select({ id: quizGames.id }).from(quizGames).where(and(eq(quizGames.pin, pin), ne(quizGames.status, "finished"))).limit(1);
    if (!taken) return pin;
  }
  return null;
}

// Changes a game, bumps its version and tells every screen. `when` makes the change conditional
// (for example "only while still in the lobby"), so two clicks at once can't both go through.
// Returns the game as it now stands, or null when `when` no longer held.
async function setGame(db: Db, id: number, set: Partial<Record<keyof typeof quizGames.$inferInsert, unknown>>, when?: SQL) {
  const [game] = await db
    .update(quizGames)
    .set({ ...set, version: sql`${quizGames.version} + 1` } as never)
    .where(and(eq(quizGames.id, id), when))
    .returning(gameFields);
  if (game) await ring(game.pin, game.version);
  return game ?? null;
}

// Nothing about the game itself changes, but screens should look again (someone joined or was removed)
const touch = (db: Db, id: number) => setGame(db, id, {});

function openQuestion(db: Db, game: Game, index: number, when: SQL) {
  const timeMs = game.questions[index].time * 1000;
  return setGame(db, game.id, { status: "question", currentIndex: index, questionStartedAt: fromNow(QUIZ_LEAD_MS), questionEndsAt: fromNow(QUIZ_LEAD_MS + timeMs) }, when);
}

export type AdvanceStep = "start" | "reveal" | "next" | "end";

// The host moves the game on
export async function advance(db: Db, game: Game, to: string): Promise<Result<Game>> {
  const last = game.questions.length - 1;
  const i = game.currentIndex;
  const here = and(eq(quizGames.status, game.status), eq(quizGames.currentIndex, i))!;
  // If someone else moved the game first, answer with the game as it now is
  const done = async (changed: Game | null) => ({ ok: true as const, value: changed ?? (await gameById(db, game.id))! });

  switch (to) {
    case "start":
      if (game.status !== "lobby") return fail("The game has already started.");
      return done(await openQuestion(db, game, 0, here));
    case "reveal":
      if (game.status !== "question") return done(game);
      return done(await setGame(db, game.id, { status: "reveal", questionEndsAt: sql`least(${quizGames.questionEndsAt}, clock_timestamp())` }, here));
    case "next":
      if (game.status === "reveal" && i < last) return done(await setGame(db, game.id, { status: "leaderboard" }, here));
      if (game.status === "reveal" || game.status === "leaderboard") {
        return done(i >= last ? await setGame(db, game.id, { status: "finished" }, here) : await openQuestion(db, game, i + 1, here));
      }
      return done(game);
    case "end":
      return done(await setGame(db, game.id, { status: "finished" }));
  }
  return fail("Unknown step.");
}

// ---------- Players ----------

// Everyone still in the game, best score first; ties go to whoever joined earlier
export function playersOf(db: Db, gameId: number) {
  return db
    .select({ id: quizPlayers.id, nickname: quizPlayers.nickname, teamId: quizPlayers.teamId, score: quizPlayers.score, streak: quizPlayers.streak })
    .from(quizPlayers)
    .where(and(eq(quizPlayers.gameId, gameId), eq(quizPlayers.kicked, false)))
    .orderBy(desc(quizPlayers.score), asc(quizPlayers.joinedAt), asc(quizPlayers.id));
}

export async function playerByToken(db: Db, token: unknown): Promise<Player | null> {
  if (!looksLikePlayerToken(token)) return null;
  const [player] = await db.select().from(quizPlayers).where(and(eq(quizPlayers.tokenHash, hashToken(token)), eq(quizPlayers.kicked, false)));
  return player ?? null;
}

// Returns the secret token the player's phone keeps
export async function join(db: Db, game: Game, nicknameInput: unknown, teamIdInput: unknown): Promise<Result<string>> {
  if (game.status === "finished") return fail("This game has ended.");

  let nickname: string;
  let teamId: string | null = null;
  if (game.teams) {
    // Tournament games: each team joins as one player, under its own name
    const team = game.teams.find((t) => t.id === teamIdInput);
    if (!team) return fail("Choose your team.");
    nickname = team.name;
    teamId = team.id;
  } else {
    nickname = String(nicknameInput ?? "").trim().replace(/\s+/g, " ");
    if (nickname === "" || [...nickname].length > 24) return fail("Choose a nickname of up to 24 characters.");
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(quizPlayers).where(and(eq(quizPlayers.gameId, game.id), eq(quizPlayers.kicked, false)));
  if (count >= QUIZ_MAX_PLAYERS) return fail("This game is full.");

  // The unique rule on (game, nickname) decides, so two phones can't take the same name at the same moment
  const { token, hash } = newToken(24);
  const [row] = await db.insert(quizPlayers).values({ gameId: game.id, nickname, teamId, tokenHash: hash }).onConflictDoNothing().returning({ id: quizPlayers.id });
  if (!row) return fail(game.teams ? "Someone has already joined as this team." : "That nickname is taken in this game. Try another.");

  // The host's lobby shows names as they arrive
  await touch(db, game.id);
  return { ok: true, value: token };
}

export async function kick(db: Db, game: Game, playerId: number) {
  await db.update(quizPlayers).set({ kicked: true }).where(and(eq(quizPlayers.id, playerId), eq(quizPlayers.gameId, game.id)));
  return (await touch(db, game.id))!;
}

export async function answer(db: Db, game: Game, player: Player, index: number, choice: number): Promise<Result<true>> {
  if (game.status !== "question" || game.currentIndex !== index) return fail("Too late: this question has closed.");
  const question = game.questions[index];
  if (!Number.isInteger(choice) || choice < 0 || choice >= question.answers.length) return fail("Choose one of the answers.");
  if (game.opensInMs > 0) return fail("Answers aren't open yet.");
  if (game.remainingMs < -QUIZ_GRACE_MS) return fail("Too late: time ran out.");

  const elapsed = Math.round(question.time * 1000 - Math.max(0, game.remainingMs));
  const correct = choice === question.correct;
  const points = correct ? pointsFor(question, elapsed) : 0;

  // One statement: the answer is saved and the score added together, or neither happens.
  // The unique rule on (player, question) refuses a second answer; the game check refuses one
  // that arrives after the host has already moved on.
  const result = await db.execute(sql`
    with saved as (
      insert into quiz_answers (game_id, player_id, question_index, choice, correct, points, answered_ms)
      select ${game.id}, ${player.id}, ${index}, ${choice}, ${correct}, ${points}, ${elapsed}
      where exists (select 1 from quiz_games where id = ${game.id} and status = 'question' and current_index = ${index})
      on conflict do nothing
      returning points, correct
    ), scored as (
      update quiz_players p
      set score = p.score + saved.points, streak = case when saved.correct then p.streak + 1 else 0 end
      from saved where p.id = ${player.id}
      returning 1
    )
    select (select count(*) from saved)::int as saved`);
  const rows = (result as unknown as { rows: Array<{ saved: number }> }).rows;
  if (rows[0]?.saved !== 1) return fail("You've already answered this question.");
  return { ok: true, value: true };
}

// ---------- What each screen may know ----------

type RankRow = { rank: number; name: string; score: number; gained: number };

// Leaderboard rows. "gained" is what the latest question added, so screens can count the total up from the old one.
function rankRows(players: Array<{ id: number; nickname: string; score: number }>, limit: number, gained: Map<number, number>): RankRow[] {
  return players.slice(0, limit).map((p, i) => ({ rank: i + 1, name: p.nickname, score: p.score, gained: gained.get(p.id) ?? 0 }));
}

function answersFor(db: Db, gameId: number, index: number) {
  return db
    .select({ playerId: quizAnswers.playerId, choice: quizAnswers.choice, correct: quizAnswers.correct, points: quizAnswers.points })
    .from(quizAnswers)
    .where(and(eq(quizAnswers.gameId, gameId), eq(quizAnswers.questionIndex, index)));
}

// A question without its right answer
function publicQuestion(q: QuizQuestion) {
  return { text: q.text, answers: q.answers, time: q.time, points: q.points, media: q.media ?? null };
}

// What a player's phone may know right now. The right answer appears only after the reveal.
// (Field names match the PHP API, so the screens read the same data as before.)
export async function playerView(db: Db, game: Game, player: Player) {
  const i = game.currentIndex;
  const players = await playersOf(db, game.id);
  const rank = players.findIndex((p) => p.id === player.id);
  if (rank === -1) return { status: "kicked" as const };

  const me = players[rank];
  const started = i >= 0 && game.status !== "lobby";
  const answers = started ? await answersFor(db, game.id, i) : [];
  const mine = answers.find((a) => a.playerId === player.id);
  const gained = new Map(answers.map((a) => [a.playerId, a.points]));
  const revealed = game.status !== "question";

  return {
    status: game.status,
    version: game.version,
    title: game.title,
    index: i,
    total: game.questions.length,
    you: { name: player.nickname, score: me.score, rank: rank + 1, streak: me.streak, of: players.length, ...(started ? { gained: mine?.points ?? 0 } : {}) },
    ...(started
      ? {
          question: publicQuestion(game.questions[i]),
          opens_in_ms: Math.max(0, game.opensInMs),
          remaining_ms: Math.max(0, game.remainingMs),
          answered: mine ? mine.choice : null,
          ...(revealed ? { correct: game.questions[i].correct, result: mine ? { correct: mine.correct, points: mine.points } : null } : {}),
        }
      : {}),
    // Between questions phones show the top 5. At the end every player sees the whole ranking.
    ...(game.status === "leaderboard" ? { leaderboard: rankRows(players, 5, gained) } : {}),
    ...(game.status === "finished" ? { leaderboard: rankRows(players, QUIZ_MAX_PLAYERS, gained) } : {}),
  };
}

// Everything the big screen needs, including live answer counts
export async function hostView(db: Db, game: Game) {
  const i = game.currentIndex;
  const players = await playersOf(db, game.id);
  const started = i >= 0 && game.status !== "lobby";
  const answers = started ? await answersFor(db, game.id, i) : [];
  const question = started ? game.questions[i] : null;
  const counts = question ? question.answers.map((_, choice) => answers.filter((a) => a.choice === choice).length) : [];

  return {
    id: game.id,
    pin: game.pin,
    status: game.status,
    version: game.version,
    title: game.title,
    index: i,
    total: game.questions.length,
    players: players.map((p) => ({ id: p.id, name: p.nickname, score: p.score })),
    tournament: game.tournamentId ? { label: game.tournamentLabel, sent: game.scoresSentAt !== null } : null,
    ...(question ? { question, counts, answered: answers.length, opens_in_ms: Math.max(0, game.opensInMs), remaining_ms: Math.max(0, game.remainingMs) } : {}),
    // The final screen lists everyone below the podium
    leaderboard: rankRows(players, game.status === "finished" ? QUIZ_MAX_PLAYERS : 5, new Map(answers.map((a) => [a.playerId, a.points]))),
  };
}

// ---------- Starting a game ----------

type Link = { tournamentId: string; roundId: string; label: string; teams: GameTeam[] };

// One run of a quiz. The questions are copied in, so editing the quiz can't change a game in progress.
export async function launch(db: Db, quiz: { id: number; title: string; questions: QuizQuestion[] }, ownerId: number, link: Link | null): Promise<Result<number>> {
  const pin = await newPin(db);
  if (!pin) return fail("No free game PIN right now. Try again.");
  const [game] = await db
    .insert(quizGames)
    .values({
      quizId: quiz.id,
      ownerId,
      pin,
      title: quiz.title,
      questions: quiz.questions,
      tournamentId: link?.tournamentId ?? null,
      roundId: link?.roundId ?? null,
      tournamentLabel: link?.label ?? null,
      teams: link?.teams ?? null,
    })
    .returning({ id: quizGames.id });
  return { ok: true, value: game.id };
}

// Whether a 6-digit code typed into "Join" is a live quiz PIN
export async function liveGameTitle(db: Db, pin: string) {
  const [game] = await db
    .select({ title: quizGames.title })
    .from(quizGames)
    .where(and(eq(quizGames.pin, pin), inArray(quizGames.status, ["lobby", "question", "reveal", "leaderboard"])))
    .orderBy(desc(quizGames.id))
    .limit(1);
  return game?.title ?? null;
}
