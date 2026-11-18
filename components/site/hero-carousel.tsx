"use client";

import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export type HeroSlide = {
  id: string;
  // Short name on the slide picker under the text
  tab: string;
  // Small tag above the title; the first slide has none
  tag?: string;
  title: string;
  text: string;
  actions: Array<{ href: string; label: string }>;
};

const SLIDE_MS = 8000;

// The three hero slides. They change by themselves every few seconds; the timer stops while the
// visitor hovers or tabs into the hero, and for anyone who asked their device for less motion.
export function HeroCarousel({ slides, label, pickerLabel }: { slides: HeroSlide[]; label: string; pickerLabel: string }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => setActive((i) => (i + 1) % slides.length), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [active, paused, slides.length]);

  return (
    <div
      aria-roledescription="carousel"
      aria-label={label}
      className="max-w-[640px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* Slides share one grid cell, so the hero is as tall as the longest slide and never jumps */}
      <div className="grid">
        {slides.map((slide, i) => {
          const shown = i === active;
          const Title = i === 0 ? "h1" : "h2";
          return (
            <div
              key={slide.id}
              id={slide.id}
              aria-roledescription="slide"
              aria-label={`${i + 1} / ${slides.length}`}
              aria-hidden={!shown}
              inert={!shown}
              className={cn("col-start-1 row-start-1 transition-opacity duration-500", shown ? "opacity-100" : "pointer-events-none opacity-0")}
            >
              {slide.tag && <p className="mb-5 inline-block border-l-4 border-live bg-panel px-3 py-1.5 text-sm font-semibold text-white">{slide.tag}</p>}
              <Title className="text-[clamp(36px,4.3vw,60px)] leading-[1] font-extrabold text-white">{slide.title}</Title>
              <p className="mt-6 mb-9 max-w-[52ch] text-lg leading-relaxed text-muted">{slide.text}</p>
              <div className="flex flex-wrap gap-3">
                {slide.actions.map((action, n) => (
                  <ButtonLink key={action.href + action.label} href={action.href} variant={n === 0 ? "neon" : "line"}>
                    {action.label}
                  </ButtonLink>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* The slide picker, set like the strip along the bottom of a broadcast */}
      <div role="group" aria-label={pickerLabel} className="mt-12 flex border-t border-line">
        {slides.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            aria-controls={slide.id}
            aria-current={i === active ? "true" : undefined}
            onClick={() => setActive(i)}
            className={cn(
              "relative cursor-pointer px-4 py-3.5 text-[14px] font-semibold whitespace-nowrap transition-colors first:pl-0",
              i === active ? "text-white" : "text-muted hover:text-white",
            )}
          >
            {slide.tab}
            <span aria-hidden="true" className={cn("absolute inset-x-0 -top-px h-[3px] transition-colors", i === active ? "bg-live" : "bg-transparent")} />
          </button>
        ))}
      </div>
    </div>
  );
}
