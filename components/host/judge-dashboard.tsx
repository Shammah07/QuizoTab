"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/quiz/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { groupRoundsForDisplay, isPointsFormat, releasedRounds, roundRange, teamsForCurrentPairingStage, todayStatus, tournamentSubtitle, tournamentTitle, type Score } from "@/lib/tournament/rules";
import type { JudgeView } from "@/lib/tournament/store";
import { EmptyNote, Eyebrow, LiveDot, panelClass, payload, Select, Tabs } from "./bits";
import { AddTeamForm, TeamsPanel, type TeamFields } from "./teams-panel";

// The judge portal: register teams, enter scores (which wait for the host's approval), see the teams

const REFRESH_MS = 6000;

export function JudgeDashboard({ initial, judgeName, isHost }: { initial: JudgeView; judgeName: string; isHost: boolean }) {
  const [view, setView] = useState(initial);
  const [tab, setTab] = useState("score");
  const [spinning, setSpinning] = useState(false);
  const base = `/api/tournaments/${initial.tournament.id}/judge`;

  const load = useCallback(async () => {
    const result = await api<JudgeView>(base);
    if (!result.ok) return result.error;
    setView(payload(result));
    return null;
  }, [base]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function post(body: Record<string, unknown>) {
    const result = await api<JudgeView>(base, { body });
    if (!result.ok) return result.error;
    setView(payload(result));
    return null;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <LiveDot status={todayStatus(view.config)} />
          <h1 className="mt-2 text-[clamp(28px,4vw,40px)] leading-[1.05] font-extrabold break-words text-white">{tournamentTitle(view.tournament, view.config.name)}</h1>
          <p className="mt-2 text-sm text-muted">{["Judge portal", judgeName, tournamentSubtitle(view.tournament)].filter(Boolean).join(" · ")}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          title="Refresh"
          aria-label="Refresh"
          onClick={async () => {
            setSpinning(true);
            await load();
            window.setTimeout(() => setSpinning(false), 500);
          }}
        >
          <RefreshCw aria-hidden="true" className={cn("size-4", spinning && "animate-spin")} />
        </Button>
      </div>

      <Tabs
        tabs={[
          { key: "score", label: "Enter scores" },
          { key: "register", label: "Register team" },
          { key: "teams", label: "Teams", count: view.teams.length },
        ]}
        active={tab}
        onChange={setTab}
        label="Judge sections"
      />

      {tab === "register" && <AddTeamForm label="Register team" onAdd={(fields: TeamFields) => post({ action: "register", ...fields })} />}
      {tab === "score" && <EnterScoreForm view={view} judgeName={judgeName} isHost={isHost} onScore={(teamId, roundId, points) => post({ action: "score", teamId, roundId, points })} />}
      {tab === "teams" && <TeamsPanel teams={view.teams} />}
    </div>
  );
}

function EnterScoreForm({ view, judgeName, isHost, onScore }: { view: JudgeView; judgeName: string; isHost: boolean; onScore: (teamId: string, roundId: string, points: number) => Promise<string | null> }) {
  const { config, teams, scores, pairings } = view;
  // Quiz nights and leagues: every team, every round. Draw formats: the released draw's rounds and teams.
  const pointsFormat = isPointsFormat(config);
  const rounds = pointsFormat ? config.rounds : releasedRounds(config, pairings);
  const available = pointsFormat ? teams : teamsForCurrentPairingStage(teams, pairings);
  const [teamId, setTeamId] = useState("");
  const [roundChoice, setRoundChoice] = useState("");
  const [points, setPoints] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const roundId = rounds.some((r) => r.id === roundChoice) ? roundChoice : (rounds[0]?.id ?? "");
  const range = roundRange(config, roundId);
  const existing = scores.find((s) => s.teamId === teamId && s.roundId === roundId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!teamId) return setError("Choose a team.");
    if (!roundId) return setError("Choose a round.");
    const value = Number(points);
    if (points === "" || Number.isNaN(value) || value < range.min || value > range.max) return setError(`Points for this round must be between ${range.min} and ${range.max}.`);
    setError("");
    setSaving(true);
    const failed = await onScore(teamId, roundId, value);
    setSaving(false);
    if (failed) return setError(failed);
    setPoints("");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  const recent = scores
    .filter((s: Score) => s.judgeName === judgeName)
    .sort((a, b) => b.enteredAt.localeCompare(a.enteredAt))
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      {teams.length === 0 ? (
        <EmptyNote>Register a team first, then come back to enter scores.</EmptyNote>
      ) : rounds.length === 0 ? (
        <EmptyNote>The host has not released a draw yet. Scores unlock once the draw is released.</EmptyNote>
      ) : (
        <form onSubmit={submit} className={cn(panelClass, "flex flex-col gap-4 p-4")}>
          {error && <Alert type="error">{error}</Alert>}
          {saved && <Alert type="success">{isHost ? "Score saved." : "Score saved. It counts once the host approves it."}</Alert>}
          <Select
            label="Team"
            value={teamId}
            onChange={(e) => {
              setTeamId(e.target.value);
              setPoints("");
            }}
          >
            <option value="">Select a team…</option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select
            label="Round"
            value={roundId}
            onChange={(e) => {
              setRoundChoice(e.target.value);
              setPoints("");
            }}
          >
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
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text">
              Points ({range.min}–{range.max})
            </span>
            <input type="number" min={range.min} max={range.max} value={points} onChange={(e) => setPoints(e.target.value)} placeholder={String(range.min)} className="h-12 border border-line bg-white/5 px-4 font-mono text-lg font-bold text-text focus:border-live focus:outline-none" />
            {existing && <span className="text-sm text-muted">Already scored {existing.points} by {existing.judgeName}. Saving replaces it.</span>}
          </label>
          <Button type="submit" size="sm" className="self-start" disabled={saving}>
            {saving ? "Saving…" : existing ? "Update score" : "Save score"}
          </Button>
        </form>
      )}

      {recent.length > 0 && (
        <div>
          <Eyebrow className="mb-2">Your recent entries</Eyebrow>
          <ul className="flex flex-col gap-2">
            {recent.map((s) => (
              <li key={s.id} className={cn(panelClass, "flex items-center justify-between gap-3 px-3 py-2 text-sm")}>
                <span className="min-w-0 truncate text-text">
                  {teams.find((t) => t.id === s.teamId)?.name ?? "—"} · {config.rounds.find((r) => r.id === s.roundId)?.name ?? "—"}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={cn("text-xs", s.approved ? "text-good" : "text-amber")}>{s.approved ? "approved" : "awaiting approval"}</span>
                  <span className="font-mono font-bold text-white">{s.points}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
