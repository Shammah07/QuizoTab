import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Session } from "@/lib/auth/session";
import type { Db } from "@/lib/db";
import { teams, tournaments, tournamentRoomStaff as staff, tournamentScoreEntries as entries, tournamentState } from "@/lib/db/schema";
import { authenticated, requireRoomHost, requireRoomJudge, type RoomRole } from "./room-access";
import { lifecycleSnapshot } from "./fixture-lifecycle";
import { officialAwards, roundTotals } from "./official-standings";
import { computeStandings, isPointsFormat, normalizeRooms, stageRoundsFor, STAGE_LABELS } from "./rules";
import { validRound } from "./scoring-plan";

export async function staffAssignments(db: Db, session: Session | null) {
  const actor = authenticated(session);
  const rows = await db.select({ id: tournaments.id, name: tournaments.name, status: tournaments.status,
    roomId: staff.roomId, role: staff.role, rooms: tournamentState.value }).from(staff)
    .innerJoin(tournaments, eq(tournaments.id, staff.tournamentId))
    .innerJoin(tournamentState, and(eq(tournamentState.tournamentId, tournaments.id), eq(tournamentState.key, "rooms")))
    .where(and(eq(staff.userId, actor.userId), isNull(staff.revokedAt))).orderBy(tournaments.name, staff.roomId);
  return rows.flatMap(({ rooms, ...row }) => {
    const room = normalizeRooms(rooms).find(r => r.id === row.roomId);
    return room ? [{ ...row, room: room.name }] : [];
  });
}

export function staffWorkspace(db: Db, id: string, roomId: string, session: Session | null, role: RoomRole) {
  const actor = authenticated(session);
  return db.transaction(async tx => {
    const room = await (role === "judge" ? requireRoomJudge : requireRoomHost)(tx,id,roomId,actor);
    const [t] = await tx.select({ name: tournaments.name, status: tournaments.status }).from(tournaments).where(eq(tournaments.id,id));
    const { config, pairings, plan } = await lifecycleSnapshot(tx,id);
    const registered = await tx.select({ id:teams.id, name:teams.name }).from(teams).where(eq(teams.tournamentId,id));
    const teamMap = new Map(registered.map(team => [team.id,team]));
    const released = isPointsFormat(config)
      ? plan.rosters.filter(r => r.roomId === roomId && r.released).map(r => ({id:r.id,
          label:config.rounds.find(round=>round.id===r.roundId)?.name ?? r.id, teams:r.teamIds,
          rounds:config.rounds.filter(round=>round.id===r.roundId), bye:false}))
      : pairings.filter(p => p.roomId === roomId && p.released).map(p => ({id:p.id,label:p.matchLabel || STAGE_LABELS[p.stage],
          teams:[p.teamAId,p.teamBId].filter((v):v is string=>!!v), rounds:stageRoundsFor(config,p.stage,p.matchLabel),bye:!p.teamAId || !p.teamBId}));
    const contexts = released.map(c => ({id:c.id,label:c.label,completed:!!plan.completedContexts?.includes(c.id),
      teams:c.teams.flatMap(id=>teamMap.get(id) ?? []),bye:c.bye,
      rounds:c.rounds.flatMap(r=>{
        const p = plan.rounds.find(round=>round.id===r.id);
        return p && validRound(config,p) ? [{id:r.id,name:r.name,questions:p.questions}] : [];
      })}));
    const roomEntries = role === "judge" && released.length ? await tx.select({id:entries.id,contextId:entries.contextId,roundId:entries.roundId,
      questionKey:entries.questionKey,teamId:entries.teamId,points:entries.points,status:entries.status,revision:entries.revision,
      reason:entries.reason,judgeId:entries.judgeUserId}).from(entries)
      .where(and(eq(entries.tournamentId,id),eq(entries.roomId,roomId),inArray(entries.contextId,released.map(c=>c.id))))
      .orderBy(desc(entries.createdAt),desc(entries.revision)) : [];
    const history = roomEntries.map(({judgeId,points,reason,...row})=>({...row,points:judgeId===actor.userId || row.status==="approved" ? points : null,reason:judgeId===actor.userId ? reason : null}));
    const awards = role === "room_host" ? await officialAwards(tx,id,roomId) : [];
    const eligible = new Set([...released.flatMap(c=>c.teams),...awards.map(a=>a.teamId)]);
    const entrants = registered.filter(team=>eligible.has(team.id));
    const standings = (config.format === "championship"
      ? [{label:"Preliminary rounds",entrants,rounds:config.rounds.filter(r=>r.stage==="preliminary")},
         {label:"Break rounds",entrants:entrants.filter(t=>pairings.some(p=>p.released && p.roomId===roomId && p.stage!=="preliminary" && (p.teamAId===t.id || p.teamBId===t.id))),rounds:config.rounds.filter(r=>r.stage!=="preliminary")}]
      : [{label:"Official room standings",entrants,rounds:config.rounds}]).filter(group=>group.rounds.length && group.entrants.length)
      .map(group=>({label:group.label,rows:computeStandings(group.entrants,roundTotals(awards),group.rounds).map(({id,name,total})=>({id,name,total}))}));
    return { tournament:t.name,status:t.status,room:room.name,userId:actor.userId,role,contexts,history,
      standings:role==="room_host" ? standings : [] };
  }, { isolationLevel:"repeatable read", accessMode:"read only" });
}
export type StaffWorkspace = Awaited<ReturnType<typeof staffWorkspace>>;
