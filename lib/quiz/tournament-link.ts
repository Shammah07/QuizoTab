import { withLegacyScoring } from "@/lib/tournament/legacy-scoring";
import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { quizGames, teams, tournaments, tournamentState } from "@/lib/db/schema";
import { playersOf, type Game } from "./engine";
import { pointsMax, scaleToRound } from "./rules";

// Linking a live quiz to a tournament round: the tournament's teams play the quiz, and their
// results are added to that round's scores, waiting for the organiser's approval.
// Moved over from quiz_engine.php (which read these from Supabase).

type Round = { id: string; stage?: string; match?: string; name?: string; minPoints?: number | string; maxPoints?: number | string };
type Config = { rounds?: Round[]; maxScorePerRound?: number };

const STAGES: Record<string, string> = {
  preliminary: "Preliminary",
  "round-of-32": "Round of 32",
  "round-of-16": "Round of 16",
  "quarter-final": "Quarter-final",
  "semi-final": "Semi-final",
  final: "Final",
  quiz: "Quiz night",
  league: "League",
};

// The host's tournaments with their rounds, for choosing where a game's scores go
export async function hostTournaments(db: Db, ownerId: number) {
  const list = await db
    .select({ id: tournaments.id, name: tournaments.name, category: tournaments.category })
    .from(tournaments)
    .where(and(eq(tournaments.ownerId, ownerId), eq(tournaments.status, "active"),eq(tournaments.scoringEngineVersion,"legacy")))
    .orderBy(desc(tournaments.createdAt))
    .limit(20);
  if (list.length === 0) return [];

  const configs = await db
    .select({ tournamentId: tournamentState.tournamentId, value: tournamentState.value })
    .from(tournamentState)
    .where(and(inArray(tournamentState.tournamentId, list.map((t) => t.id)), eq(tournamentState.key, "config")));

  return list.map((t) => {
    const config = configs.find((c) => c.tournamentId === t.id)?.value as Config | undefined;
    const rounds = (Array.isArray(config?.rounds) ? config.rounds : []).map((r) => ({
      id: r.id,
      label: `${`${STAGES[r.stage ?? ""] ?? r.stage ?? ""} ${r.match ?? ""}`.trim()}: ${r.name ?? ""}`,
    }));
    return { id: t.id, name: t.name + (t.category ? ` (${t.category})` : ""), rounds };
  });
}

export function tournamentTeams(db: Db, tournamentId: string) {
  return db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.tournamentId, tournamentId)).orderBy(asc(teams.name));
}

// Adds each team's quiz result to the tournament round, scaled to the round's points range.
// Returns an error message, or null when the scores were sent.
export async function sendScores(database: Db, game: Game): Promise<string | null> {
  if (!game.tournamentId || game.status !== "finished") return "Finish the game first.";
  if (game.scoresSentAt) return "These scores were already sent.";

  const tournamentId=game.tournamentId;
  return withLegacyScoring(database,tournamentId,async db=>{
    const [state] = await db
      .select({ value: tournamentState.value })
      .from(tournamentState)
      .where(and(eq(tournamentState.tournamentId, tournamentId), eq(tournamentState.key, "config")));
    const config = state?.value as Config | undefined;
    if (!config || Array.isArray(config)) return "The tournament could not be read. Try again.";

    // The round's own points range, or 0 to the tournament's max points per round
    let maxRound = Number(config.maxScorePerRound ?? 100);
    let minRound = 0;
    for (const round of config.rounds ?? []) {
      if (round.id !== game.roundId) continue;
      if (round.minPoints !== undefined && round.minPoints !== "") minRound = Number(round.minPoints);
      if (round.maxPoints !== undefined && round.maxPoints !== "") maxRound = Number(round.maxPoints);
    }

    const possible = game.questions.reduce((sum, q) => sum + pointsMax(q), 0);
    const now = new Date().toISOString();
    const scores = (await playersOf(db, game.id))
      .filter((p) => p.teamId)
      .map((p) => ({
        id: randomBytes(8).toString("hex"),
        teamId: p.teamId,
        roundId: game.roundId,
        points: scaleToRound(p.score, possible, minRound, maxRound),
        judgeName: "Online quiz",
        enteredAt: now,
        approved: false,
      }));

    // Claim the send first: of two clicks at the same moment, only one gets past this line
    const [claimed] = await db
      .update(quizGames)
      .set({ scoresSentAt: sql`now()`, version: sql`${quizGames.version} + 1` })
      .where(and(eq(quizGames.id, game.id), isNull(quizGames.scoresSentAt)))
      .returning({ id: quizGames.id });
    if (!claimed) return "These scores were already sent.";

    // Added to whatever scores are there in one step, so a judge saving at the same moment loses nothing
    const added = JSON.stringify(scores);
    await db
      .insert(tournamentState)
      .values({ tournamentId, key: "scores", value: scores })
      .onConflictDoUpdate({
        target: [tournamentState.tournamentId, tournamentState.key],
        set: {
          value: sql`case when jsonb_typeof(${tournamentState.value}) = 'array' then ${tournamentState.value} || ${added}::jsonb else ${added}::jsonb end`,
          updatedAt: sql`now()`,
        },
      });
    return null;
  });
}
