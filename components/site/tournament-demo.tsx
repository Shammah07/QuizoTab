"use client";

import { ArrowDown, ArrowUp, Check, Monitor, RotateCcw, ShieldCheck, Smartphone } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const INITIAL_TEAMS = [
  { name: "Mwanza Owls", total: 2310 },
  { name: "Kilimanjaro High", total: 2240 },
  { name: "Dodoma Debaters", total: 2105 },
  { name: "Arusha Scholars", total: 1980 },
];

export type TournamentDemoLabels = {
  judge: string;
  admin: string;
  room: string;
  demoSteps: string;
  roomTitle: string;
  lowerKilimanjaro: string;
  raiseKilimanjaro: string;
  lowerMwanza: string;
  raiseMwanza: string;
  submitScore: string;
  approveScore: string;
  noScoresWaiting: string;
  waitingForJudge: string;
  semiFinalRoom: string;
  nextRound: string;
  points: string;
  round: string;
  submitted: string;
  approved: string;
};

type Phase = "judge" | "admin" | "room";

export function TournamentDemo({ labels }: { labels: TournamentDemoLabels }) {
  const [phase, setPhase] = useState<Phase>("judge");
  const [round, setRound] = useState(1);
  const [scores, setScores] = useState({ kilimanjaro: 25, mwanza: 30 });
  const [submitted, setSubmitted] = useState<typeof scores | null>(null);
  const [totals, setTotals] = useState(() => Object.fromEntries(INITIAL_TEAMS.map((team) => [team.name, team.total])));

  const standings = INITIAL_TEAMS.map((team) => ({ ...team, total: totals[team.name] ?? team.total })).sort((a, b) => b.total - a.total);
  const status: Record<Phase, string> = {
    judge: labels.judge,
    admin: labels.admin,
    room: labels.room,
  };

  function changeScore(team: keyof typeof scores, change: number) {
    setScores((current) => ({ ...current, [team]: Math.max(0, current[team] + change) }));
  }

  function submitScore() {
    setSubmitted(scores);
    setPhase("admin");
  }

  function approveScore() {
    if (!submitted) return;
    setTotals((current) => ({
      ...current,
      "Kilimanjaro High": (current["Kilimanjaro High"] ?? 0) + submitted.kilimanjaro,
      "Mwanza Owls": (current["Mwanza Owls"] ?? 0) + submitted.mwanza,
    }));
    setPhase("room");
  }

  function nextRound() {
    setRound((current) => current + 1);
    setScores({ kilimanjaro: 0, mwanza: 0 });
    setSubmitted(null);
    setPhase("judge");
  }

  return (
    <div>
      <ol aria-label={labels.demoSteps} className="mb-5 grid gap-2 sm:grid-cols-3">
        {(["judge", "admin", "room"] as const).map((step, index) => {
          const current = step === phase;
          const complete = index < (phase === "judge" ? 0 : phase === "admin" ? 1 : 2);
          return (
            <li
              key={step}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-3 border px-4 py-3 text-sm font-semibold transition-colors",
                current ? "border-live bg-live/10 text-white" : complete ? "border-good/40 bg-good/5 text-good" : "border-line bg-panel text-muted",
              )}
            >
              <span className="grid size-7 shrink-0 place-items-center border border-current text-xs tabular-nums">
                {complete ? <Check aria-hidden="true" className="size-4" /> : `0${index + 1}`}
              </span>
              {status[step]}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-label={labels.judge} className={cn("border bg-panel transition-colors", phase === "judge" ? "border-live" : "border-line")}>
          <div className="flex items-center gap-3 border-b border-line bg-panel-2 px-4 py-3">
            <Smartphone aria-hidden="true" className="size-5 text-live" />
            <div className="min-w-0">
              <h3 className="font-bold text-white">{labels.judge}</h3>
              <p className="text-xs text-muted">{labels.semiFinalRoom}</p>
            </div>
            <span className="ml-auto text-xs font-medium text-muted">{labels.round} {round}</span>
          </div>

          <div className="grid gap-3 p-4">
            {([
              ["Kilimanjaro High", "kilimanjaro", labels.lowerKilimanjaro, labels.raiseKilimanjaro],
              ["Mwanza Owls", "mwanza", labels.lowerMwanza, labels.raiseMwanza],
            ] as const).map(([name, key, lowerLabel, raiseLabel]) => (
              <div key={key} className="flex items-center justify-between gap-3 border border-line bg-studio-deep p-3">
                <span className="min-w-0 truncate text-sm font-semibold text-white">{name}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    aria-label={lowerLabel}
                    disabled={phase !== "judge" || scores[key] === 0}
                    onClick={() => changeScore(key, -5)}
                    className="grid size-9 place-items-center border border-line text-muted transition-colors hover:border-white hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ArrowDown aria-hidden="true" className="size-4" />
                  </button>
                  <span className="min-w-10 text-center font-display text-lg font-extrabold tabular-nums text-white">{scores[key]}</span>
                  <button
                    type="button"
                    aria-label={raiseLabel}
                    disabled={phase !== "judge"}
                    onClick={() => changeScore(key, 5)}
                    className="grid size-9 place-items-center border border-line text-muted transition-colors hover:border-live hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </button>
                </div>
              </div>
            ))}

            <Button onClick={submitScore} disabled={phase !== "judge"} className="mt-1 w-full">
              {labels.submitScore}
            </Button>
          </div>
        </section>

        <section aria-label={labels.admin} aria-live="polite" className={cn("border bg-panel transition-colors", phase === "admin" ? "border-amber" : "border-line")}>
          <div className="flex items-center gap-3 border-b border-line bg-panel-2 px-4 py-3">
            <ShieldCheck aria-hidden="true" className="size-5 text-amber" />
            <div className="min-w-0">
              <h3 className="font-bold text-white">{labels.admin}</h3>
              <p className="text-xs text-muted">{labels.semiFinalRoom}</p>
            </div>
            <span className={cn("ml-auto size-2 rounded-full", submitted && phase === "admin" ? "bg-amber" : "bg-good")} />
          </div>

          <div className="flex min-h-[218px] flex-col p-4">
            {submitted && phase === "admin" ? (
              <>
                <p className="mb-4 text-sm font-semibold text-amber">{labels.submitted}</p>
                <div className="grid gap-3">
                  <div className="flex items-center justify-between border-b border-line pb-3 text-sm">
                    <span className="text-muted">Kilimanjaro High</span>
                    <span className="font-display font-extrabold tabular-nums text-white">{submitted.kilimanjaro} {labels.points}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">Mwanza Owls</span>
                    <span className="font-display font-extrabold tabular-nums text-white">{submitted.mwanza} {labels.points}</span>
                  </div>
                </div>
                <Button onClick={approveScore} className="mt-auto w-full bg-amber text-studio hover:bg-amber/90">
                  <Check aria-hidden="true" className="mr-2 size-4" />
                  {labels.approveScore}
                </Button>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                {phase === "room" ? <Check aria-hidden="true" className="size-8 text-good" /> : <span className="size-2 rounded-full bg-muted" />}
                <p className={cn("text-sm", phase === "room" ? "font-semibold text-good" : "text-muted")}>
                  {phase === "room" ? labels.approved : labels.noScoresWaiting}
                </p>
              </div>
            )}
          </div>
        </section>

        <section aria-label={labels.room} aria-live="polite" className={cn("border bg-panel transition-colors", phase === "room" ? "border-good" : "border-line")}>
          <div className="flex items-center gap-3 border-b border-line bg-panel-2 px-4 py-3">
            <Monitor aria-hidden="true" className="size-5 text-good" />
            <div className="min-w-0">
              <h3 className="font-bold text-white">{labels.room}</h3>
              <p className="text-xs text-muted">{labels.roomTitle}</p>
            </div>
            <span className="ml-auto size-2 rounded-full bg-good" />
          </div>

          <div className="p-4">
            <p className="mb-3 text-xs font-medium text-muted">{labels.semiFinalRoom}</p>
            <ol>
              {standings.map((team, index) => (
                <li key={team.name} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 border-t border-line py-3 first:border-t-0">
                  <span className={cn("font-display font-extrabold tabular-nums", index === 0 ? "text-amber" : "text-muted")}>{index + 1}</span>
                  <span className="truncate text-sm font-semibold text-white">{team.name}</span>
                  <span className={cn("font-display text-sm font-extrabold tabular-nums", index === 0 ? "text-amber" : "text-white")}>{team.total.toLocaleString("en-US")}</span>
                </li>
              ))}
            </ol>
            {phase === "room" && (
              <Button variant="line" onClick={nextRound} className="mt-3 w-full">
                <RotateCcw aria-hidden="true" className="mr-2 size-4" />
                {labels.nextRound}
              </Button>
            )}
            {phase !== "room" && <p className="mt-3 border-t border-line pt-3 text-xs text-muted">{labels.waitingForJudge}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
