"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { reducedMotion } from "./api";

// A total that rolls up from its old value to the new one, like a money counter.
// Give it a `key` that changes with each question so it starts again from `start`.
export function CountUp({ value, start, delay = 0, className }: { value: number; start?: number; delay?: number; className?: string }) {
  const [shown, setShown] = useState(start ?? value);
  // The number on screen right now, readable from the effect without it being a dependency.
  // (It changes only as the count moves, so React's double-run of effects in development can't skip the count.)
  const shownRef = useRef(start ?? value);

  useEffect(() => {
    const from = shownRef.current;
    const to = value;
    if (from === to) return;
    const show = (n: number) => {
      shownRef.current = n;
      setShown(n);
    };
    // With less motion asked for, the number simply jumps to its new value
    const duration = reducedMotion() ? 0 : Math.min(2200, 900 + Math.abs(to - from) / 2);
    // A plain timer rather than animation frames, which browsers pause for a screen that isn't in front
    let ticker = 0;
    const timer = window.setTimeout(() => {
      const begin = performance.now();
      const step = () => {
        const t = duration === 0 ? 1 : Math.min(1, (performance.now() - begin) / duration);
        // Fast at first, then settling on the final number
        show(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 4))));
        if (t >= 1) window.clearInterval(ticker);
      };
      ticker = window.setInterval(step, 40);
      step();
    }, delay);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(ticker);
    };
  }, [value, delay]);

  return <span className={cn("tabular-nums", className)}>{shown.toLocaleString("en-US")}</span>;
}

// "+250" beside a total, gone after a few seconds
export function Gain({ points, delay = 0 }: { points: number; delay?: number }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setGone(true), delay + 3000);
    return () => window.clearTimeout(timer);
  }, [delay]);
  if (points <= 0) return null;
  return <span className={cn("ml-2 font-bold text-good transition-opacity duration-700", gone && "opacity-0")}>+{points.toLocaleString("en-US")}</span>;
}

// A total and, from the second question on, what the last question added
export function Score({ score, gained = 0, showGain = false, delay = 0, className }: { score: number; gained?: number; showGain?: boolean; delay?: number; className?: string }) {
  return (
    <>
      <CountUp value={score} start={Math.max(0, score - gained)} delay={delay} className={className} />
      {showGain && <Gain points={gained} delay={delay} />}
    </>
  );
}
