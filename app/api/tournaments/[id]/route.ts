import { route } from "@/lib/api";
import { db } from "@/lib/db";
import { anyTournament } from "@/lib/tournament/api-helpers";
import { publicView } from "@/lib/tournament/store";

// What the audience sees: the rules, teams, approved scores and released pairings. Open to everyone.
export const GET = route<RouteContext<"/api/tournaments/[id]">>(async (_, { params }) => {
  return publicView(db(), await anyTournament(db(), (await params).id));
});
