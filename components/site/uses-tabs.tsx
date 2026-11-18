"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

// "What QuizoTab can do for you": pick a kind of event on the left, read about it on the right.

export type Use = {
  key: string;
  title: string;
  text: string;
  points: string[];
  event: string;
  board: Array<[team: string, score: number]>;
};

export function UsesTabs({ uses, label }: { uses: Use[]; label: string }) {
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const use = uses[active];

  // Arrow keys move between tabs, as screen-reader and keyboard users expect from a tab list
  function onKeyDown(event: KeyboardEvent, index: number) {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + uses.length) % uses.length;
    setActive(next);
    tabs.current[next]?.focus();
  }

  return (
    <div className="grid gap-7 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div role="tablist" aria-label={label} aria-orientation="vertical" className="flex flex-col border-t border-line">
        {uses.map((item, index) => {
          const selected = index === active;
          return (
            <button
              key={item.key}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`tab-${item.key}`}
              aria-controls="panel-uses"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "cursor-pointer border-b border-l-4 border-b-line px-5 py-4 text-left font-semibold transition-colors",
                selected ? "border-l-live bg-panel text-white" : "border-l-transparent text-muted hover:bg-panel/60 hover:text-white",
              )}
            >
              {item.title}
            </button>
          );
        })}
      </div>

      {/* The key restarts the fade-in each time another tab is picked */}
      <div
        key={use.key}
        id="panel-uses"
        role="tabpanel"
        aria-labelledby={`tab-${use.key}`}
        className="grid items-center gap-7 border border-line bg-panel p-6 motion-safe:animate-[panel-in_0.35s_ease] sm:p-8 md:grid-cols-[1.15fr_1fr]"
      >
        <div>
          <h3 className="text-[26px] leading-[1.15] font-extrabold text-white">{use.title}</h3>
          <p className="mt-3 mb-[18px] leading-relaxed text-muted">{use.text}</p>
          <ul className="grid gap-2.5">
            {use.points.map((point) => (
              <li key={point} className="relative pl-[20px] text-[15px] before:absolute before:top-[0.6em] before:left-0 before:size-2 before:bg-live">
                {point}
              </li>
            ))}
          </ul>
        </div>

        {/* A little picture of the big screen; decoration only */}
        <div aria-hidden="true" className="border border-line bg-studio-deep px-5 py-4">
          <p className="mb-2 flex items-center gap-2 border-b border-line pb-2.5 text-[13px] text-muted">
            <span className="size-2 rounded-full bg-amber" />
            {use.event}
          </p>
          <ol>
            {use.board.map(([team, score], i) => (
              <li key={team} className={cn("grid grid-cols-[24px_1fr_auto] gap-2.5 py-[9px] text-sm tabular-nums", i === 0 ? "font-semibold text-amber" : "border-t border-line")}>
                <span className={cn("wide font-display font-extrabold", i > 0 && "text-muted")}>{i + 1}</span>
                <span>{team}</span>
                <span className="wide font-display font-extrabold">{score.toLocaleString("en-US")}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
