import { ApiError, route } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { transactionDb } from "@/lib/db";
import { staffWorkspace } from "@/lib/tournament/staff-workspace";
export const GET = route<RouteContext<"/api/tournaments/[id]/rooms/[roomId]/workspace">>(async (req,{params})=>{
  const {id,roomId} = await params;
  const role = req.nextUrl.searchParams.get("role");
  if (role !== "judge" && role !== "room_host") throw new ApiError(400,"Choose an assigned role.");
  return staffWorkspace(transactionDb(),id,roomId,await getSession(),role);
});
