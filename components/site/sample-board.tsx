"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

// The sample leaderboard in the hero: press the button to score the next round and watch
// the teams change places. (Logged-in hosts will see their own tournaments here once the
// tournament screens are moved over.)

const ROUNDS = 5;
const teams = [
  { name: "Mwanza Owls", points: [1600, 1350, 1800, 1500, 1900] },
  { name: "Kilimanjaro High", points: [1450, 1720, 1380, 1910, 1620] },
  { name: "Dodoma Debaters", points: [1700, 1200, 1650, 1400, 1750] },
  { name: "Arusha Scholars", points: [1300, 1600, 1700, 1650, 1450] },
  { name: "Zanzibar Minds", points: [1550, 1500, 1250, 1800, 1500] },
  { name: "Moshi Masters", points: [1250, 1450, 1500, 1350, 1950] },
];

function standingsAfter(round: number) {
  return teams
    .map((team) => ({ name: team.name, total: team.points.slice(0, round).reduce((sum, p) => sum + p, 0) }))
    .sort((a, b) => b.total - a.total);
}

export type BoardLabels = {
  live: string;
  name: string;
  sample: string;
  afterRound: string; // "After round {n} of {total}"
  final: string;
  scoreRound: string; // "Score round {n}"
  startOver: string;
  winners: string; // "{team} win the tournament"
  up: string; // "up {n}"
  down: string; // "down {n}"
};

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));

export function SampleBoard({ labels }: { labels: BoardLabels }) {
  const [round, setRound] = useState(1);
  const rows = useRef(new Map<string, HTMLLIElement>());
  // Where each row sat before the latest change, so it can slide from there to its new place
  const tops = useRef(new Map<string, number>());

  const standings = standingsAfter(round);
  const previous = round > 1 ? standingsAfter(round - 1).map((team) => team.name) : null;
  const top = standings[0].total;
  const bottom = standings[standings.length - 1].total;
  // Bars run from 35% (last place) to 100% (leader) so close scores still look different
  const barWidth = (total: number) => (top === bottom ? 100 : 35 + (65 * (total - bottom)) / (top - bottom));
  const finished = round === ROUNDS;

  useLayoutEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rows.current.forEach((row, name) => {
      const now = row.offsetTop;
      const before = tops.current.get(name);
      tops.current.set(name, now);
      if (still || before === undefined || before === now) return;
      row.animate([{ transform: `translateY(${before - now}px)` }, { transform: "translateY(0)" }], { duration: 700, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
  }, [round]);

  return (
    <div className="border border-line bg-panel">
      {/* The strip along the top, like the caption bar on a live feed */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-panel-2 px-5 py-3 text-sm">
        <span className="wide inline-flex items-center gap-1.5 bg-live px-2 py-0.5 text-[12px] font-bold text-white">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-white" />
          {labels.live}
        </span>
        <span className="font-semibold text-white">
          {labels.name} <span className="font-normal text-muted">{labels.sample}</span>
        </span>
        <span className="ml-auto font-medium text-muted tabular-nums">{finished ? labels.final : fill(labels.afterRound, { n: round, total: ROUNDS })}</span>
      </div>

      <ol aria-live="polite" className="relative px-5">
        {standings.map((team, index) => {
          const was = previous ? previous.indexOf(team.name) : -1;
          const moved = was === -1 ? 0 : was - index;
          const leader = index === 0;
          return (
            <li
              key={team.name}
              ref={(node) => {
                if (node) rows.current.set(team.name, node);
                else rows.current.delete(team.name);
              }}
              className="grid grid-cols-[28px_minmax(0,1fr)_auto_32px] items-center gap-2.5 border-b border-line py-3.5 tabular-nums last:border-0 sm:grid-cols-[32px_minmax(140px,1.3fr)_1fr_72px_40px] sm:gap-4"
            >
              <span className={cn("wide font-display text-lg font-extrabold", leader ? "text-amber" : "text-muted")}>{String(index + 1).padStart(2, "0")}</span>
              <span className={cn("truncate font-semibold", leader ? "text-white" : "text-text")}>{team.name}</span>
              <span className="hidden h-2 overflow-hidden bg-white/10 sm:block">
                <span className={cn("block h-full transition-[width] duration-[800ms] ease-out", leader ? "bg-amber" : "bg-live")} style={{ width: `${barWidth(team.total)}%` }} />
              </span>
              <span className={cn("wide text-right font-display text-lg font-extrabold", leader ? "text-amber" : "text-white")}>{team.total.toLocaleString("en-US")}</span>
              <span
                className={cn("text-right text-[13px] font-semibold", moved > 0 ? "text-good" : "text-bad")}
                aria-label={moved > 0 ? fill(labels.up, { n: moved }) : moved < 0 ? fill(labels.down, { n: -moved }) : undefined}
              >
                {moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : ""}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-5 border-t border-line px-5 py-4">
        <Button size="sm" className="h-11 px-6" onClick={() => setRound(finished ? 1 : round + 1)}>
          {finished ? labels.startOver : fill(labels.scoreRound, { n: round + 1 })}
        </Button>
        {finished && <p className="wide font-display text-lg font-extrabold text-amber">{fill(labels.winners, { team: standings[0].name })}</p>}
      </div>
    </div>
  );
}
