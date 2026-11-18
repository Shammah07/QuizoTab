"use client";

import { Check, Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { groupRoundsForDisplay, roundRange, type Score, type Team, type TournamentConfig } from "@/lib/tournament/rules";
import type { ScoreOp } from "@/lib/tournament/store";
import { EmptyNote, iconButtonClass, panelClass, plural, Select } from "./bits";

// The Scores tab: pick a round, see every team's result for it, approve the round, type scores in
// yourself. Scores from judges and from live quizzes wait here until the host approves them.

type Props = {
  config: TournamentConfig;
  teams: Team[];
  scores: Score[];
  // Resolves with an error message, or null when applied
  onChange: (op: ScoreOp) => Promise<string | null>;
};

export function ScoresPanel({ config, teams, scores, onChange }: Props) {
  const rounds = config.rounds;
  const [selected, setSelected] = useState(rounds[0]?.id ?? "");
  const [error, setError] = useState("");
  const roundId = rounds.some((r) => r.id === selected) ? selected : (rounds[0]?.id ?? "");
  const range = roundRange(config, roundId);

  const rows = teams
    .map((team) => ({ team, score: scores.find((s) => s.teamId === team.id && s.roundId === roundId) ?? null }))
    .sort((a, b) => (b.score?.points ?? -1) - (a.score?.points ?? -1));
  const roundScores = scores.filter((s) => s.roundId === roundId);
  const pending = roundScores.filter((s) => !s.approved).length;
  const roundApproved = roundScores.length > 0 && pending === 0;
  const pendingTotal = scores.filter((s) => !s.approved).length;

  async function run(op: ScoreOp) {
    const failed = await onChange(op);
    setError(failed ?? "");
  }

  async function enter(teamId: string, value: string, current: Score | null) {
    if (value === "" || value === String(current?.points ?? "")) return;
    await run({ op: "enter", teamId, roundId, points: Number(value) });
  }

  if (rounds.length === 0) return <EmptyNote>No rounds yet. Add some in Settings.</EmptyNote>;

  return (
    <div className="flex flex-col gap-5">
      {pendingTotal > 0 && (
        <Alert type="info">
          {plural(pendingTotal, "score")} waiting for your approval across all rounds. Only approved scores count in the public standings.
        </Alert>
      )}

      <Select label="Round" value={roundId} onChange={(e) => setSelected(e.target.value)} hint={teams.length > 0 ? `${rows.filter((r) => r.score).length} of ${teams.length} teams scored · points ${range.min}–${range.max}` : undefined}>
        {groupRoundsForDisplay(rounds).map((group) => (
          <optgroup key={group.key} label={group.label}>
            {group.items.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>

      {roundScores.length > 0 && (
        <div className={cn("flex flex-wrap items-center justify-between gap-3 border px-4 py-3", pending > 0 ? "border-amber/50 bg-amber/10" : "border-good/50 bg-good/10")}>
          <span className={cn("text-sm font-medium", pending > 0 ? "text-amber" : "text-good")}>{pending > 0 ? `${plural(pending, "score")} awaiting approval` : `${plural(roundScores.length, "score")} approved`}</span>
          {roundApproved ? (
            <Button variant="line" size="sm" onClick={() => run({ op: "approve-round", roundId, approved: false })}>
              Unapprove this round
            </Button>
          ) : (
            <Button size="sm" onClick={() => run({ op: "approve-round", roundId, approved: true })}>
              Approve this round
            </Button>
          )}
        </div>
      )}

      {error && <Alert type="error">{error}</Alert>}

      {teams.length === 0 ? (
        <EmptyNote>No teams registered yet.</EmptyNote>
      ) : (
        <>
          <p className="text-sm text-muted">Type a team&apos;s points and press Enter to score it yourself. Your entries count straight away.</p>
          <ul className="flex flex-col gap-2">
            {rows.map(({ team, score }, i) => (
              <li key={team.id} className={cn(panelClass, "flex items-center justify-between gap-3 p-3")}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("grid size-8 shrink-0 place-items-center font-mono text-xs font-bold", score ? "bg-white/10 text-text" : "bg-white/5 text-muted")}>{i + 1}</span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">{team.name}</p>
                    <p className="text-xs text-muted">
                      {score ? (
                        <>
                          by {score.judgeName || "—"} ·{" "}
                          {score.approved ? (
                            <span className="text-good">approved</span>
                          ) : (
                            <button type="button" onClick={() => run({ op: "approve", scoreId: score.id, approved: true })} className="cursor-pointer font-semibold text-amber hover:underline">
                              awaiting approval · approve
                            </button>
                          )}
                        </>
                      ) : (
                        "Not yet scored"
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <input
                    key={`${roundId}-${team.id}-${score?.points ?? ""}`}
                    type="number"
                    min={range.min}
                    max={range.max}
                    defaultValue={score?.points ?? ""}
                    placeholder="—"
                    aria-label={`Points for ${team.name}`}
                    onFocus={() => setError("")}
                    onBlur={(e) => enter(team.id, e.target.value, score)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className={cn("h-10 w-24 border bg-white/5 px-2 text-right font-mono text-base font-bold focus:border-live focus:outline-none", score ? (score.approved ? "border-good/60 text-white" : "border-amber/60 text-amber") : "border-line text-text")}
                  />
                  {score && !score.approved && (
                    <button type="button" onClick={() => run({ op: "approve", scoreId: score.id, approved: true })} title="Approve" aria-label={`Approve ${team.name}'s score`} className={cn(iconButtonClass, "text-good")}>
                      <Check aria-hidden="true" className="size-4" />
                    </button>
                  )}
                  {score && (
                    <button type="button" onClick={() => run({ op: "delete", scoreId: score.id })} title="Delete score" aria-label={`Delete ${team.name}'s score`} className={cn(iconButtonClass, "hover:text-bad")}>
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
