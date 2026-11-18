import { body, requireUser, route, unwrap } from "@/lib/api";
import { db } from "@/lib/db";
import { ownGame } from "@/lib/quiz/api-helpers";
import { advance, hostView } from "@/lib/quiz/engine";

// The host moves the game on: { to: "start" | "reveal" | "next" | "end" }
export const POST = route<RouteContext<"/api/host/games/[id]/advance">>(async (request, { params }) => {
  const user = await requireUser();
  const game = await ownGame(db(), (await params).id, user.userId);
  const moved = unwrap(await advance(db(), game, String((await body(request)).to ?? "")), 409);
  return hostView(db(), moved);
});
