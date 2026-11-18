import "server-only";
import { ApiError, requireUser } from "@/lib/api";
import type { Db } from "@/lib/db";
import { isJudgeFor, ownTournament, tournamentById } from "./store";

// Lookups the tournament API routes share

const LOGIN_MESSAGE = "Log in to QuizoTab to host a tournament.";

// A tournament the logged-in host owns. Someone else's looks the same as one that doesn't exist.
export async function hostTournament(db: Db, id: unknown) {
  const user = await requireUser(LOGIN_MESSAGE);
  const tournament = await ownTournament(db, id, user.userId);
  if (!tournament) throw new ApiError(404, "Tournament not found.");
  return { user, tournament };
}

// A tournament the logged-in person may judge: its owner, or a judge the owner added
export async function judgedTournament(db: Db, id: unknown) {
  const user = await requireUser("Log in with your judge account first.");
  const tournament = await tournamentById(db, id);
  if (!tournament) throw new ApiError(404, "Tournament not found.");
  const isHost = tournament.ownerId === user.userId;
  if (!isHost && !(await isJudgeFor(db, tournament.id, user.userId))) {
    throw new ApiError(403, "You aren't a judge for this tournament. Open the judge link the host sent you.");
  }
  return { user, tournament, isHost };
}

// Any tournament, for the audience pages
export async function anyTournament(db: Db, id: unknown) {
  const tournament = await tournamentById(db, id);
  if (!tournament) throw new ApiError(404, "Tournament not found.");
  return tournament;
}
