import { requireUser, route } from "@/lib/api";
import { db } from "@/lib/db";
import { ownGame } from "@/lib/quiz/api-helpers";
import { hostView } from "@/lib/quiz/engine";

// Everything the big screen shows for one of the host's games
export const GET = route<RouteContext<"/api/host/games/[id]">>(async (_, { params }) => {
  const user = await requireUser();
  return hostView(db(), await ownGame(db(), (await params).id, user.userId));
});
