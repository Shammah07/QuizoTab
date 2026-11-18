"use client";

import { cn } from "@/lib/cn";
import { ANSWER_STYLES, Shape } from "./shapes";

// The answer buttons on a phone. Once one is pressed the rest dim and nothing else can be picked.
export function AnswerButtons({ answers, picked, locked, onPick }: { answers: string[]; picked: number | null; locked: boolean; onPick: (choice: number) => void }) {
  return (
    <div className={cn("grid gap-3", answers.length === 2 ? "grid-cols-1" : "grid-cols-2")}>
      {answers.map((text, i) => (
        <button
          key={i}
          type="button"
          disabled={locked}
          onClick={() => onPick(i)}
          className={cn(
            "flex min-h-[88px] cursor-pointer items-center gap-3 px-4 py-3 text-left text-[15px] leading-snug font-semibold transition-opacity",
            ANSWER_STYLES[i],
            locked && picked !== i && "opacity-35",
            locked && picked === i && "ring-4 ring-white/60 ring-inset",
          )}
        >
          <Shape index={i} />
          <span className="break-words">{text}</span>
        </button>
      ))}
    </div>
  );
}

// How much of the question's time is left, as a bar that shrinks from the left
export function TimeBar({ fraction }: { fraction: number }) {
  return (
    <div className="my-4 h-2 w-full overflow-hidden bg-white/10">
      <div className="h-full origin-left bg-amber" style={{ transform: `scaleX(${Math.max(0, Math.min(1, fraction))})` }} />
    </div>
  );
}
