import "server-only";
import { and, eq, inArray, sum } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import type { Db } from "@/lib/db";
import { teams, tournamentScoreEntries, tournamentState } from "@/lib/db/schema";
import { isPointsFormat, normalizeConfig, normalizePairings, roundRange, stageRoundsFor, type TournamentConfig } from "./rules";
import { readState, storedRooms } from "./store";

const key = z.string().trim().min(1).max(80);
const points = z.int().min(0).max(100000);
const question = z.strictObject({ id: key, minPoints: points, maxPoints: points });
const roster = z.strictObject({
  id: key, roomId: key, roundId: key, released: z.boolean(), teamIds: z.array(z.uuid()).min(1).max(2000),
});
const planSchema = z.strictObject({
  rounds: z.array(z.strictObject({ id: key, questions: z.array(question).min(1).max(500) })).min(1).max(500),
  rosters: z.array(roster).max(2000),
});
type Plan = z.infer<typeof planSchema>;

function unique(ids: string[]) {
  return new Set(ids).size === ids.length;
}

function validRound(config: TournamentConfig, round: Plan["rounds"][number]) {
  if (config.rounds.filter(r => r.id === round.id).length !== 1 || !unique(round.questions.map(q => q.id))) return false;
  const range = roundRange(config, round.id);
  return round.questions.every(q => q.minPoints <= q.maxPoints) &&
    round.questions.reduce((n, q) => n + q.minPoints, 0) >= range.min &&
    round.questions.reduce((n, q) => n + q.maxPoints, 0) <= range.max;
}

// Called inside the owner PATCH transaction after taking the tournament lock.
export async function saveScoringPlan(tx: Db, id: string, input: unknown) {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "Invalid scoring plan.");
  const plan = parsed.data;
  const { config } = await readState(tx, id);
  if (!unique(plan.rounds.map(r => r.id)) || !plan.rounds.every(r => validRound(config, r))) {
    throw new ApiError(422, "Check round IDs, question IDs and point limits.");
  }
  if (!unique(plan.rosters.map(r => r.id)) || (plan.rosters.length && !isPointsFormat(config))) {
    throw new ApiError(422, "Room rosters require a points-format tournament and distinct IDs.");
  }
  const roomIds = new Set((await storedRooms(tx, id)).map(r => r.id));
  const teamIds = new Set((await tx.select({ id: teams.id }).from(teams).where(eq(teams.tournamentId, id))).map(t => t.id));
  const released = new Set<string>();
  for (const r of plan.rosters) {
    if (!roomIds.has(r.roomId) || !plan.rounds.some(round => round.id === r.roundId) || !unique(r.teamIds)) {
      throw new ApiError(422, "Invalid roster room, round or team list.");
    }
    for (const team of r.teamIds) {
      const slot = JSON.stringify([r.roundId, team]);
      if (!teamIds.has(team) || (r.released && released.has(slot))) throw new ApiError(422, "Invalid or overlapping roster membership.");
      if (r.released) released.add(slot);
    }
  }
  // Preserve the meaning of recorded awards, while allowing the owner to
  // release later rounds, reorder questions, or withdraw an active roster.
  const entries = tournamentScoreEntries;
  const used = await tx.selectDistinct({ round: entries.roundId, question: entries.questionKey, context: entries.contextId, team: entries.teamId })
    .from(entries).where(eq(entries.tournamentId, id));
  if (used.length) {
    const [doc] = await tx.select({ value: tournamentState.value }).from(tournamentState)
      .where(and(eq(tournamentState.tournamentId, id), eq(tournamentState.key, "scoringPlan")));
    const original = planSchema.safeParse(doc?.value);
    if (!original.success) throw new ApiError(409, "The original scoring plan is unavailable.");
    for (const attempt of used) {
      const findQuestion = (p: Plan) => p.rounds.find(r => r.id === attempt.round)?.questions.find(q => q.id === attempt.question);
      const before = findQuestion(original.data);
      const after = findQuestion(plan);
      if (!before || !after || before.minPoints !== after.minPoints || before.maxPoints !== after.maxPoints) {
        throw new ApiError(409, "A recorded question and its points limits must be retained.");
      }
      const oldRoster = original.data.rosters.find(r => r.id === attempt.context);
      if (oldRoster) {
        const next = plan.rosters.find(r => r.id === oldRoster.id);
        if (!next || next.roomId !== oldRoster.roomId || next.roundId !== attempt.round || !next.teamIds.includes(attempt.team) ||
            plan.rosters.some(r => r.id !== next.id && r.roundId === next.roundId && r.released && r.teamIds.includes(attempt.team))) {
          throw new ApiError(409, "A scored team must retain its original room roster for the round.");
        }
      }
    }
  }
  await tx.insert(tournamentState).values({ tournamentId: id, key: "scoringPlan", value: plan })
    .onConflictDoUpdate({ target: [tournamentState.tournamentId, tournamentState.key], set: { value: plan, updatedAt: new Date() } });
}

export async function verifyAttempt(tx: Db, id: string, roomId: string, attempt: {
  contextId: string; roundId: string; teamId: string; questionKey: string; points: number;
}) {
  const docs = await tx.select({ key: tournamentState.key, value: tournamentState.value }).from(tournamentState)
    .where(and(eq(tournamentState.tournamentId, id), inArray(tournamentState.key, ["scoringPlan", "config", "pairings"])));
  const value = (key: string) => docs.find(doc => doc.key === key)?.value;
  const plan = planSchema.safeParse(value("scoringPlan"));
  if (!plan.success) throw new ApiError(409, "Configure the scoring plan before submitting.");
  const config = normalizeConfig(value("config"));
  const round = plan.data.rounds.find(r => r.id === attempt.roundId);
  if (!round || !validRound(config, round)) throw new ApiError(422, "Round or question limits are unavailable.");
  const q = round.questions.find(q => q.id === attempt.questionKey);
  if (!q || attempt.points < q.minPoints || attempt.points > q.maxPoints) throw new ApiError(422, "Invalid question or points.");
  const [team] = await tx.select({ id: teams.id }).from(teams)
    .where(and(eq(teams.tournamentId, id), eq(teams.id, attempt.teamId))).for("key share");
  if (!team) throw new ApiError(422, "Team is outside this tournament.");
  if (isPointsFormat(config)) {
    const roster = plan.data.rosters.find(r => r.id === attempt.contextId);
    if (!roster?.released || roster.roomId !== roomId) throw new ApiError(409, "Room roster is unavailable or unreleased.");
    const stage = config.format === "league" ? "league" : "quiz";
    if (roster.roundId !== round.id || !config.rounds.some(r => r.id === round.id && r.stage === stage) ||
        !roster.teamIds.includes(team.id)) throw new ApiError(422, "Team or round is outside this roster.");
  } else {
    const fixtures = normalizePairings(value("pairings")).filter(p => p.id === attempt.contextId);
    const fixture = fixtures[0];
    if (fixtures.length !== 1 || !fixture.released || fixture.roomId !== roomId) throw new ApiError(409, "Room fixture is unavailable or unreleased.");
    if (fixture.stage === "league" || fixture.stage === "quiz" || (config.format === "knockout" && fixture.stage === "preliminary") ||
        ![fixture.teamAId, fixture.teamBId].includes(team.id) ||
        !stageRoundsFor(config, fixture.stage, fixture.matchLabel).some(r => r.id === round.id)) {
      throw new ApiError(422, "Team or round is outside this fixture.");
    }
  }
  // Draw edits can give the same team another context in the same round.
  const scores = tournamentScoreEntries;
  const [total] = await tx.select({ points: sum(scores.points) }).from(scores).where(and(
    eq(scores.tournamentId, id), eq(scores.teamId, team.id), eq(scores.roundId, round.id),
    inArray(scores.status, ["approved", "pending"]),
  ));
  if (Number(total.points) + attempt.points > roundRange(config, round.id).max) {
    throw new ApiError(409, "The submission would exceed this team's round limit.");
  }
}
