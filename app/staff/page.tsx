import { redirect } from "next/navigation";
import { HostFrame } from "@/components/host/frame";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { staffAssignments } from "@/lib/tournament/staff-workspace";
export default async function StaffPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/staff");
  const assignments = await staffAssignments(db(),session);
  return <HostFrame><h1 className="text-3xl font-bold">My room assignments</h1>
    {assignments.length ? <ul className="mt-5 grid gap-3 sm:grid-cols-2">{assignments.map(a=><li key={[a.id,a.roomId,a.role].join("/")}>
      <a className="block rounded border border-line p-4" href={`/staff/${a.id}/${encodeURIComponent(a.roomId)}/${a.role}`}>
        <strong>{a.room} · {a.name}</strong><div>{a.role==="judge" ? "Judge" : "Room host"} · {a.status}</div></a></li>)}</ul> :
      <p className="mt-4">You have no active room assignments.</p>}</HostFrame>;
}
