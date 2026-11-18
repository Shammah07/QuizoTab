import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { hostTournament } from "@/lib/tournament/api-helpers";
import { hostView, resetTournament } from "@/lib/tournament/store";

// Clears every team, score and pairing. Settings, rooms, judges and sharing are kept.
export const POST = route<RouteContext<"/api/host/tournaments/[id]/reset">>(async (_, { params }) => {
  const { tournament } = await hostTournament(db(), (await params).id);
  await resetTournament(db(), tournament.id);
  return hostView(db(), tournament);
});
