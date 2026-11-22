import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull, like, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import type { Session } from "@/lib/auth/session";
import type { Db } from "@/lib/db";
import { tournamentScoreEntries as entries, tournaments, tournamentState as state } from "@/lib/db/schema";
import { withRoomOwner } from "./room-access";
import { officialAwards, type OfficialAward } from "./official-standings";
import { computeStandings, generateSwissPairings, generateFoldPairingsForStage, KNOCKOUT_STAGES, isPointsFormat, matchWinnerDetail, prelimMatches, type Pairing, type TournamentConfig } from "./rules";
import { hasLaterDraw, lifecycleSnapshot } from "./fixture-lifecycle";
import { loadTeams, writeState } from "./store";

type Attempt = Pick<typeof entries.$inferSelect, "contextId" | "teamId" | "roomId" | "roundId" | "points">;
type PublicTeam = {id:string; name:string};

// Simulate exactly one effective award replacement. Stored fixtures can be manually
// paired; treat the whole later group as dependent when its competitive inputs change.
export function compareCorrection(config:TournamentConfig, draw:Pairing[], teams:PublicTeam[], awards:OfficialAward[],
  change:Attempt, previous:number) {
  const source = draw.find(p => p.id === change.contextId && p.roomId === change.roomId);
  const same = (a:OfficialAward) => a.roomId === change.roomId && a.contextId === change.contextId &&
    a.teamId === change.teamId && a.roundId === change.roundId;
  if (!awards.some(same)) throw new ApiError(409,"The effective award is unavailable.");
  const after = awards.map(a => same(a) ? {...a, points:a.points + change.points - previous} : a);
  function outcome(rows:OfficialAward[], fixture = source) {
    const result = fixture ? matchWinnerDetail(fixture,config,rows.filter(a => a.contextId === fixture.id && a.roomId === fixture.roomId)) : null;
    const rounds = config.rounds.filter(r => isPointsFormat(config) || r.stage === "preliminary");
    const ranks = (selected:typeof rounds) => computeStandings(teams,rows,selected).map(t => t.id);
    const ranked = config.format === "knockout" ? [] : ranks(rounds);
    const seeds = isPointsFormat(config) ? ranked : ranked.slice(0,config.qualificationCount);
    const swiss = source?.stage === "preliminary" ? prelimMatches(config).slice(0,-1).map((_,i,labels) =>
      ranks(rounds.filter(r => labels.slice(0,i+1).includes(r.match ?? "")))) : [];
    return {winner:result?.winnerId ?? null, tiebreak:result?.viaTiebreak ?? false, seeds, swiss};
  }
  const before = outcome(awards);
  const projected = outcome(after);
  // A newly created tie needs its own ruling. An old, previously unused
  // tiebreak cannot name the official winner of the corrected result.
  const retireTiebreak = before.tiebreak !== projected.tiebreak;
  const next = retireTiebreak && source ? outcome(after,{...source,tiebreakWinnerId:null}) : projected;
  const different = (a:unknown,b:unknown) => JSON.stringify(a) !== JSON.stringify(b);
  const changes:string[] = [];
  if (before.winner !== next.winner) changes.push("winner");
  if (retireTiebreak) changes.push("tiebreak");
  if (!isPointsFormat(config) && different([...before.seeds].sort(),[...next.seeds].sort())) changes.push("qualification");
  if (different(before.seeds,next.seeds)) changes.push(isPointsFormat(config) ? "ranking" : "seeding");
  if (different(before.swiss,next.swiss)) changes.push("preliminary seed order");
  const later = source && changes.length ? draw.filter(p => hasLaterDraw(source,[p],config)) : [];
  // Compare generated slots on either side of the correction, independently of
  // any manual edits in the saved bracket. Once a feeder changes participants,
  // results of later matches cannot be predicted from its historical scores.
  const slotChanges = new Map<string,{previous:(string|null)[]; proposed:(string|null)[]}>();
  const stages = KNOCKOUT_STAGES.filter(stage => draw.some(p => p.stage === stage));
  const groups = [...prelimMatches(config),...stages];
  function slots(fixtures:Pairing[],rows:OfficialAward[],seeds:string[]) {
    const p = fixtures[0];
    if (p.stage === "preliminary") return generateSwissPairings(p.matchLabel!,teams,config,rows,draw);
    if (p.stage === "quiz" || p.stage === "league") return [];
    const index = stages.indexOf(p.stage);
    const opener = draw.filter(f => f.stage === stages[0]);
    const openingSeeds = config.format === "championship" ? seeds :
      [...opener.map(f=>f.teamAId),...opener.map(f=>f.teamBId).reverse()].filter((id):id is string=>!!id);
    const winners = new Set(draw.filter(f => f.stage === stages[index-1]).map(f =>
      f.id === source?.id ? (rows === awards ? before.winner : next.winner) : matchWinnerDetail(f,config,rows.filter(a=>a.contextId===f.id && a.roomId===f.roomId)).winnerId));
    const entrants = index === 0 ? openingSeeds : openingSeeds.filter(id=>winners.has(id));
    return generateFoldPairingsForStage(entrants.map(id=>({id})),p.stage,[]);
  }
  for (const group of groups) {
    const fixtures = later.filter(p => (p.stage==="preliminary" ? p.matchLabel : p.stage)===group);
    if (!fixtures.length) continue;
    const oldSlots = slots(fixtures,awards,before.seeds);
    const newSlots = slots(fixtures,after,next.seeds);
    fixtures.forEach((p,i) => {
      const members = (pairs:Pairing[]) => [pairs[i]?.teamAId ?? null,pairs[i]?.teamBId ?? null];
      if (different(members(oldSlots),members(newSlots))) slotChanges.set(p.id,{previous:members(oldSlots),proposed:members(newSlots)});
    });
  }
  if (slotChanges.size) changes.push("downstream participants");
  return {changes,before,after:next,source,later,slotChanges};
}

const action = z.enum(["hold","resume","withdraw","uphold"]);
const command = z.strictObject({scoreId:z.uuid(),action,reason:z.string().trim().min(3).max(1000),
  version:z.string().regex(/^[a-f0-9]{64}$/),requestId:z.uuid()});
const record = z.object({scoreId:z.string(),action,reason:z.string(),version:z.string(),requestId:z.string(),
  actor:z.number(),at:z.string(),contextId:z.string(),roomId:z.string()});
const digest = (value:unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function rulings(tx:Db,id:string) {
  const rows = await tx.select({value:state.value}).from(state)
    .where(and(eq(state.tournamentId,id),like(state.key,"ruling:%"))).orderBy(asc(state.key));
  return rows.map(r => record.parse(r.value));
}

export async function disputes(tx:Db,id:string) {
  const prior = alias(entries,"effective_predecessor");
  const pending = await tx.select({entry:entries,previous:prior.points}).from(entries).innerJoin(prior,
    and(eq(entries.correctionOf,prior.id),eq(prior.status,"approved")))
    .where(and(eq(entries.tournamentId,id),eq(entries.status,"pending"),isNotNull(entries.correctionOf)));
  if (!pending.length) return [];
  const snapshot = await lifecycleSnapshot(tx,id);
  const awards = await officialAwards(tx,id);
  const teams = await loadTeams(tx,id);
  const history = await rulings(tx,id);
  const used = new Set((await tx.selectDistinct({id:entries.contextId}).from(entries)
    .where(eq(entries.tournamentId,id))).map(r => r.id));
  return pending.map(({entry,previous}) => {
    const impact = compareCorrection(snapshot.config,snapshot.pairings,teams,awards,entry,previous);
    const finalized = !!snapshot.plan.completedContexts?.includes(entry.contextId);
    const dependent = impact.later.map(p => ({...p,slotChange:impact.slotChanges.get(p.id) ?? null,scored:used.has(p.id),teamA:teams.find(t=>t.id===p.teamAId)?.name,
      teamB:teams.find(t=>t.id===p.teamBId)?.name}));
    const last = history.filter(r => r.scoreId === entry.id).at(-1);
    const conflict = !!impact.changes.length && (finalized || dependent.length > 0);
    const restricted = conflict || last?.action === "hold" || last?.action === "uphold";
    return {scoreId:entry.id,contextId:entry.contextId,roomId:entry.roomId,teamId:entry.teamId,team:teams.find(t=>t.id===entry.teamId)?.name,
      fixture:impact.source?.matchLabel ?? entry.contextId, previous,proposed:entry.points,finalized,dependent,changes:impact.changes,
      before:impact.before,after:impact.after,previousWinner:teams.find(t=>t.id===impact.before.winner)?.name,
      proposedWinner:teams.find(t=>t.id===impact.after.winner)?.name,last,restricted,
      version:digest([entry.id,snapshot.configRevision,snapshot.lifecycleRevision,dependent,impact.before,impact.after,last])};
  });
}

export async function guardDisputedChanges(tx:Db,id:string) {
  if ((await disputes(tx,id)).some(d => d.restricted)) throw new ApiError(409,"Resolve pending adjudication before changing the competition setup.");
}

// Membership and team names feed qualification and the alphabetical seed tiebreak.
export async function guardSeedInputs(tx:Db,id:string) {
  const [source] = await tx.select({engine:tournaments.scoringEngineVersion}).from(tournaments)
    .where(eq(tournaments.id,id)).for("update");
  if (source?.engine !== "room_v1") return;
  await guardDisputedChanges(tx,id);
  const snapshot = await lifecycleSnapshot(tx,id);
  if (snapshot.plan.completedContexts?.length || snapshot.pairings.some(p=>hasLaterDraw(p,snapshot.pairings,snapshot.config))) {
    throw new ApiError(409,"Team membership and seed tiebreak names are protected by the recorded competition results.");
  }
}

export async function ownerAdjudication(db:Db,id:string,session:Session|null,input?:unknown) {
  return withRoomOwner(db,id,session,async tx => {
    const [engine] = await tx.select({engine:tournaments.scoringEngineVersion}).from(tournaments).where(eq(tournaments.id,id));
    if (engine.engine !== "room_v1") throw new ApiError(409,"Room scoring is disabled.");
    const history = await rulings(tx,id);
    const cases = await disputes(tx,id);
    if (input === undefined) return {cases:cases.filter(c => c.restricted),history};
    const [tournament] = await tx.select({status:tournaments.status}).from(tournaments).where(eq(tournaments.id,id));
    if (tournament.status !== "active") throw new ApiError(409,"Tournament is not active.");
    const parsed = command.safeParse(input);
    if (!parsed.success) throw new ApiError(400,"Provide the proposal, current version, action, reason and request ID.");
    const data = parsed.data;
    const retry = history.find(r => r.requestId === data.requestId);
    if (retry) {
      if (retry.actor !== session!.userId || retry.scoreId !== data.scoreId || retry.version !== data.version ||
          retry.reason !== data.reason || retry.action !== data.action) throw new ApiError(409,"Request ID already used.");
      return {receipt:retry};
    }
    const c = cases.find(c => c.scoreId === data.scoreId);
    if (!c?.restricted || c.version !== data.version) throw new ApiError(409,"The dispute changed. Refresh before ruling.");
    if (c.last?.action === "uphold" || c.last?.action === data.action || (data.action === "resume" && c.last?.action !== "hold")) {
      throw new ApiError(409,"This ruling is unavailable.");
    }
    if (data.action === "withdraw") {
      if (cases.some(other => other.scoreId !== c.scoreId && (other.last?.action === "hold" || other.last?.action === "uphold") &&
          other.dependent.some(p => c.dependent.some(f => f.id === p.id)))) throw new ApiError(409,"Another ruling protects this draft.");
      if (!c.dependent.length || c.dependent.some(p => p.scored || p.released)) throw new ApiError(409,"Only unpublished, unscored dependent fixtures can be withdrawn.");
      const {pairings,plan} = await lifecycleSnapshot(tx,id);
      const removed = new Set(c.dependent.map(p=>p.id));
      if (plan.completedContexts?.some(key=>removed.has(key))) throw new ApiError(409,"A dependent fixture is finalized.");
      await writeState(tx,id,"pairings",pairings.filter(p=>!removed.has(p.id)));
    }
    const event = {...data,actor:session!.userId,contextId:c.contextId,roomId:c.roomId,previous:c.previous,proposed:c.proposed,
      before:c.before,after:c.after,changes:c.changes,dependent:c.dependent};
    const [saved] = await tx.insert(state).values({tournamentId:id,key:"ruling:"+String(history.length+1).padStart(12,"0"),
      value:sql`${JSON.stringify(event)}::jsonb || jsonb_build_object('at',clock_timestamp())`}).returning({value:state.value});
    return {receipt:record.parse(saved.value)};
  });
}
