import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, count, eq, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api";
import type { Session } from "@/lib/auth/session";
import type { Db } from "@/lib/db";
import { tournaments, tournamentScoreEntries as entries, teams, tournamentState } from "@/lib/db/schema";
import { authenticated, withRoomOwner } from "./room-access";
import { roomSetup, validateDrawDependencies } from "./room-management";
import { hasLaterDraw, lifecycleSnapshot } from "./fixture-lifecycle";
import { disputes } from "./adjudication";
import { officialAwards, officialFixture } from "./official-standings";
import { isPointsFormat, roundRange, stageRoundsFor, STAGE_LABELS, type Pairing } from "./rules";
import { planSchema, saveScoringPlan, contextReadiness } from "./scoring-plan";
import { ownTournament } from "./store";

async function inputs(tx:Db,id:string) {
  const snapshot = await lifecycleSnapshot(tx,id);
  const setup = await roomSetup(tx,id);
  const registered = await tx.select({id:teams.id,name:teams.name}).from(teams).where(eq(teams.tournamentId,id)).orderBy(teams.id);
  const [t] = await tx.select({status:tournaments.status}).from(tournaments).where(eq(tournaments.id,id));
  const [source] = await tx.select({engine:tournaments.scoringEngineVersion}).from(tournaments).where(eq(tournaments.id,id));
  const [planClock]=await tx.select({stamp:sql<string>`${tournamentState.updatedAt}::text`}).from(tournamentState)
    .where(and(eq(tournamentState.tournamentId,id),eq(tournamentState.key,"scoringPlan")));
  const revision = createHash("sha256").update(JSON.stringify([planClock?.stamp,snapshot.configRevision,snapshot.lifecycleRevision,setup.revision,registered,t.status,source.engine])).digest("hex");
  return {...snapshot,...setup,registered,status:t.status,enabled:source.engine==="room_v1",revision};
}
type Inputs = Awaited<ReturnType<typeof inputs>>;
type Context = {id:string;roomId:string|null;label:string;released:boolean;members:string[];rounds:Inputs["config"]["rounds"];pair?:Pairing};

function contexts(data:Inputs):Context[] {
  const {config,plan,pairings}=data;
  if (isPointsFormat(config)) return plan.rosters.map(r=>{
    const rounds=config.rounds.filter(round=>round.id===r.roundId && round.stage===(config.format==="league"?"league":"quiz"));
    return {id:r.id,label:rounds[0]?.name ?? r.id,roomId:r.roomId,released:r.released,members:r.teamIds,rounds};
  });
  return pairings.map(p=>({id:p.id,roomId:p.roomId ?? null,label:p.matchLabel || STAGE_LABELS[p.stage],released:p.released,
    members:[p.teamAId,p.teamBId].filter((id):id is string=>!!id),rounds:stageRoundsFor(config,p.stage,p.matchLabel),pair:p}));
}

async function project(tx:Db,id:string,data:Inputs) {
  const {config,plan,pairings,registered}=data;
  const totals = await tx.select({roomId:entries.roomId,contextId:entries.contextId,status:entries.status,n:count()}).from(entries)
    .where(eq(entries.tournamentId,id)).groupBy(entries.roomId,entries.contextId,entries.status);
  const awards = await officialAwards(tx,id);
  const conflicts = (await disputes(tx,id)).filter(c=>c.restricted);
  const teamNames = new Map(registered.map(team=>[team.id,team.name]));
  const byContext = new Map<string,typeof awards>();
  const contextKey = (room:string|null,context:string)=>JSON.stringify([room,context]);
  for (const award of awards) {
    const key=contextKey(award.roomId,award.contextId);
    const rows=byContext.get(key);
    if (rows) rows.push(award); else byContext.set(key,[award]);
  }
  const roomCounts = new Map<string,{pending:number;approved:number}>();
  const pending = new Set<string>();
  const played = new Set<string>();
  for (const row of totals) {
    const key=contextKey(row.roomId,row.contextId);
    played.add(key);
    const sums=roomCounts.get(row.roomId) ?? {pending:0,approved:0};
    if (row.status==="pending") pending.add(key);
    if (row.status==="pending" || row.status==="approved") sums[row.status]+=row.n;
    roomCounts.set(row.roomId,sums);
  }
  const groups = new Map<string,string|null>();
  const monitored = contexts(data).map(c=>{
    const setup = contextReadiness(data,c);
    if (!c.pair && plan.rosters.some(r=>r.id!==c.id && r.released && r.roundId===c.rounds[0]?.id && r.teamIds.some(t=>c.members.includes(t)))) setup.push("Resolve overlapping room rosters.");
    if (c.pair) {
      const pair=c.pair;
      const group=pair.stage==="preliminary" ? pair.matchLabel ?? "" : pair.stage;
      if (!groups.has(group)) {
        try {
          validateDrawDependencies(config,pairings.filter(p=>!hasLaterDraw(pair,[p],config)),pairings,registered,awards,plan);
          groups.set(group,null);
        } catch (err) {if (!(err instanceof ApiError)) throw err;groups.set(group,err.message);}
      }
      const blocker=groups.get(group);
      if (blocker) setup.push(blocker);
    }
    const reasons=[...setup];
    if (!data.enabled) reasons.push("Room scoring is disabled.");
    if (!c.released) reasons.push("Release this competition context.");
    const relevant=conflicts.filter(d=>d.contextId===c.id || d.dependent.some(p=>p.id===c.id));
    const key=contextKey(c.roomId,c.id);
    const relevantAwards=byContext.get(key) ?? [];
    const members=new Set(c.members);
    const bye=c.pair && c.members.length===1;
    let missing=0;
    for (const r of c.rounds) {
      const questions=plan.rounds.find(p=>p.id===r.id)?.questions ?? [];
      if (bye) continue;
      const wanted=new Set(questions.map(q=>q.id));
      const approved=relevantAwards.filter(a=>a.roundId===r.id && members.has(a.teamId))
        .reduce((n,a)=>n+a.questions.filter(q=>wanted.has(q)).length,0);
      missing+=Math.max(0,c.members.length*questions.length-approved);
    }
    const completed=!!plan.completedContexts?.includes(c.id);
    const blockers=[...reasons];
    if (pending.has(key)) blockers.push("Review pending submissions or corrections.");
    if (missing) blockers.push("Approve the outstanding question scores.");
    if (c.pair && c.released && !missing && c.pair.stage!=="preliminary" &&
      !officialFixture(c.pair,config,{...plan,completedContexts:[c.id]},relevantAwards).winnerId) blockers.push("Resolve the fixture winner or tiebreak.");
    if (relevant.some(d=>d.dependent.some(p=>p.id===c.id) || d.last?.action==="hold" || d.last?.action==="uphold")) blockers.push("Resolve the administrator adjudication.");
    return {id:c.id,label:c.label,roomId:c.roomId,released:c.released,completed,missing,setup,reasons,blockers,hasHistory:played.has(key),participants:c.members.map(id=>teamNames.get(id) ?? "Unregistered team"),
      disputes:relevant.map(d=>({scoreId:d.scoreId,status:d.last?.action ?? "awaiting ruling",changes:d.changes}))};
  });
  return {revision:data.revision,enabled:data.enabled,status:data.status,pointsFormat:isPointsFormat(config),plan,
    rounds:config.rounds.map(r=>({id:r.id,name:r.name,...roundRange(config,r)})),teams:registered,
    unassigned:monitored.filter(c=>!data.rooms.some(r=>r.id===c.roomId)),
    rooms:data.rooms.map(room=>{
      const staff=data.assignments.filter(a=>a.roomId===room.id).map(({name,role})=>({name,role}));
      const list=monitored.filter(c=>c.roomId===room.id);
      const counts=roomCounts.get(room.id) ?? {pending:0,approved:0};
      return {id:room.id,name:room.name,staff,contexts:list,...counts,
        missing:list.reduce((n,c)=>n+c.missing,0),completed:list.filter(c=>c.completed).length};
    })};
}
export type RoomOperations = Awaited<ReturnType<typeof project>>;

export function readOperations(db:Db,id:string,session:Session|null) {
  const actor=authenticated(session);
  return db.transaction(async tx=>{
    if (!await ownTournament(tx,id,actor.userId)) throw new ApiError(404,"Tournament not found.");
    return project(tx,id,await inputs(tx,id));
  },{isolationLevel:"repeatable read",accessMode:"read only"});
}

// Caller holds the tournament row lock. Draft saves cannot publish or withdraw a roster.
export async function applyPlanCommand(tx:Db,id:string,command:Record<string,unknown>) {
  const data=await inputs(tx,id);
  if (command.revision!==data.revision) throw new ApiError(409,"Configuration changed. Reload before saving.");
  if (data.status==="archived") throw new ApiError(409,"Archived tournaments cannot be configured.");
  if (command.action==="save") {
    const parsed=planSchema.safeParse(command.plan);
    if (!parsed.success) throw new ApiError(400,"Provide valid round, question and roster identifiers and integer point limits.");
    const next=parsed.data;
    const released=(p:typeof next)=>p.rosters.filter(r=>r.released).sort((a,b)=>a.id.localeCompare(b.id));
    if (!isDeepStrictEqual(released(next),released(data.plan))) throw new ApiError(409,"Use the roster release or withdrawal action.");
    await saveScoringPlan(tx,id,next);
  } else if (command.action==="release" || command.action==="withdraw") {
    const roster=data.plan.rosters.find(r=>r.id===command.rosterId);
    if (!roster) throw new ApiError(404,"Roster not found.");
    const releasing=command.action==="release";
    if (roster.released===releasing) throw new ApiError(409,"Roster already has this release status.");
    if (releasing) {
      const c=contexts(data).find(c=>c.id===roster.id);
      if (!c) throw new ApiError(409,"Choose a points-format roster.");
      const reasons=contextReadiness(data,c);
      if (reasons.length) throw new ApiError(409,reasons.join(" "));
    }
    if (!releasing) {
      const [used]=await tx.select({id:entries.id}).from(entries).where(and(eq(entries.tournamentId,id),eq(entries.contextId,roster.id))).limit(1);
      if (used || data.plan.completedContexts?.includes(roster.id)) throw new ApiError(409,"Retain the roster with competition history.");
    }
    await saveScoringPlan(tx,id,{...data.plan,rosters:data.plan.rosters.map(r=>r.id===roster.id ? {...r,released:releasing} : r)});
  } else throw new ApiError(400,"Unknown plan action.");
}
export function changeOperations(db:Db,id:string,session:Session|null,command:Record<string,unknown>) {
  return withRoomOwner(db,id,session,async tx=>{
    await applyPlanCommand(tx,id,command);
    return project(tx,id,await inputs(tx,id));
  });
}
