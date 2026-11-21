import "server-only";
import { and, eq } from "drizzle-orm";
import { guestCodeKey } from "@/lib/auth/tokens";
import { alias } from "drizzle-orm/pg-core";
import { ApiError } from "@/lib/api";
import type { Db } from "@/lib/db";
import { guestCodes, teams, tournamentState, tournaments } from "@/lib/db/schema";
import { officialAwards, officialFixture, roundTotals } from "./official-standings";
import { computeStandings, currentPairings, FORMATS, normalizeConfig, matchWinnerDetail, normalizeSharing, preliminaryScoresApproved, roundsForPairings, stageRoundsFor, STAGE_LABELS, todayStatus, tournamentTitle } from "./rules";
import { readScoringPlan } from "./scoring-plan";
import { looksLikeId, readState, tournamentById } from "./store";

export const validCode = (key: string) => /^[A-HJ-NP-Z2-9]{6}$/i.test(key);
export type Section = "overview" | "standings" | "draw";
const denied = () => new ApiError(404, "Tournament view unavailable.");

export async function listedTournaments(db: Db) {
  const config = alias(tournamentState,"directory_config");
  const rows = await db.select({ name: tournaments.name, code: guestCodes.code, sharing: tournamentState.value, config: config.value })
    .from(tournaments).innerJoin(guestCodes, eq(guestCodes.tournamentId, tournaments.id))
    .innerJoin(tournamentState, and(eq(tournamentState.tournamentId, tournaments.id), eq(tournamentState.key, "sharing")))
    .leftJoin(config,and(eq(config.tournamentId,tournaments.id),eq(config.key,"config")));
  return rows.filter(row => {
    const s = normalizeSharing(row.sharing);
    return s.listed && (s.showStandings || (s.showDraw && FORMATS[normalizeConfig(row.config).format].hasDraw));
  }).map(({ name, code }) => ({ name, code }));
}

export function spectatorView(db: Db, key: string, section: string = "overview", roomId?: string) {
  return db.transaction(async tx => {
    let id = key;
    if (!looksLikeId(key)) {
      if (!validCode(key)) throw denied();
      const [match] = await tx.select({ id: guestCodes.tournamentId }).from(guestCodes).where(eq(guestCodes.codeKey,guestCodeKey(key)));
      if (!match) throw denied();
      id = match.id;
    }
    const t = await tournamentById(tx,id);
    if (!t) throw denied();
    const { config, sharing, scores, pairings, rooms } = await readState(tx, t.id);
    const standings = sharing.showStandings;
    const draw = sharing.showDraw && FORMATS[config.format].hasDraw;
    if (!(standings || draw) || !["overview","standings","draw"].includes(section) ||
        (section === "standings" && !standings) || (section === "draw" && !draw) ||
        (roomId !== undefined && (section !== "standings" || !rooms.some(r => r.id === roomId)))) throw denied();
    const room = rooms.find(r => r.id === roomId);
    const header = { title: tournamentTitle(t, config.name), about: sharing.about, format: config.format,
      competitionStatus: t.status, status: todayStatus(config), standings, draw, room: room?.name ?? null };
    const [source] = await tx.select({ engine: tournaments.scoringEngineVersion }).from(tournaments).where(eq(tournaments.id,t.id));
    const relational = source.engine === "room_v1";
    if (room && !relational && !draw) throw denied(); // Legacy room membership comes solely from the draw.
    const selectable = standings && (draw || (relational && !FORMATS[config.format].hasDraw)) ? rooms.filter(r => !room || r.id === room.id).map(({id,name}) => ({id,name})) : [];
    if (section === "overview") return { ...header, rooms: selectable, tables: [], fixtures: [], contexts: [], updatedAt: null };
    const [doc] = relational ? await tx.select({ value: tournamentState.value }).from(tournamentState)
      .where(and(eq(tournamentState.tournamentId,t.id), eq(tournamentState.key,"scoringPlan"))) : [];
    const plan = readScoringPlan(doc?.value);
    const pairs = pairings.filter(p => p.released && (!room || p.roomId === room.id));
    const rosters = plan.rosters.filter(r => r.released && (!room || r.roomId === room.id));
    // In a paired format a room roster would disclose a hidden draw.
    if (room && FORMATS[config.format].hasDraw && !draw) throw denied();
    const awards = relational && standings ? await officialAwards(tx,t.id,room?.id) : [];
    const eligible = new Set([...pairs.flatMap(p => [p.teamAId,p.teamBId]), ...rosters.flatMap(r => r.teamIds), ...awards.map(a => a.teamId)]);
    const registered = await tx.select({ id: teams.id, name: teams.name, category: teams.category }).from(teams).where(eq(teams.tournamentId,t.id));
    const participants = registered.filter(team => !room || eligible.has(team.id));
    const approved = scores.filter(s => s.approved && (!room || pairs.some(p => [p.teamAId,p.teamBId].includes(s.teamId) &&
      stageRoundsFor(config,p.stage,p.matchLabel).some(r => r.id === s.roundId))));
    const totals = relational ? roundTotals(awards) : approved;
    const name = (id?: string | null) => registered.find(team => team.id === id)?.name ?? null;
    const fixtures = draw ? (section === "draw" ? currentPairings(pairs,true) : config.format === "knockout" ? pairs : []).map(p => ({
      stage: STAGE_LABELS[p.stage], label: p.matchLabel, room: rooms.find(r => r.id === p.roomId)?.name ?? null,
      a: name(p.teamAId), b: name(p.teamBId), winner: !standings ? null : name(relational ?
        officialFixture(p,config,plan,awards).winnerId : matchWinnerDetail(p,config,approved).winnerId),
    })) : [];
    const prelim = config.rounds.filter(r => r.stage === "preliminary");
    function table(label: string, rounds: typeof prelim, entrants = participants) {
      return { label, rows: computeStandings(entrants,totals,rounds).map(t => ({ name: t.name, schoolOrCategory: t.category, total: t.total,
        rounds: rounds.map(r => ({ name: r.name, points: t.byRound[r.id] ?? null })) })) };
    }
    const tables = section === "standings" ? [config.format === "championship" ? table("Preliminary rounds",prelim) : table("Standings",config.rounds)] : [];
    if (section === "standings" && config.format === "championship" && draw) {
      const knockout = roundsForPairings(config,pairs).filter(r => r.stage !== "preliminary");
      const globalAwards = knockout.length && room && relational ? await officialAwards(tx,t.id) : awards;
      const seedScores = relational ? roundTotals(globalAwards) : scores.filter(s => s.approved);
      const ready = relational ? prelim.length > 0 && prelim.every(r => {
        const matches = pairings.filter(p => p.stage === "preliminary" && p.matchLabel === r.match);
        return matches.length && registered.every(t => matches.some(p => [p.teamAId,p.teamBId].includes(t.id))) &&
          matches.every(p => officialFixture(p,config,plan,globalAwards).complete);
      }) : preliminaryScoresApproved(config,approved);
      if (knockout.length && ready) tables.push(table("Break rounds",knockout,computeStandings(registered,seedScores,prelim)
        .slice(0,config.qualificationCount || 8).filter(t => !room || eligible.has(t.id))));
    }
    const dates = relational ? awards.map(a => a.updatedAt) : approved.map(s => s.approvedAt).filter((v): v is string => !!v);
    const contexts = !room ? [] : [...new Set([...currentPairings(pairs,true).map(p => [STAGE_LABELS[p.stage],p.matchLabel].filter(Boolean).join(" · ")),
      ...rosters.map(r => config.rounds.find(round => round.id === r.roundId)?.name ?? "").filter(Boolean)])];
    return { ...header, rooms: selectable, tables, fixtures, contexts, updatedAt: standings ? dates.sort().at(-1) ?? null : null };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export type SpectatorView = Awaited<ReturnType<typeof spectatorView>>;
