import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { HostFrame } from "@/components/host/frame";
import { RoomWorkspace } from "@/components/host/room-workspace";
export default async function StaffRoomPage({params}:PageProps<"/staff/[id]/[roomId]/[role]">) {
  const {id,roomId,role} = await params;
  if (role !== "judge" && role !== "room_host") notFound();
  const session = await getSession();
  if (!session) redirect("/login?next="+encodeURIComponent(`/staff/${encodeURIComponent(id)}/${encodeURIComponent(roomId)}/${role}`));
  const base = `/api/tournaments/${encodeURIComponent(id)}/rooms/${encodeURIComponent(roomId)}`;
  return <HostFrame links={[{href:"/staff",label:"My room assignments"},{href:"/host",label:"My tournaments"}]}>
    <RoomWorkspace key={JSON.stringify([base,role,session.userId])} base={base} role={role} userId={session.userId}/></HostFrame>;
}
