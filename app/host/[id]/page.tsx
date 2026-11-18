import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Dashboard } from "@/components/host/dashboard";
import { isDashboardTab } from "@/components/host/dashboard-tabs";
import { HostFrame } from "@/components/host/frame";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { audienceUrl, judgeUrl } from "@/lib/tournament/links";
import { hostView, looksLikeId, ownTournament } from "@/lib/tournament/store";

export const metadata: Metadata = { title: "Tournament dashboard" };

// The host's dashboard for one of their tournaments
export default async function TournamentPage({ params, searchParams }: PageProps<"/host/[id]">) {
  const { id } = await params;
  if (!looksLikeId(id)) notFound();
  const session = await getSession();
  if (!session) redirect(`/login?notice=host-login&next=/host/${id}`);

  const tournament = await ownTournament(db(), id, session.userId);
  if (!tournament) notFound();

  const { tab } = await searchParams;
  const view = await hostView(db(), tournament);

  return (
    <HostFrame wide>
      <Dashboard initial={view} initialTab={isDashboardTab(tab) ? tab : "overview"} audienceUrl={audienceUrl(id)} judgeUrl={judgeUrl(id)} />
    </HostFrame>
  );
}
