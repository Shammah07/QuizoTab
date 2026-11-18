import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HostFrame } from "@/components/host/frame";
import { Standings } from "@/components/host/public-views";
import { db } from "@/lib/db";
import { looksLikeId, publicView, tournamentById } from "@/lib/tournament/store";

export const metadata: Metadata = { title: "Standings" };

// The live standings of a tournament, open to everyone
export default async function StandingsPage({ params }: PageProps<"/host/t/[id]/standings">) {
  const { id } = await params;
  if (!looksLikeId(id)) notFound();
  const tournament = await tournamentById(db(), id);
  if (!tournament) notFound();
  const view = await publicView(db(), tournament);
  if (!view.sharing.showStandings) notFound();

  return (
    <HostFrame links={[{ href: `/host/t/${id}`, label: tournament.name }, { href: "/", label: "Back to QuizoTab" }]}>
      <Standings initial={view} />
    </HostFrame>
  );
}
