import { body, route, unwrap } from "@/lib/api";
import { db } from "@/lib/db";
import { hostTournament } from "@/lib/tournament/api-helpers";
import { guestCodeFor, newGuestCode, readState, saveSharing } from "@/lib/tournament/store";

// Lists the tournament publicly and manages the guest code the audience enters.
// { action: "save", listed, showStandings, showDraw, about } or { action: "new_code" }
export const POST = route<RouteContext<"/api/host/tournaments/[id]/sharing">>(async (request, { params }) => {
  const { tournament } = await hostTournament(db(), (await params).id);
  const data = await body(request);
  if (data.action === "new_code") return { sharing: (await readState(db(), tournament.id)).sharing, code: await newGuestCode(db(), tournament.id) };
  return { sharing: unwrap(await saveSharing(db(), tournament.id, data)), code: await guestCodeFor(db(), tournament.id) };
});
