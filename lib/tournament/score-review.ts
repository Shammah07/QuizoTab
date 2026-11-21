import "server-only";
import { and, asc, eq, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import type { Session } from "@/lib/auth/session";
import type { Db } from "@/lib/db";
import { teams, tournamentScoreEntries as scores, tournamentScoreEvents as events, users } from "@/lib/db/schema";
import { withScoringRoom } from "./room-access";
import { verifyAttempt } from "./scoring-plan";
import { STAGE_LABELS } from "./rules";
import { readState } from "./store";

const uuid = z.uuid().transform(v => v.toLowerCase());
const reason = z.string().trim().min(3).max(1000).regex(/[\p{L}\p{N}]/u);
const decision = z.discriminatedUnion("decision", [
  z.strictObject({ scoreId: uuid, decision: z.literal("approve") }),
  z.strictObject({ scoreId: uuid, decision: z.literal("reject"), reason }),
]);
const correction = z.strictObject({
  scoreId: uuid, points: z.int().min(0).max(100000), reason, clientRequestId: uuid,
});

function roomScope(tournamentId: string, roomId: string) {
  return and(eq(scores.tournamentId, tournamentId), eq(scores.roomId, roomId));
}

async function roomScore(tx: Db, tournamentId: string, roomId: string, scoreId: string) {
  const [score] = await tx.select().from(scores).where(and(roomScope(tournamentId, roomId), eq(scores.id, scoreId)));
  if (!score) throw new ApiError(404, "Score not found in this room.");
  return score;
}

export function pendingRoomScores(db: Db, id: string, roomId: string, session: Session | null) {
  return withScoringRoom(db, id, roomId, session, "room_host", async tx => {
    const prior = alias(scores, "prior_score");
    const queue = await tx.select({
      scoreId: scores.id, teamId: teams.id, teamName: teams.name, contextId: scores.contextId,
      roundId: scores.roundId, questionKey: scores.questionKey, points: scores.points,
      judgeUserId: users.id, judgeName: users.name, submittedAt: scores.createdAt, status: scores.status,
      revision: scores.revision, correctionOf: scores.correctionOf, previousPoints: prior.points, reason: scores.reason,
    }).from(scores).innerJoin(teams, eq(teams.id, scores.teamId)).innerJoin(users, eq(users.id, scores.judgeUserId))
      .leftJoin(prior, eq(prior.id, scores.correctionOf))
      .where(and(roomScope(id, roomId), eq(scores.status, "pending"))).orderBy(asc(scores.createdAt), asc(scores.id));
    if (!queue.length) return [];
    const { config, pairings, rooms } = await readState(tx, id);
    const roundNames = new Map(config.rounds.map(r => [r.id, r.name]));
    const fixtures = new Map(pairings.map(p => [p.id, p.matchLabel || STAGE_LABELS[p.stage]]));
    const roomName = rooms.find(r => r.id === roomId)?.name;
    return queue.map(row => ({ ...row, roundName: roundNames.get(row.roundId) ?? row.roundId,
      contextName: (config.format === "league" || config.format === "quiz-night" ? roomName : fixtures.get(row.contextId)) ?? row.contextId }));
  });
}

export function decideRoomScore(db: Db, id: string, roomId: string, session: Session | null, input: unknown) {
  return withScoringRoom(db, id, roomId, session, "room_host", async (tx, host, active) => {
    const parsed = decision.safeParse(input);
    if (!parsed.success) throw new ApiError(400, "Provide a score ID, decision and a reason for rejection.");
    const data = parsed.data;
    const entry = await roomScore(tx, id, roomId, data.scoreId);
    if (entry.judgeUserId === host.userId) throw new ApiError(403, "Another room host must review your submission.");
    if (!active || entry.status !== "pending") throw new ApiError(409, "Only a pending score in an active tournament can be reviewed.");
    await verifyAttempt(tx, id, roomId, entry);
    const status = data.decision === "approve" ? "approved" : "rejected";
    if (entry.correctionOf && status === "approved") {
      const [original] = await tx.update(scores).set({ status: "superseded" }).where(and(
        roomScope(id, roomId), eq(scores.id, entry.correctionOf), eq(scores.status, "approved"),
      )).returning({ id: scores.id });
      if (!original) throw new ApiError(409, "The original award is no longer approved.");
      await tx.insert(events).values({ scoreEntryId: original.id, eventType: "superseded", actorUserId: host.userId,
        details: { replacementId: entry.id } });
    }
    const [result] = await tx.update(scores).set({
      status, reviewerUserId: host.userId, reviewedAt: sql`clock_timestamp()`,
      // A correction keeps its proposal reason. Its rejection reason belongs to the decision event.
      ...(data.decision === "reject" && !entry.correctionOf ? { reason: data.reason } : {}),
    }).where(and(roomScope(id, roomId), eq(scores.id, entry.id), eq(scores.status, "pending")))
      .returning({ scoreId: scores.id, status: scores.status, reviewedAt: scores.reviewedAt });
    if (!result) throw new ApiError(409, "The score has already been reviewed.");
    await tx.insert(events).values({ scoreEntryId: entry.id, actorUserId: host.userId, eventType: status,
      details: data.decision === "reject" ? { reason: data.reason } : {} });
    return result;
  });
}

export function proposeCorrection(db: Db, id: string, roomId: string, session: Session | null, input: unknown) {
  return withScoringRoom(db, id, roomId, session, "judge", async (tx, judge, active) => {
    const parsed = correction.safeParse(input);
    if (!parsed.success) throw new ApiError(400, "Provide the approved score ID, corrected points, reason and request ID.");
    const data = parsed.data;
    const [retry] = await tx.select().from(scores).where(and(eq(scores.tournamentId, id),
      eq(scores.judgeUserId, judge.userId), eq(scores.clientRequestId, data.clientRequestId)));
    if (retry) {
      if (retry.roomId !== roomId || retry.correctionOf !== data.scoreId || retry.points !== data.points || retry.reason !== data.reason) {
        throw new ApiError(409, "Request ID was already used for a different submission.");
      }
      return { created: false, scoreId: retry.id, status: "pending" as const };
    }
    const original = await roomScore(tx, id, roomId, data.scoreId);
    if (!active || original.status !== "approved") throw new ApiError(409, "Only the current approved score can be corrected.");
    if (original.points === data.points) throw new ApiError(422, "Corrected points must differ from the approved award.");
    const { contextId, teamId, roundId, questionKey } = original;
    const attempt = { contextId, teamId, roundId, questionKey };
    await verifyAttempt(tx, id, roomId, { ...attempt, points: data.points });
    // Rejected revisions are historical too. Their numbers cannot be reused.
    const [last] = await tx.select({ revision: max(scores.revision) }).from(scores).where(and(
      eq(scores.tournamentId, id), eq(scores.contextId, contextId), eq(scores.teamId, teamId),
      eq(scores.roundId, roundId), eq(scores.questionKey, questionKey),
    ));
    const [entry] = await tx.insert(scores).values({ ...attempt, tournamentId: id, roomId, judgeUserId: judge.userId,
      correctionOf: original.id, points: data.points, reason: data.reason, clientRequestId: data.clientRequestId,
      revision: (last.revision ?? original.revision) + 1,
    }).onConflictDoNothing().returning({ id: scores.id });
    if (!entry) throw new ApiError(409, "This attempt already has a pending revision.");
    await tx.insert(events).values({ scoreEntryId: entry.id, actorUserId: judge.userId, eventType: "submitted",
      details: { correctionOf: original.id, reason: data.reason } });
    return { created: true, scoreId: entry.id, status: "pending" as const };
  });
}
