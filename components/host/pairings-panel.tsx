"use client";

import { Shuffle, Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  advanceKnockout,
  formatOf,
  generateFirstKnockout,
  generateKnockoutDraw,
  generateMatch1Pairings,
  generateSwissPairings,
  isTiedNeedingBreak,
  knockoutSeedOrder,
  knockoutStagesFrom,
  knockoutStart,
  matchWinnerDetail,
  prelimMatches,
  preliminarySeedOrder,
  STAGE_LABELS,
  withStageRounds,
  type Judge,
  type Pairing,
  type Room,
  type Score,
  type Stage,
  type Team,
  type TournamentConfig,
} from "@/lib/tournament/rules";
import { ConfirmButton, fieldClass, iconButtonClass, panelClass } from "./bits";

// The Draw tab: generate each match or stage, fix pairings by hand, assign rooms, record
// tiebreaks and release the draw to the audience

type Props = {
  config: TournamentConfig;
  teams: Team[];
  scores: Score[];
  pairings: Pairing[];
  rooms: Room[];
  judges: Judge[];
  onPairingsChange: (pairings: Pairing[]) => Promise<string | null>;
  onConfigChange: (config: TournamentConfig) => Promise<string | null>;
};

type Section = { stage: Stage; matchLabel: string | null; label: string; ready: boolean; note: string; generate: () => Pairing[] };

export function PairingsPanel({ config, teams, scores, pairings, rooms, judges, onPairingsChange, onConfigChange }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const format = formatOf(config);
  const qualified = preliminarySeedOrder(teams, config, scores);
  const teamName = (id: string | null) => (id ? (teams.find((t) => t.id === id)?.name ?? "Unknown team") : "Bye");
  const inSection = (p: Pairing, stage: Stage, matchLabel: string | null) => p.stage === stage && (stage !== "preliminary" || p.matchLabel === matchLabel);
  const hasPairings = (stage: Stage, matchLabel: string | null) => pairings.some((p) => inSection(p, stage, matchLabel));

  // Championship: the preliminary matches, then the knockouts. Knockout cup: the knockouts only.
  const matches = format === "championship" ? prelimMatches(config) : [];
  const stages = knockoutStagesFrom(knockoutStart(config, teams, pairings));
  const seedOrder = () => (format === "knockout" ? knockoutSeedOrder(teams, pairings, stages[0]) : preliminarySeedOrder(teams, config, scores));

  const sections: Section[] = [
    ...matches.map((label, i) => ({
      stage: "preliminary" as const,
      matchLabel: label,
      label: `Preliminary · ${label}`,
      ready: i === 0 ? teams.length >= 2 : hasPairings("preliminary", matches[i - 1]),
      note: i === 0 ? "Random pairing: no standings exist yet." : "Paired by cumulative points, avoiding repeat opponents from earlier matches.",
      generate: () => (i === 0 ? generateMatch1Pairings(teams, label) : generateSwissPairings(label, teams, config, scores, pairings)),
    })),
    ...stages.map((stage, i) => ({
      stage,
      matchLabel: null,
      label: STAGE_LABELS[stage],
      ready: i === 0 ? (format === "knockout" ? teams.length >= 2 : qualified.length >= 2) : hasPairings(stages[i - 1], null),
      note:
        i > 0
          ? `The ${STAGE_LABELS[stages[i - 1]]} winners, re-seeded so the best seeds meet last.`
          : format === "knockout"
            ? `A random draw of all ${teams.length} teams. Uneven numbers get byes, which go to the top seeds.`
            : `Power-protected seeding from the top ${config.qualificationCount || 8} preliminary standings (best seed against worst).`,
      generate: () => (i === 0 ? (format === "knockout" ? generateKnockoutDraw(teams) : generateFirstKnockout(teams, config, scores)) : advanceKnockout(stages[i - 1], stage, seedOrder(), config, scores, pairings)),
    })),
  ];

  async function save(next: Pairing[]) {
    const failed = await onPairingsChange(next);
    setError(failed ?? "");
  }

  async function regenerate(section: Section) {
    setBusy(section.label);
    // A big knockout cup can start at a stage that has no rounds yet (a Round of 32)
    if (section.stage !== "preliminary" && !config.rounds.some((round) => round.stage === section.stage)) {
      const failed = await onConfigChange(withStageRounds(config, section.stage as Parameters<typeof withStageRounds>[1]));
      if (failed) {
        setError(failed);
        setBusy(null);
        return;
      }
    }
    const others = pairings.filter((p) => !inSection(p, section.stage, section.matchLabel));
    await save([...others, ...section.generate()]);
    setBusy(null);
  }

  const patch = (id: string, changes: Partial<Pairing>) => save(pairings.map((p) => (p.id === id ? { ...p, ...changes } : p)));
  const setReleased = (section: Section, released: boolean) => save(pairings.map((p) => (inSection(p, section.stage, section.matchLabel) ? { ...p, released } : p)));

  // Moving a team into a matchup swaps it with whoever held that place, so no team plays twice in one stage
  async function updateTeam(pairing: Pairing, side: "teamAId" | "teamBId", teamId: string | null) {
    const other = side === "teamAId" ? pairing.teamBId : pairing.teamAId;
    if (teamId && teamId === other) return;
    const stagePairings = pairings.filter((item) => item.id !== pairing.id && inSection(item, pairing.stage, pairing.matchLabel));
    const previous = teamId ? stagePairings.find((item) => item.teamAId === teamId || item.teamBId === teamId) : undefined;
    if (!previous) return patch(pairing.id, { [side]: teamId });
    const previousSide = previous.teamAId === teamId ? "teamAId" : "teamBId";
    const replaced = pairing[side];
    await save(
      pairings.map((item) => {
        if (item.id === pairing.id) return { ...item, [side]: teamId };
        if (item.id === previous.id) return { ...item, [previousSide]: replaced };
        return item;
      }),
    );
  }

  const roomLabel = (room: Room) => {
    const host = judges.find((j) => j.id === room.judgeId);
    const panel = room.panelistIds.map((id) => judges.find((j) => j.id === id)?.name).filter(Boolean);
    return `${room.name}${host ? ` · Host: ${host.name}` : " · No host assigned"}${panel.length ? ` · Panel: ${panel.join(", ")}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert type="error">{error}</Alert>}

      {pairings.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-bad/40 bg-bad/5 p-4">
          <div>
            <p className="font-semibold text-white">Drew the wrong pairings?</p>
            <p className="mt-1 text-sm text-muted">Clears every pairing in every stage so you can redraw from scratch. Teams and scores are kept.</p>
          </div>
          <ConfirmButton confirmLabel="Click again to clear the whole draw" onConfirm={() => save([])}>
            Reset draw
          </ConfirmButton>
        </div>
      )}

      {sections.map((section) => {
        const rows = pairings.filter((p) => inSection(p, section.stage, section.matchLabel));
        const released = rows.length > 0 && rows.every((row) => row.released);
        return (
          <section key={section.label} className={cn(panelClass, "p-4")}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-bold text-white [font-stretch:100%]">{section.label}</h3>
              <div className="flex flex-wrap gap-2">
                {rows.length > 0 && (
                  <Button variant={released ? "neon" : "line"} size="sm" onClick={() => setReleased(section, !released)}>
                    {released ? "Released · hide" : "Release to the audience"}
                  </Button>
                )}
                <Button variant="line" size="sm" onClick={() => regenerate(section)} disabled={!section.ready || busy === section.label}>
                  <Shuffle aria-hidden="true" className="mr-2 size-4" /> {rows.length ? "Regenerate" : "Generate"}
                </Button>
              </div>
            </div>
            <p className="mb-3 text-sm text-muted">{section.note}</p>

            {!section.ready ? (
              <p className="text-sm text-muted">Waiting on the previous stage.</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted">Not generated yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {rows.map((p) => {
                  const knockout = section.stage !== "preliminary";
                  const detail = knockout ? matchWinnerDetail(p, config, scores) : { winnerId: null, viaTiebreak: false };
                  const tied = knockout && isTiedNeedingBreak(p, config, scores);
                  const option = (team: Team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                      {team.category ? ` · ${team.category}` : ""}
                    </option>
                  );
                  return (
                    <li key={p.id} className="border border-line bg-white/[0.03] p-3">
                      <div className="flex items-center gap-2">
                        <select value={p.teamAId ?? ""} aria-label="First team" onChange={(e) => updateTeam(p, "teamAId", e.target.value || null)} className={cn(fieldClass, "h-10 min-w-0 flex-1 text-sm", detail.winnerId && detail.winnerId === p.teamAId && "border-good")}>
                          <option value="">Bye</option>
                          {teams.map(option)}
                        </select>
                        <span className="text-xs text-muted">vs</span>
                        <select value={p.teamBId ?? ""} aria-label="Second team" onChange={(e) => updateTeam(p, "teamBId", e.target.value || null)} className={cn(fieldClass, "h-10 min-w-0 flex-1 text-sm", detail.winnerId && detail.winnerId === p.teamBId && "border-good")}>
                          <option value="">Bye</option>
                          {teams.map(option)}
                        </select>
                        <button type="button" onClick={() => save(pairings.filter((item) => item.id !== p.id))} title="Delete this matchup" aria-label={`Delete ${p.matchLabel ?? "matchup"}`} className={cn(iconButtonClass, "hover:text-bad")}>
                          <Trash2 aria-hidden="true" className="size-4" />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className="font-mono text-muted">{p.matchLabel}</span>
                        <span className={p.released ? "text-good" : "text-muted"}>{p.released ? "Released" : "Private draw"}</span>
                        {detail.winnerId && <span className="text-good">Winner: {teamName(detail.winnerId)}</span>}
                        {detail.viaTiebreak && (
                          <button type="button" onClick={() => patch(p.id, { tiebreakWinnerId: null })} className="cursor-pointer text-muted underline">
                            Decided by tiebreaker · clear
                          </button>
                        )}
                      </div>
                      {rooms.length > 0 && (
                        <select value={p.roomId ?? ""} aria-label="Room" onChange={(e) => patch(p.id, { roomId: e.target.value || null })} className={cn(fieldClass, "mt-2 h-10 text-sm")}>
                          <option value="">No room assigned</option>
                          {rooms.map((room) => (
                            <option key={room.id} value={room.id}>
                              {roomLabel(room)}
                            </option>
                          ))}
                        </select>
                      )}
                      {tied && (
                        <div className="mt-2 border border-amber/50 bg-amber/10 p-3">
                          <p className="mb-2 text-sm font-semibold text-amber">Tied on points. Run the Category of Choice tiebreaker, then record the winner.</p>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="line" size="sm" onClick={() => patch(p.id, { tiebreakWinnerId: p.teamAId })}>
                              {teamName(p.teamAId)} wins
                            </Button>
                            <Button variant="line" size="sm" onClick={() => patch(p.id, { tiebreakWinnerId: p.teamBId })}>
                              {teamName(p.teamBId)} wins
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
