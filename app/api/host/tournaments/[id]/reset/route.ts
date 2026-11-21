import { route } from "@/lib/api";
import { db, transactionDb } from "@/lib/db";
import { withRoomOwner } from "@/lib/tournament/room-access";
import { hostTournament } from "@/lib/tournament/api-helpers";
import { hostView, resetTournament } from "@/lib/tournament/store";

// Clears every team, score and pairing. Settings, rooms, judges and sharing are kept.
export const POST = route<RouteContext<"/api/host/tournaments/[id]/reset">>(async (_, { params }) => {
  const { user, tournament } = await hostTournament(db(), (await params).id);
  await withRoomOwner(transactionDb(), tournament.id, user, tx => resetTournament(tx, tournament.id));
  return hostView(db(), tournament);
});
