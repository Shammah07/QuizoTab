"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  configProblem,
  FORMAT_KEYS,
  FORMATS,
  firstKnockoutStage,
  formatOf,
  formatRounds,
  formatSummary,
  groupRoundsForDisplay,
  knockoutStagesFrom,
  prelimMatches,
  QUALIFY_OPTIONS,
  roundRange,
  STAGE_LABELS,
  uid,
  withStageRounds,
  type Format,
  type Pairing,
  type Round,
  type Score,
  type Stage,
  type TournamentConfig,
} from "@/lib/tournament/rules";
import { Eyebrow, Field, fieldClass, iconButtonClass, panelClass, Select } from "./bits";

// The Settings tab: name, dates, points, the event format and the rounds editor

type Props = {
  config: TournamentConfig;
  scores: Score[];
  pairings: Pairing[];
  // Resolves with an error message, or null when saved
  onSave: (config: TournamentConfig) => Promise<string | null>;
};

export function SettingsPanel({ config, scores, pairings, onSave }: Props) {
  const [draft, setDraft] = useState(config);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const format = formatOf(draft);
  // Switching format replaces the rounds, so it's only offered before any scores or draw exist
  const canChangeFormat = scores.length === 0 && pairings.length === 0;

  const change = (patch: Partial<TournamentConfig>) => setDraft((d) => ({ ...d, ...patch }));

  const changeFormat = (next: Format) => {
    if (next === format) return;
    change({ format: next, rounds: formatRounds(next), maxScorePerRound: next === "quiz-night" ? 10 : draft.maxScorePerRound === 10 ? 100 : draft.maxScorePerRound });
  };

  async function save() {
    const problem = configProblem(draft);
    if (problem) return setError(problem);
    setError("");
    setSaving(true);
    const failed = await onSave(draft);
    setSaving(false);
    if (failed) return setError(failed);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <Alert type="error">{error}</Alert>}
      {saved && <Alert type="success">Settings saved.</Alert>}

      <Input label="Tournament name" value={draft.name} maxLength={120} onChange={(e) => change({ name: e.target.value })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Starts" type="date" value={draft.startDate} onChange={(e) => change({ startDate: e.target.value })} />
        <Input label="Ends" type="date" value={draft.endDate} onChange={(e) => change({ endDate: e.target.value })} />
      </div>
      <Input
        label="Max points per round"
        type="number"
        min={1}
        value={draft.maxScorePerRound}
        onChange={(e) => change({ maxScorePerRound: Number(e.target.value) || 1 })}
        hint="Used for any round without its own Min and Max below"
      />

      {canChangeFormat ? (
        <FormatPicker value={format} onChange={changeFormat} />
      ) : (
        <div className={cn(panelClass, "p-4")}>
          <p className="font-semibold text-white">{FORMATS[format].label}</p>
          <p className="mt-1 text-sm text-muted">The format is fixed once scores or a draw exist.</p>
        </div>
      )}

      <div className="border-l-2 border-live py-1 pl-4 text-sm text-muted">
        <p>{formatSummary(draft)}</p>
        {format === "championship" && <p className="mt-1">Pairing: fold method · Conflict avoidance: one-up-one-down</p>}
      </div>

      <div>
        <Eyebrow>Rounds</Eyebrow>
        <p className="mt-1 mb-4 text-sm text-muted">Min and Max set the points a team can get in each round. Judges can&apos;t enter a score outside them.</p>
        <RoundsEditor config={draft} scores={scores} onChange={setDraft} />
      </div>

      <Button onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}

// The four event formats as cards; the chosen one explains how it runs
export function FormatPicker({ value, onChange }: { value: Format; onChange: (format: Format) => void }) {
  return (
    <Field label="Event format">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Event format">
        {FORMAT_KEYS.map((key) => {
          const on = value === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(key)}
              className={cn("min-w-0 cursor-pointer border p-3 text-left transition-colors", on ? "border-live bg-live/10" : "border-line bg-panel hover:border-text")}
            >
              <p className="font-semibold text-white">{FORMATS[key].label}</p>
              <p className="mt-1 text-xs leading-snug text-muted">{FORMATS[key].who}</p>
            </button>
          );
        })}
      </div>
      <p className="text-sm text-live">{FORMATS[value].how}</p>
    </Field>
  );
}

// Add, remove and rename rounds. A round that already has scores can be renamed but not removed.
export function RoundsEditor({ config, scores, onChange }: { config: TournamentConfig; scores: Score[]; onChange: (config: TournamentConfig) => void }) {
  const format = formatOf(config);
  const scored = new Set(scores.map((score) => score.roundId));
  const rounds = config.rounds;
  const setRounds = (next: Round[]) => onChange({ ...config, rounds: next });
  const insertAfter = (last: Round, items: Round[]) => {
    const next = [...rounds];
    next.splice(rounds.indexOf(last) + 1, 0, ...items);
    setRounds(next);
  };
  const setPoints = (id: string, field: "minPoints" | "maxPoints", value: string) => setRounds(rounds.map((r) => (r.id === id ? { ...r, [field]: value === "" ? "" : Number(value) } : r)));

  // A championship shows only the stages it will reach
  const shownStages: Stage[] | null = format === "championship" ? ["preliminary", ...knockoutStagesFrom(firstKnockoutStage(config.qualificationCount || 8))] : null;
  const groups = groupRoundsForDisplay(shownStages ? rounds.filter((r) => shownStages.includes(r.stage)) : rounds);

  const matches = prelimMatches(config);
  const lastMatchRounds = rounds.filter((r) => r.stage === "preliminary" && r.match === matches[matches.length - 1]);
  const weeks = [...new Set(rounds.filter((r) => r.stage === "league").map((r) => r.match))];
  const lastWeekRounds = rounds.filter((r) => r.stage === "league" && r.match === weeks[weeks.length - 1]);

  const addBlock = (stage: Stage, label: string, template: Round[]) => {
    const items = template.map((_, i) => ({ id: uid(), stage, match: label, name: `Round ${i + 1}` }));
    insertAfter(template[template.length - 1], items);
  };
  const removeBlock = (block: Round[]) => setRounds(rounds.filter((r) => !block.includes(r)));

  const setQualify = (count: number) => {
    let next = { ...config, qualificationCount: count };
    for (const stage of knockoutStagesFrom(firstKnockoutStage(count))) next = withStageRounds(next, stage);
    onChange(next);
  };

  const pointsInput = "h-9 w-20 border border-line bg-white/5 px-2 text-right font-mono text-sm text-text focus:border-live focus:outline-none";

  return (
    <div className="flex flex-col gap-3">
      {format === "championship" && (
        <div className={cn(panelClass, "grid gap-4 p-4 sm:grid-cols-2")}>
          <Field label="Preliminary matches">
            <div className="flex items-center gap-2">
              <Button variant="line" size="sm" aria-label="Remove the last match" disabled={matches.length <= 1 || lastMatchRounds.some((r) => scored.has(r.id))} onClick={() => removeBlock(lastMatchRounds)}>
                −
              </Button>
              <span className="w-8 text-center font-mono text-lg font-bold text-white">{matches.length}</span>
              <Button variant="line" size="sm" aria-label="Add a match" disabled={matches.length >= 6} onClick={() => addBlock("preliminary", `Match ${matches.length + 1}`, lastMatchRounds)}>
                +
              </Button>
            </div>
          </Field>
          <Select label="Teams that qualify" value={config.qualificationCount || 8} onChange={(e) => setQualify(Number(e.target.value))}>
            {QUALIFY_OPTIONS.map((q) => (
              <option key={q} value={q}>
                Top {q} → {STAGE_LABELS[firstKnockoutStage(q)]}
              </option>
            ))}
          </Select>
        </div>
      )}

      {format === "league" && (
        <div className={cn(panelClass, "flex flex-wrap items-center justify-between gap-3 p-4")}>
          <span className="text-sm text-white">
            {weeks.length} week{weeks.length === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <Button variant="line" size="sm" disabled={weeks.length <= 1 || lastWeekRounds.some((r) => scored.has(r.id))} onClick={() => removeBlock(lastWeekRounds)}>
              Remove last week
            </Button>
            <Button variant="line" size="sm" onClick={() => addBlock("league", `Week ${weeks.length + 1}`, lastWeekRounds)}>
              Add a week
            </Button>
          </div>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.key} className={cn(panelClass, "p-4")}>
          <Eyebrow className="mb-3 text-live">{group.label}</Eyebrow>
          <div className="flex flex-col gap-2">
            {group.items.map((round) => {
              const range = roundRange(config, round);
              const bad = range.min > range.max;
              return (
                <div key={round.id} className="flex flex-wrap items-center gap-2">
                  <input value={round.name} aria-label="Round name" maxLength={120} onChange={(e) => setRounds(rounds.map((r) => (r.id === round.id ? { ...r, name: e.target.value } : r)))} className={cn(fieldClass, "h-10 min-w-[180px] flex-1 text-sm")} />
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                    Min
                    <input type="number" min={0} value={round.minPoints ?? ""} placeholder="0" aria-label={`Minimum points for ${round.name}`} onChange={(e) => setPoints(round.id, "minPoints", e.target.value)} className={cn(pointsInput, bad && "border-bad")} />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                    Max
                    <input type="number" min={1} value={round.maxPoints ?? ""} placeholder={String(config.maxScorePerRound || 100)} aria-label={`Maximum points for ${round.name}`} onChange={(e) => setPoints(round.id, "maxPoints", e.target.value)} className={cn(pointsInput, bad && "border-bad")} />
                  </label>
                  <button
                    type="button"
                    onClick={() => setRounds(rounds.filter((r) => r.id !== round.id))}
                    disabled={group.items.length <= 1 || scored.has(round.id)}
                    title={scored.has(round.id) ? "This round has scores, so it can only be renamed" : "Remove this round"}
                    aria-label={`Remove ${round.name}`}
                    className={cn(iconButtonClass, "hover:text-bad")}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => insertAfter(group.items[group.items.length - 1], [{ id: uid(), stage: group.items[0].stage, match: group.items[0].match, name: `Round ${group.items.length + 1}` }])} className="mt-3 cursor-pointer text-sm font-semibold text-live hover:underline">
            + Add round
          </button>
        </div>
      ))}
    </div>
  );
}
