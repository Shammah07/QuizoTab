import { ClipboardList, Shuffle, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveDot } from "@/components/host/bits";
import { HostFrame } from "@/components/host/frame";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { FORMATS, formatDateRange, formatOf, todayStatus, tournamentSubtitle, tournamentTitle } from "@/lib/tournament/rules";
import { looksLikeId, readState, tournamentById } from "@/lib/tournament/store";

// The public page of a tournament (was the tournament app's landing screen, host/?tournament=ID):
// the audience picks the standings or the draw; judges go on to their portal
export async function generateMetadata({ params }: PageProps<"/host/t/[id]">): Promise<Metadata> {
  const tournament = await tournamentById(db(), (await params).id);
  return { title: tournament ? tournamentTitle(tournament) : "Tournament" };
}

export default async function AudiencePage({ params }: PageProps<"/host/t/[id]">) {
  const { id } = await params;
  if (!looksLikeId(id)) notFound();
  const tournament = await tournamentById(db(), id);
  if (!tournament) notFound();
  const { config, sharing } = await readState(db(), id);
  const session = await getSession();
  const isHost = session?.userId === tournament.ownerId;
  const cardClass = "group flex items-start justify-between gap-4 border border-line bg-panel p-6 transition-colors hover:border-live";

  return (
    <HostFrame links={isHost ? [{ href: `/host/${id}`, label: "Dashboard" }, { href: "/", label: "Back to QuizoTab" }] : [{ href: "/", label: "Back to QuizoTab" }]}>
      <header className="mb-8">
        <LiveDot status={todayStatus(config)} />
        <h1 className="mt-2 text-[clamp(32px,5vw,52px)] leading-[1.05] font-extrabold break-words text-white">{tournamentTitle(tournament, config.name)}</h1>
        <p className="mt-3 text-muted">{[tournamentSubtitle(tournament), FORMATS[formatOf(config)].label, formatDateRange(config.startDate, config.endDate)].filter(Boolean).join(" · ")}</p>
        {sharing.about && <p className="mt-4 max-w-[62ch] text-[17px] leading-relaxed text-text">{sharing.about}</p>}
      </header>

      <div className="flex flex-col gap-3">
        {sharing.showStandings && (
          <Link href={`/host/t/${id}/standings`} className={cardClass}>
            <span>
              <span className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.18em] text-amber uppercase">
                <Trophy aria-hidden="true" className="size-4" /> Leaderboard
              </span>
              <span className="block text-2xl font-bold text-white">See the standings</span>
              <span className="mt-1 block text-sm text-muted">Live scores, open to everyone. No sign-in needed.</span>
            </span>
          </Link>
        )}
        {sharing.showDraw && FORMATS[formatOf(config)].hasDraw && (
          <Link href={`/host/t/${id}/draw`} className={cardClass}>
            <span>
              <span className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.18em] text-live uppercase">
                <Shuffle aria-hidden="true" className="size-4" /> Current draw
              </span>
              <span className="block text-2xl font-bold text-white">See the draw</span>
              <span className="mt-1 block text-sm text-muted">The latest draw released by the host, with rooms.</span>
            </span>
          </Link>
        )}
        <Link href={`/host/${id}/judge`} className={cardClass}>
          <span>
            <span className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.18em] text-live uppercase">
              <ClipboardList aria-hidden="true" className="size-4" /> Judge portal
            </span>
            <span className="block text-2xl font-bold text-white">Register teams and enter scores</span>
            <span className="mt-1 block text-sm text-muted">Needs the judge login the host gave you.</span>
          </span>
        </Link>
      </div>
    </HostFrame>
  );
}
