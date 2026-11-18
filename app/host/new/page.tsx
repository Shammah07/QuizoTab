import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CreateTournament } from "@/components/host/create-tournament";
import { HostFrame } from "@/components/host/frame";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ownTournament, readState } from "@/lib/tournament/store";

export const metadata: Metadata = { title: "New tournament" };

// Set up a tournament. ?copy=ID starts from the rounds and rules of one of the host's own tournaments.
export default async function NewTournamentPage({ searchParams }: PageProps<"/host/new">) {
  const session = await getSession();
  if (!session) redirect("/login?notice=host-login&next=/host/new");
  if (session.role === "judge") redirect("/host");

  const { copy } = await searchParams;
  const source = await ownTournament(db(), copy, session.userId);
  const template = source ? (await readState(db(), source.id)).config : null;

  return (
    <HostFrame>
      <CreateTournament template={template} templateName={source?.name} />
    </HostFrame>
  );
}
