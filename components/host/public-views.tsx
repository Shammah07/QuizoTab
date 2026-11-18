"use client";

import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/quiz/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  computeStandings,
  currentPairings,
  formatOf,
  groupRoundsForDisplay,
  isPointsFormat,
  matchWinnerDetail,
  preliminaryScoresApproved,
  preliminarySeedOrder,
  roundsForPairings,
  STAGE_LABELS,
  todayStatus,
  tournamentTitle,
} from "@/lib/tournament/rules";
import type { PublicView } from "@/lib/tournament/store";
import { CopyButton, EmptyNote, Eyebrow, fieldClass, LiveDot, panelClass, payload } from "./bits";
import { BracketStageBlock, KnockoutBracket } from "./bracket";

// What the audience sees: the live standings and the released draw. Both refresh every few seconds.

const REFRESH_MS = 6000;

// Keeps the public view fresh
function useLiveView(initial: PublicView) {
  const [view, setView] = useState(initial);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const load = useCallback(async () => {
    const result = await api<PublicView>(`/api/tournaments/${initial.tournament.id}`);
    if (!result.ok) return;
    setView(payload(result));
    setUpdatedAt(new Date());
  }, [initial.tournament.id]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);
  return { view, updatedAt };
}

function Heading({ view, updatedAt, subtitle }: { view: PublicView; updatedAt: Date | null; subtitle: string }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-4">
        <LiveDot status={todayStatus(view.config)} />
        {updatedAt && <span className="font-mono text-[11px] text-muted">updated {updatedAt.toLocaleTimeString()}</span>}
      </div>
      <h1 className="mt-2 text-[clamp(28px,4vw,40px)] leading-[1.05] font-extrabold break-words text-white">{tournamentTitle(view.tournament, view.config.name)}</h1>
      <p className="mt-2 text-muted">{subtitle}</p>
    </div>
  );
}

export function Standings({ initial }: { initial: PublicView }) {
  const { view, updatedAt } = useLiveView(initial);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"preliminary" | "break">("preliminary");
  const [expanded, setExpanded] = useState<string | null>(null);
  const { config, teams, scores, pairings } = view;
  const format = formatOf(config);
  const pointsFormat = isPointsFormat(config);

  const publicRounds = roundsForPairings(config, pairings, true);
  const preliminaryRounds = config.rounds.filter((round) => round.stage === "preliminary");
  const breakRounds = publicRounds.filter((round) => round.stage !== "preliminary");
  const breakStarted = breakRounds.length > 0 && preliminaryScoresApproved(config, scores);
  const displayMode = mode === "break" && breakStarted ? "break" : "preliminary";
  // Quiz nights and leagues: one table over every round. Knockout cup: points scored so far in the cup.
  const tableRounds = pointsFormat || format === "knockout" ? config.rounds : displayMode === "preliminary" ? preliminaryRounds : breakRounds;
  const all = pointsFormat || format === "knockout" ? computeStandings(teams, scores, tableRounds) : displayMode === "preliminary" ? computeStandings(teams, scores, preliminaryRounds) : computeStandings(preliminarySeedOrder(teams, config, scores), scores, breakRounds);
  const q = query.toLowerCase();
  const standings = all.filter((t) => t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
  const copyText = `${tournamentTitle(view.tournament, config.name)} — Standings\n\n${standings.map((t, i) => `${i + 1}. ${t.name} — ${t.total}`).join("\n")}`;
  const medal = ["bg-amber text-studio", "bg-[#c0c4cc] text-studio", "bg-[#d9a066] text-studio"];

  return (
    <div>
      <Heading view={view} updatedAt={updatedAt} subtitle="Live standings. Only scores the host has approved are counted." />

      <div className="relative mb-4">
        <Search aria-hidden="true" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by team or category" aria-label="Search teams" className={cn(fieldClass, "pl-10")} />
      </div>

      {format === "championship" && breakStarted && (
        <div className="mb-5 flex gap-2">
          <Button variant={displayMode === "preliminary" ? "neon" : "line"} size="sm" className="flex-1" onClick={() => setMode("preliminary")}>
            Preliminary rounds
          </Button>
          <Button variant={displayMode === "break" ? "neon" : "line"} size="sm" className="flex-1" onClick={() => setMode("break")}>
            Break rounds
          </Button>
        </div>
      )}

      {format === "knockout" && (
        <div className="mb-6">
          <KnockoutBracket config={config} teams={teams} scores={scores} pairings={pairings} />
          <Eyebrow className="mt-6 mb-2">Points scored so far</Eyebrow>
        </div>
      )}

      {standings.length === 0 ? (
        <EmptyNote>{teams.length === 0 ? "No teams registered yet. Check back once the teams are in." : "No teams match."}</EmptyNote>
      ) : (
        <ol className="flex flex-col gap-2">
          {standings.map((t, i) => {
            const open = expanded === t.id;
            return (
              <li key={t.id} className={cn(panelClass, i === 0 && t.total > 0 && "border-amber/60")}>
                <button type="button" onClick={() => setExpanded(open ? null : t.id)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-3 p-3.5 text-left">
                  <span className={cn("wide grid size-9 shrink-0 place-items-center font-display text-sm font-extrabold", i < 3 ? medal[i] : "bg-white/10 text-muted")}>{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-white">{t.name}</span>
                    {t.category && <span className="block text-xs text-muted">{t.category}</span>}
                  </span>
                  <span className="wide font-display text-xl font-extrabold text-white">{t.total}</span>
                  {open ? <ChevronUp aria-hidden="true" className="size-4 text-muted" /> : <ChevronDown aria-hidden="true" className="size-4 text-muted" />}
                </button>
                {open && (
                  <div className="flex flex-col gap-3 border-t border-line px-3.5 pt-3 pb-3.5">
                    {groupRoundsForDisplay(tableRounds).map((group) => (
                      <div key={group.key}>
                        <Eyebrow className="mb-1.5">{group.label}</Eyebrow>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {group.items.map((r) => (
                            <div key={r.id} className="bg-white/5 px-2.5 py-2">
                              <p className="truncate text-[11px] text-muted">{r.name}</p>
                              <p className="font-mono text-sm font-bold text-white">{t.byRound[r.id] ?? "—"}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {standings.length > 0 && <CopyButton text={copyText} label="Copy standings" className="mt-5" />}
    </div>
  );
}

export function PublicDraw({ initial }: { initial: PublicView }) {
  const { view, updatedAt } = useLiveView(initial);
  const { config, teams, scores, pairings, rooms, judges } = view;
  const latest = currentPairings(pairings, true);
  const label = latest[0] ? (latest[0].stage === "preliminary" ? `${STAGE_LABELS.preliminary} · ${latest[0].matchLabel}` : STAGE_LABELS[latest[0].stage]) : "No released draw";
  const roomLabel = (pairing: { roomId?: string | null }) => {
    const room = rooms.find((r) => r.id === pairing.roomId);
    if (!room) return "Room pending";
    const host = judges.find((j) => j.id === room.judgeId);
    const panel = room.panelistIds.map((id) => judges.find((j) => j.id === id)?.name).filter(Boolean);
    return `Room: ${room.name}${host ? ` · Host: ${host.name}` : ""}${panel.length ? ` · Panel: ${panel.join(", ")}` : ""}`;
  };

  return (
    <div>
      <Heading view={view} updatedAt={updatedAt} subtitle="Only the latest draw released by the host is shown." />
      {latest.length === 0 ? <EmptyNote>The host has not released a draw yet.</EmptyNote> : <BracketStageBlock title={label} teams={teams} rows={latest.map((p) => ({ ...p, ...matchWinnerDetail(p, config, scores) }))} roomLabel={roomLabel} />}
    </div>
  );
}
