import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { listedTournaments, validCode } from "@/lib/tournament/spectator";
import { HostFrame } from "@/components/host/frame";

export const dynamic = "force-dynamic";
export default async function TournamentDirectory({ searchParams }: PageProps<"/host/t">) {
  const { code } = await searchParams;
  if (code !== undefined) {
    if (typeof code !== "string" || !validCode(code.trim())) notFound();
    redirect("/host/t/" + code.trim().toUpperCase());
  }
  const listed = await listedTournaments(db());
  return <HostFrame links={[{href:"/",label:"QuizoTab"}]}>
    <h1 className="mb-4 text-3xl font-bold">Watch a tournament</h1>
    <form className="mb-6 flex gap-3"><label>Guest code <input className="border px-2" name="code" required maxLength={6} /></label><button>Open tournament</button></form>
    <ul>{listed.map(t => <li key={t.code}><a className="underline" href={"/host/t/"+t.code}>{t.name} · {t.code}</a></li>)}</ul>
  </HostFrame>;
}
