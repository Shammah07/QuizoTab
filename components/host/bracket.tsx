import { cn } from "@/lib/cn";
import { KNOCKOUT_STAGES, matchWinner, matchWinnerDetail, STAGE_LABELS, type Pairing, type Score, type Team, type TournamentConfig } from "@/lib/tournament/rules";
import { EmptyNote, Eyebrow } from "./bits";

// The matchups of one stage, winners marked, as the audience sees them

type Row = Pairing & { winnerId: string | null; viaTiebreak: boolean };

export function BracketStageBlock({ title, rows, teams, roomLabel }: { title: string; rows: Row[]; teams: Team[]; roomLabel?: (pairing: Pairing) => string }) {
  const teamName = (id: string | null) => (id ? (teams.find((t) => t.id === id)?.name ?? "Unknown team") : "Bye");
  const teamCategory = (id: string | null) => (id ? (teams.find((t) => t.id === id)?.category ?? "") : "");
  const side = (id: string | null, winner: boolean, right = false) => (
    <span className={cn("flex-1 border px-3 py-2", winner ? "border-good/60 bg-good/10 font-semibold text-white" : "border-line bg-panel text-text", right && "text-right")}>
      <span className="block">{teamName(id)}</span>
      {teamCategory(id) && <span className="block text-xs font-normal text-muted">{teamCategory(id)}</span>}
    </span>
  );
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow className="text-live">{title}</Eyebrow>
      {rows.map((p) => (
        <div key={p.id}>
          <div className="flex items-stretch gap-2 text-sm">
            {side(p.teamAId, Boolean(p.winnerId) && p.winnerId === p.teamAId)}
            <span className="self-center font-mono text-xs text-muted">vs</span>
            {side(p.teamBId, Boolean(p.winnerId) && p.winnerId === p.teamBId, true)}
          </div>
          {roomLabel && <p className="mt-1 text-center text-xs text-muted">{roomLabel(p)}</p>}
          {p.viaTiebreak && <p className="mt-0.5 text-center text-xs text-good">Decided by Category of Choice tiebreaker</p>}
        </div>
      ))}
    </div>
  );
}

// Every released knockout stage of a knockout cup, and the champion once the final has a winner
export function KnockoutBracket({ config, teams, scores, pairings }: { config: TournamentConfig; teams: Team[]; scores: Score[]; pairings: Pairing[] }) {
  const stages = KNOCKOUT_STAGES.filter((stage) => pairings.some((p) => p.stage === stage && p.released));
  if (stages.length === 0) return <EmptyNote>The draw hasn&apos;t been released yet.</EmptyNote>;
  const final = pairings.find((p) => p.stage === "final" && p.released);
  const championId = final ? matchWinner(final, config, scores) : null;
  const champion = championId ? teams.find((t) => t.id === championId) : null;
  return (
    <div className="flex flex-col gap-5">
      {champion && (
        <div className="border border-amber bg-amber/10 p-5 text-center">
          <Eyebrow className="text-amber">Champion</Eyebrow>
          <p className="wide mt-1 font-display text-3xl font-extrabold text-white">{champion.name}</p>
        </div>
      )}
      {stages.map((stage) => (
        <BracketStageBlock key={stage} title={STAGE_LABELS[stage]} teams={teams} rows={pairings.filter((p) => p.stage === stage && p.released).map((p) => ({ ...p, ...matchWinnerDetail(p, config, scores) }))} />
      ))}
    </div>
  );
}
