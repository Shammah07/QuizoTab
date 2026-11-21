import "server-only";
import { and, eq, max, sql, sum } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { tournamentScoreEntries as entries } from "@/lib/db/schema";
import { matchWinnerDetail, stageRoundsFor, type Pairing, type TournamentConfig } from "./rules";
import type { readScoringPlan } from "./scoring-plan";

// score_attempt_approved guarantees at most one effective revision per attempt.
// Group within a fixture/roster before rolling up across rooms or rounds.
export async function officialAwards(db: Db, tournamentId: string, roomId?: string) {
  const rows = await db.select({
    roomId: entries.roomId, contextId: entries.contextId, teamId: entries.teamId, roundId: entries.roundId,
    points: sum(entries.points), questions: sql<string[]>`array_agg(${entries.questionKey})`,
    reviewedAt: max(entries.reviewedAt),
  }).from(entries).where(and(eq(entries.tournamentId, tournamentId), eq(entries.status, "approved"),
    roomId === undefined ? undefined : eq(entries.roomId, roomId)))
    .groupBy(entries.roomId, entries.contextId, entries.teamId, entries.roundId);
  return rows.map(r => ({ ...r, points: Number(r.points), updatedAt: r.reviewedAt!.toISOString() }));
}
export type OfficialAward = Awaited<ReturnType<typeof officialAwards>>[number];

export function roundTotals(rows: Pick<OfficialAward, "teamId" | "roundId" | "points">[]) {
  const totals = new Map<string, { teamId: string; roundId: string; points: number }>();
  for (const { teamId, roundId, points } of rows) {
    const key = JSON.stringify([teamId, roundId]);
    const previous = totals.get(key);
    if (previous) previous.points += points;
    else totals.set(key, { teamId, roundId, points });
  }
  return [...totals.values()];
}

export function officialFixture(pair: Pairing, config: TournamentConfig, plan: ReturnType<typeof readScoringPlan>, awards: OfficialAward[]) {
  const rows = awards.filter(r => r.contextId === pair.id && r.roomId === pair.roomId);
  const rounds = stageRoundsFor(config, pair.stage, pair.matchLabel);
  const teams = [pair.teamAId, pair.teamBId].filter((id): id is string => !!id);
  const complete = !!(pair.released && pair.roomId && teams.length && plan.completedContexts?.includes(pair.id) &&
    (teams.length === 1 || (rounds.length && rounds.every(round => {
      const questions = plan.rounds.find(r => r.id === round.id)?.questions;
      return questions?.length && teams.every(team => {
        const covered = rows.find(r => r.teamId === team && r.roundId === round.id)?.questions;
        return questions.every(q => covered?.includes(q.id));
      });
    }))));
  const result = complete ? matchWinnerDetail(pair, config, rows) : { winnerId: null, viaTiebreak: false };
  return { complete, winnerId: result.winnerId && teams.includes(result.winnerId) ? result.winnerId : null, viaTiebreak: result.viaTiebreak };
}
