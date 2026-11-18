import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HostFrame } from "@/components/host/frame";
import { PublicDraw } from "@/components/host/public-views";
import { db } from "@/lib/db";
import { looksLikeId, publicView, tournamentById } from "@/lib/tournament/store";

export const metadata: Metadata = { title: "Draw" };

// The latest released draw of a tournament, open to everyone
export default async function DrawPage({ params }: PageProps<"/host/t/[id]/draw">) {
  const { id } = await params;
  if (!looksLikeId(id)) notFound();
  const tournament = await tournamentById(db(), id);
  if (!tournament) notFound();
  const view = await publicView(db(), tournament);
  if (!view.sharing.showDraw) notFound();

  return (
    <HostFrame links={[{ href: `/host/t/${id}`, label: tournament.name }, { href: "/", label: "Back to QuizoTab" }]}>
      <PublicDraw initial={view} />
    </HostFrame>
  );
}
