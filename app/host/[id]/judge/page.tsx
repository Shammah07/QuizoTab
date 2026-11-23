import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { HostFrame } from "@/components/host/frame";
import { JudgeDashboard } from "@/components/host/judge-dashboard";
import { ButtonLink } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isLegacyJudgeTournament, isJudgeFor, judgeView, looksLikeId, tournamentById } from "@/lib/tournament/store";

export const metadata: Metadata = { title: "Judge portal" };

// The judge portal of a tournament: for the judges the host added, and for the host themself
export default async function JudgePage({ params }: PageProps<"/host/[id]/judge">) {
  const { id } = await params;
  if (!looksLikeId(id)) notFound();
  const session = await getSession();
  if (!session) redirect(`/login?notice=judge-login&next=/host/${id}/judge`);

  const tournament = await tournamentById(db(), id);
  if (!tournament) notFound();
  if (!await isLegacyJudgeTournament(db(), id)) redirect("/staff");
  const isHost = tournament.ownerId === session.userId;
  const links = [
    { href: `/host/t/${id}`, label: "Audience page" },
    { href: "/", label: "Back to QuizoTab" },
  ];

  if (!isHost && !(await isJudgeFor(db(), id, session.userId))) {
    return (
      <HostFrame links={links}>
        <h1 className="text-[clamp(30px,4vw,44px)] leading-[1.05] font-extrabold text-white">Not a judge here</h1>
        <p className="mt-4 mb-8 max-w-[62ch] text-muted">
          You&apos;re logged in as {session.name}, but this account isn&apos;t a judge for {tournament.name}. Open the judge link the host sent you, with the email and password they gave you.
        </p>
        <ButtonLink href="/" variant="line">
          Back to QuizoTab
        </ButtonLink>
      </HostFrame>
    );
  }

  return (
    <HostFrame links={isHost ? [{ href: `/host/${id}`, label: "Dashboard" }, ...links] : links}>
      <JudgeDashboard initial={await judgeView(db(), tournament)} judgeName={session.name} isHost={isHost} />
    </HostFrame>
  );
}
