"use client";

import { Check, Copy } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { STATUS_LABELS, type Status } from "@/lib/tournament/rules";

// Small pieces the tournament screens share: fields, tabs, stat tiles, the live dot, copy buttons.
// Same flat studio look as the rest of the site: hard corners, graphite panels, one blue accent.

export const fieldClass = "h-12 w-full border border-line bg-white/5 px-3 text-base text-text transition-colors focus:border-live focus:outline-none disabled:opacity-50";
export const panelClass = "border border-line bg-panel";
export const iconButtonClass = "grid size-9 shrink-0 cursor-pointer place-items-center text-muted transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";

// A label above any field (select, textarea, a row of inputs)
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-sm font-medium text-text">{label}</span>
      {children}
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function Select({ label, hint, className, ...props }: ComponentProps<"select"> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      <select id={id} className={fieldClass} {...props} />
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function Textarea({ label, hint, className, ...props }: ComponentProps<"textarea"> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      <textarea id={id} className={cn(fieldClass, "h-auto py-3")} {...props} />
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

// The small label over a group of things ("ROUNDS", "YOUR TOURNAMENTS")
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("font-mono text-[11px] font-bold tracking-[0.18em] text-muted uppercase", className)}>{children}</p>;
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="border border-dashed border-line px-5 py-6 text-center text-sm text-muted">{children}</p>;
}

export type Tab = { key: string; label: string; count?: number };

// A row of tabs; the open one is underlined in blue
export function Tabs({ tabs, active, onChange, label }: { tabs: Tab[]; active: string; onChange: (key: string) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="-mx-6 mb-8 flex overflow-x-auto border-b border-line px-6">
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.key)}
            className={cn(
              "-mb-px shrink-0 cursor-pointer border-b-2 px-3.5 py-3 text-sm font-semibold whitespace-nowrap transition-colors",
              on ? "border-live text-white" : "border-transparent text-muted hover:text-white",
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && <span className={cn("ml-1.5 px-1.5 py-0.5 font-mono text-[11px]", on ? "bg-live text-white" : "bg-white/10 text-text")}>{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function StatCard({ label, value, tone = "text" }: { label: string; value: ReactNode; tone?: "text" | "live" | "amber" | "muted" }) {
  const tones = { text: "text-white", live: "text-live", amber: "text-amber", muted: "text-muted" };
  return (
    <div className={cn(panelClass, "min-w-0 p-4")}>
      <p className={cn("wide font-display text-2xl font-extrabold break-words", tones[tone])}>{value}</p>
      <p className="mt-1 text-sm text-muted">{label}</p>
    </div>
  );
}

// LIVE, UPCOMING, ENDED or NOT SCHEDULED, with a pulsing dot while live
export function LiveDot({ status }: { status: Status }) {
  const color = status === "live" ? "text-live" : status === "upcoming" ? "text-amber" : "text-muted";
  const dot = status === "live" ? "bg-live" : status === "upcoming" ? "bg-amber" : "bg-muted";
  return (
    <span className={cn("inline-flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.18em] uppercase", color)}>
      <span className="relative flex size-2">
        {status === "live" && <span className={cn("absolute inline-flex size-full animate-ping opacity-60", dot)} />}
        <span className={cn("relative inline-flex size-2", dot)} />
      </span>
      {STATUS_LABELS[status]}
    </span>
  );
}

// Copies text and says "Copied" for a moment
export function CopyButton({ text, label = "Copy", size = "sm", variant = "line", className }: { text: string; label?: string; size?: "sm" | "md"; variant?: "line" | "neon" | "ghost"; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy this:", text);
        }
      }}
    >
      {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
      <span className="ml-2">{copied ? "Copied" : label}</span>
    </Button>
  );
}

// A read-only link with a copy button beside it
export function LinkBox({ label, href, hint }: { label: string; href: string; hint?: string }) {
  return (
    <div className={cn(panelClass, "p-4")}>
      <Eyebrow className="mb-2">{label}</Eyebrow>
      <div className="flex flex-wrap items-center gap-2">
        <input readOnly value={href} aria-label={label} className={cn(fieldClass, "h-10 min-w-0 flex-1 font-mono text-sm")} onFocus={(e) => e.currentTarget.select()} />
        <CopyButton text={href} />
      </div>
      {hint && <p className="mt-2 text-sm text-muted">{hint}</p>}
    </div>
  );
}

// A button that needs a second press within five seconds, so a stray click can't wipe data
export function ConfirmButton({ children, confirmLabel, onConfirm, disabled, className }: { children: ReactNode; confirmLabel: string; onConfirm: () => void | Promise<void>; disabled?: boolean; className?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  return (
    <Button
      variant={confirming ? "danger" : "line"}
      size="sm"
      className={className}
      disabled={disabled || running}
      onClick={async () => {
        if (!confirming) {
          setConfirming(true);
          window.setTimeout(() => setConfirming(false), 5000);
          return;
        }
        setConfirming(false);
        setRunning(true);
        try {
          await onConfirm();
        } finally {
          setRunning(false);
        }
      }}
    >
      {running ? "Working…" : confirming ? confirmLabel : children}
    </Button>
  );
}

// The data part of a successful API answer, without the ok flag
export function payload<T extends object>(result: { ok: true } & T): T {
  const copy: Record<string, unknown> = { ...result };
  delete copy.ok;
  return copy as T;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
