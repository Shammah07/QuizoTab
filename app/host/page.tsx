import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HostFrame } from "@/components/host/frame";
import { TournamentList } from "@/components/host/tournament-list";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listOwnTournaments, looksLikeId } from "@/lib/tournament/store";

export const metadata: Metadata = { title: "Host a tournament" };

// The host's tournaments: open one or set up a new one (was host/index.php booting the tournament app).
// Old audience and judge links (host/?tournament=ID, &judge=1) are sent to their new pages.
export default async function HostPage({ searchParams }: PageProps<"/host">) {
  const params = await searchParams;
  if (looksLikeId(params.tournament)) {
    if (params.judge === "1") redirect(`/host/${params.tournament}/judge`);
    redirect(`/host/t/${params.tournament}${params.view === "standings" || params.view === "draw" ? `/${params.view}` : ""}`);
  }

  const session = await getSession();
  if (!session) redirect("/login?notice=host-login&next=/host");
  if (session.role === "judge") {
    return (
      <HostFrame>
        <h1 className="text-[clamp(30px,4vw,44px)] leading-[1.05] font-extrabold text-white">Judge account</h1>
        <p className="mt-4 max-w-[62ch] text-muted">Your account is a judge login. Open the judge link the host sent you to register teams and enter scores. Hosting a tournament needs a host account.</p>
      </HostFrame>
    );
  }

  const tournaments = await listOwnTournaments(db(), session.userId);

  return (
    <HostFrame>
      <h1 className="text-[clamp(34px,5vw,52px)] leading-[1.05] font-extrabold text-white">Your tournaments</h1>
      <p className="mt-4 mb-8 max-w-[62ch] text-[17px] leading-relaxed text-muted">
        Set the rounds and rules, register the teams, add judges and rooms. Judges score from their phones, you approve every result, the next draw is made for you, and the standings update for the audience.
      </p>
      {params.deleted === "1" && (
        <Alert type="success" className="mb-6">
          The tournament was deleted.
        </Alert>
      )}
      <ButtonLink href="/host/new">New tournament</ButtonLink>
      <div className="mt-8">
        <TournamentList tournaments={tournaments} />
      </div>
    </HostFrame>
  );
}
