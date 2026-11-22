import { ApiError, requireUser, route } from "@/lib/api";
import { db, transactionDb } from "@/lib/db";
import { ownGame } from "@/lib/quiz/api-helpers";
import { gameById, hostView } from "@/lib/quiz/engine";
import { sendScores } from "@/lib/quiz/tournament-link";

// Sends a finished game's team results to its tournament round, to wait for approval there
export const POST = route<RouteContext<"/api/host/games/[id]/send-scores">>(async (_, { params }) => {
  const user = await requireUser();
  const game = await ownGame(db(), (await params).id, user.userId);
  const error = await sendScores(transactionDb(), game);
  if (error) throw new ApiError(409, error);
  return hostView(db(), (await gameById(db(), game.id))!);
});
