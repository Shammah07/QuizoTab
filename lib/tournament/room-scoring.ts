import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import type { Session } from "@/lib/auth/session";
import type { Db } from "@/lib/db";
import { tournamentScoreEntries as entries, tournamentScoreEvents as events, tournaments } from "@/lib/db/schema";
import { authenticated, requireRoomJudge } from "./room-access";
import { verifyAttempt } from "./scoring-plan";
import { looksLikeId } from "./store";

const id = z.string().min(1).max(80);
const uuid = z.uuid().transform(v => v.toLowerCase());
const submission = z.strictObject({
  contextId: id, teamId: uuid, roundId: id, questionKey: id,
  points: z.int().nonnegative().max(100000), clientRequestId: uuid,
});

export async function submitRoomScore(db: Db, tournamentId: string, roomId: string, session: Session | null, input: unknown) {
  const judge = authenticated(session);
  if (!looksLikeId(tournamentId)) throw new ApiError(404, "Tournament not found.");
  return db.transaction(async tx => {
    const [tournament] = await tx.select({ status: tournaments.status }).from(tournaments)
      .where(eq(tournaments.id, tournamentId)).for("update");
    if (!tournament) throw new ApiError(404, "Tournament not found.");
    await requireRoomJudge(tx, tournamentId, roomId, judge);
    const parsed = submission.safeParse(input);
    if (!parsed.success) throw new ApiError(400, "Invalid score submission.");
    const data = parsed.data;
    const [prior] = await tx.select().from(entries).where(and(eq(entries.tournamentId, tournamentId),
      eq(entries.judgeUserId, judge.userId), eq(entries.clientRequestId, data.clientRequestId)));
    if (prior) {
      if (prior.roomId !== roomId || prior.contextId !== data.contextId || prior.teamId !== data.teamId ||
          prior.roundId !== data.roundId || prior.questionKey !== data.questionKey || prior.points !== data.points) {
        throw new ApiError(409, "Request ID was already used for a different submission.");
      }
      return { created: false, scoreId: prior.id, status: "pending" as const };
    }
    if (tournament.status !== "active") throw new ApiError(409, "Tournament is not active.");
    await verifyAttempt(tx, tournamentId, roomId, data);
    const [score] = await tx.insert(entries).values({ ...data, tournamentId, roomId, judgeUserId: judge.userId })
      .onConflictDoNothing().returning({ id: entries.id });
    if (!score) throw new ApiError(409, "This question attempt already has a submission.");
    await tx.insert(events).values({ scoreEntryId: score.id, actorUserId: judge.userId, eventType: "submitted" });
    return { created: true, scoreId: score.id, status: "pending" as const };
  });
}
