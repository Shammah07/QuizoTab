"use client";

import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/quiz/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { FORMAT_KEYS, FORMATS, isPointsFormat, type Format, type TournamentConfig, type TournamentRow } from "@/lib/tournament/rules";
import { Eyebrow, panelClass } from "./bits";

// Setting up a tournament in two steps: the event format, then its name and dates.
// Payments are skipped for now: every format is free and the tournament opens straight away.

type Props = {
  // The rules of a tournament to copy, when the host came from "New tournament with these rules"
  template: TournamentConfig | null;
  templateName?: string;
};

export function CreateTournament({ template, templateName }: Props) {
  const router = useRouter();
  const [format, setFormat] = useState<Format | null>(template?.format ?? null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const copying = Boolean(template && format === template.format);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!format) return;
    if (!name.trim() || !category.trim() || !year) return setError("Enter a tournament name, category, and year.");
    setError("");
    setSaving(true);
    const result = await api<{ tournament: TournamentRow }>("/api/host/tournaments", {
      body: { name: name.trim(), category: category.trim(), year: Number(year), startDate, endDate, format, template: copying ? template : null },
    });
    if (!result.ok) {
      setSaving(false);
      return setError(result.error);
    }
    router.push(`/host/${result.tournament.id}?tab=settings`);
  }

  if (!format) {
    return (
      <div>
        <Eyebrow className="text-live">Host a tournament · step 1 of 2</Eyebrow>
        <h1 className="mt-2 text-[clamp(30px,4vw,44px)] leading-[1.05] font-extrabold text-white">Choose your event format</h1>
        <p className="mt-3 mb-8 max-w-[60ch] text-muted">Pick how your event runs. You&apos;ll add its name and dates next. Hosting is free while QuizoTab moves to its new home.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {FORMAT_KEYS.map((key) => (
            <button key={key} type="button" onClick={() => setFormat(key)} className={cn(panelClass, "group flex cursor-pointer flex-col p-5 text-left transition-colors hover:border-live")}>
              <span className="text-xl font-bold text-white">{FORMATS[key].label}</span>
              <span className="mt-1 text-sm text-live">For {FORMATS[key].who.charAt(0).toLowerCase() + FORMATS[key].who.slice(1)}</span>
              <span className="mt-2 flex-1 text-sm leading-relaxed text-muted">{FORMATS[key].how}</span>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-white">
                Choose {FORMATS[key].label.toLowerCase()} <ChevronRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={create} className="max-w-[560px]">
      <Eyebrow className="text-live">Host a tournament · step 2 of 2</Eyebrow>
      <h1 className="mt-2 mb-6 text-[clamp(30px,4vw,44px)] leading-[1.05] font-extrabold text-white">Your {FORMATS[format].label.toLowerCase()} details</h1>

      {error && (
        <Alert type="error" className="mb-5">
          {error}
        </Alert>
      )}

      <div className={cn(panelClass, "flex flex-col gap-5 p-6")}>
        <div className="flex items-start justify-between gap-3 border-l-2 border-live pl-4">
          <div className="min-w-0">
            <p className="font-semibold text-white">{FORMATS[format].label}</p>
            <p className="mt-0.5 text-sm text-muted">{FORMATS[format].how}</p>
            {copying && templateName && <p className="mt-1 text-sm text-live">The rounds and rules of {templateName} are copied.</p>}
          </div>
          <button type="button" onClick={() => setFormat(null)} disabled={saving} className="shrink-0 cursor-pointer text-sm font-semibold text-live underline">
            Change
          </button>
        </div>
        <Input label="Tournament name" autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. East African Debate Championship 2027" />
        <Input label="Category" value={category} maxLength={80} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Junior Quiz" hint="What kind of event it is, shown under the name" />
        <Input label="Year" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Starts" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label="Ends" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <p className="text-sm text-muted">{isPointsFormat({ format }) ? "Next you'll name your rounds, then add the teams. You can type scores in yourself or invite judges." : "Next you'll set the rounds and rules, then add teams, judges and rooms."}</p>
        <Button type="submit" disabled={saving}>
          {saving ? "Creating…" : "Create tournament"}
        </Button>
      </div>
    </form>
  );
}
