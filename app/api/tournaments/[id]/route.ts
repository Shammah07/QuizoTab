import { route } from "@/lib/api";
import { transactionDb } from "@/lib/db";
import { spectatorView } from "@/lib/tournament/spectator";

export const GET = route<RouteContext<"/api/tournaments/[id]">>(async (request, { params }) => {
  const query = request.nextUrl.searchParams;
  return spectatorView(transactionDb(), (await params).id, query.get("section") ?? "overview", query.get("room") ?? undefined);
});
