import "server-only";
import { disputes } from "./adjudication";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import type { Session } from "@/lib/auth/session";
import type { Db } from "@/lib/db";
import { teams, tournaments, tournamentScoreEntries as scores, tournamentState as state } from "@/lib/db/schema";
import { officialAwards, officialFixture } from "./official-standings";
import { withRoomOwner, withScoringRoom } from "./room-access";
import { isPointsFormat, normalizeConfig, normalizePairings, prelimMatches, stageRoundsFor, type Pairing, type TournamentConfig, KNOCKOUT_STAGES } from "./rules";
import { readScoringPlan, validRound } from "./scoring-plan";

const key = z.string().min(1).max(80);
const closeReceipt = z.object({ action: z.literal("close"), actor: z.number(), contextId: key });
const versions = { contextId: key, configRevision: z.string().regex(/^[a-f0-9]{64}$/), lifecycleRevision: z.int().nonnegative() };
const close = z.strictObject(versions);
const reopen = close.extend({ reason: z.string().trim().min(3).max(1000) });
type Command = z.infer<typeof reopen> | z.infer<typeof close>;

export function hasLaterDraw(pair: Pairing, draw: Pairing[], config: TournamentConfig) {
  const order: string[] = [...prelimMatches(config), ...KNOCKOUT_STAGES];
  const group = (p: Pairing) => p.stage === "preliminary" ? p.matchLabel ?? "" : p.stage;
  const prior = order.indexOf(group(pair));
  return draw.some(p => group(p) !== group(pair) && (prior < 0 || order.indexOf(group(p)) < 0 || order.indexOf(group(p)) > prior));
}

export async function lifecycleSnapshot(tx: Db, id: string) {
  const docs = await tx.select({
    key: state.key, value: state.value,
    definition: sql<string>`(case when ${state.key} = 'scoringPlan' then ${state.value} - 'completedContexts' else ${state.value} end)::text`
  }).from(state).where(and(eq(state.tournamentId, id), inArray(state.key, ["config", "pairings", "scoringPlan"]))).orderBy(state.key);
  const value = (key: string) => docs.find(d => d.key === key)?.value;
  const [last] = await tx.select({ key: state.key, value: state.value }).from(state)
    .where(and(eq(state.tournamentId, id), like(state.key, "fixtureEvent:%"))).orderBy(desc(state.key)).limit(1);
  const lifecycleRevision = last ? Number(last.key.slice("fixtureEvent:".length)) : 0;
  const configRevision = createHash("sha256").update(JSON.stringify(docs.map(d => [d.key, d.definition]))).digest("hex");
  return {
    config: normalizeConfig(value("config")), pairings: normalizePairings(value("pairings")),
    plan: readScoringPlan(value("scoringPlan")), lifecycleRevision, configRevision, last: last?.value
  };
}

type Snapshot = Awaited<ReturnType<typeof lifecycleSnapshot>>;
type Roster = Snapshot["plan"]["rosters"][number];

async function requireCompleteCoverage(tx: Db, id: string, roomId: string, contextId: string,
  { config, plan }: Snapshot, pair: Pairing | undefined, roster: Roster | undefined) {
  if (!(pair?.released || roster?.released)) throw new ApiError(409, "Release this context before completion.");
  const [pending] = await tx.select({ id: scores.id }).from(scores).where(and(eq(scores.tournamentId, id),
    eq(scores.roomId, roomId), eq(scores.contextId, contextId), eq(scores.status, "pending"))).limit(1);
  if (pending) throw new ApiError(409, "Resolve all pending reviews before completion.");
  const members = roster?.teamIds ?? [pair?.teamAId, pair?.teamBId].filter((v): v is string => !!v);
  const registered = members.length ? await tx.select({ id: teams.id }).from(teams)
    .where(and(eq(teams.tournamentId, id), inArray(teams.id, members))).for("key share") : [];
  if (!members.length || registered.length !== members.length) throw new ApiError(409, "Invalid context participants.");
  const rounds = roster ? config.rounds.filter(r => r.id === roster.roundId && r.stage === (config.format === "league" ? "league" : "quiz"))
    : stageRoundsFor(config, pair!.stage, pair!.matchLabel);
  if (pair && (pair.stage === "quiz" || pair.stage === "league" || (config.format === "knockout" && pair.stage === "preliminary"))) {
    throw new ApiError(409, "Invalid competition stage.");
  }
  const awards = (await officialAwards(tx, id, roomId)).filter(a => a.contextId === contextId);
  if (!pair || members.length !== 1) {
    if (!rounds.length || !rounds.every(r => {
      const planned = plan.rounds.find(p => p.id === r.id);
      return planned && validRound(config, planned) && members.every(team => {
        const row = awards.find(a => a.teamId === team && a.roundId === r.id);
        return planned.questions.every(q => row?.questions.includes(q.id));
      });
    })) throw new ApiError(409, "Required questions are missing approved scores.");
  }
  if (pair) {
    const result = officialFixture(pair, config, { ...plan, completedContexts: [contextId] }, awards);
    if (!result.complete || (pair.stage !== "preliminary" && !result.winnerId)) throw new ApiError(409, "Resolve the fixture outcome before completion.");
  }
}

async function lifecycle(tx: Db, id: string, roomId: string, actor: number, contextId: string, action: "read" | "close" | "reopen", command?: Command) {
  const s = await lifecycleSnapshot(tx, id);
  const { config, pairings, plan, configRevision, lifecycleRevision } = s;
  if (!plan.rounds.length) throw new ApiError(409, "Configure a valid scoring plan first.");
  const points = isPointsFormat(config);
  const pairs = pairings.filter(p => p.id === contextId);
  const rosters = plan.rosters.filter(r => r.id === contextId);
  const pair = !points && pairs.length === 1 && pairs[0].roomId === roomId ? pairs[0] : undefined;
  const roster = points && rosters.length === 1 && rosters[0].roomId === roomId ? rosters[0] : undefined;
  if (!pair && !roster) throw new ApiError(404, "Context not found in this room.");
  const markers = plan.completedContexts ?? [];
  const completed = markers.includes(contextId);
  const view = { contextId, configRevision, lifecycleRevision, completed };
  if (!command) return view;
  if (command.configRevision !== configRevision) throw new ApiError(409, "Configuration changed. Refresh before continuing.");
  // Recover a lost close response until another lifecycle transition commits.
  const lastClose = closeReceipt.safeParse(s.last);
  if (action === "close" && completed && command.lifecycleRevision === lifecycleRevision - 1 &&
    lastClose.success && lastClose.data.actor === actor && lastClose.data.contextId === contextId) return view;
  if (command.lifecycleRevision !== lifecycleRevision) throw new ApiError(409, "Lifecycle revision changed. Refresh before continuing.");
  const pendingCases = await disputes(tx,id);
  if (pendingCases.some(c => c.restricted && (c.dependent.some(p => p.id === contextId) ||
      (c.contextId === contextId && (c.last?.action === "hold" || c.last?.action === "uphold"))))) {
    throw new ApiError(409,"An unresolved adjudication protects this fixture.");
  }
  if (action === "close") {
    if (completed) return view;
    await requireCompleteCoverage(tx, id, roomId, contextId, s, pair, roster);
  } else {
    if (!completed) throw new ApiError(409, "Context is already open.");
    if (pair && hasLaterDraw(pair, pairings, config)) throw new ApiError(409, "A later draw depends on this result. Reopening requires adjudication.");
  }
  const closing = action === "close";
  const revision = lifecycleRevision + 1;
  const event = {
    contextId, roomId, action, actor, configRevision, revision,
    ...("reason" in command ? { reason: command.reason } : {})
  };
  await tx.insert(state).values({
    tournamentId: id, key: "fixtureEvent:" + String(revision).padStart(12, "0"),
    value: sql`${JSON.stringify(event)}::jsonb || jsonb_build_object('at',clock_timestamp())`
  });
  await tx.update(state).set({
    value: { ...plan, completedContexts: closing ? [...markers, contextId] : markers.filter(k => k !== contextId) },
    updatedAt: sql`clock_timestamp()`
  }).where(and(eq(state.tournamentId, id), eq(state.key, "scoringPlan")));
  return { ...view, completed: closing, lifecycleRevision: revision };
}

function readContext(input: unknown) {
  const parsed = key.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "Provide a context ID.");
  return parsed.data;
}

export function roomCompletion(db: Db, id: string, room: string, session: Session | null, input: unknown, read = false) {
  return withScoringRoom(db, id, room, session, "room_host", async (tx, host, active) => {
    if (read) return lifecycle(tx, id, room, host.userId, readContext(input), "read");
    const cmd = close.safeParse(input);
    if (!cmd.success) throw new ApiError(400, "Provide a context and its configuration and lifecycle revisions.");
    if (!active) throw new ApiError(409, "Tournament is not active.");
    return lifecycle(tx, id, room, host.userId, cmd.data.contextId, "close", cmd.data);
  });
}

export function ownerReopening(db: Db, id: string, room: string, session: Session | null, input: unknown, read = false) {
  return withRoomOwner(db, id, session, async tx => {
    const [source] = await tx.select({ engine: tournaments.scoringEngineVersion }).from(tournaments).where(eq(tournaments.id, id));
    if (source.engine !== "room_v1") throw new ApiError(409, "Room scoring is disabled.");
    if (read) return lifecycle(tx, id, room, session!.userId, readContext(input), "read");
    const cmd = reopen.safeParse(input);
    if (!cmd.success) throw new ApiError(400, "Provide the context, current revisions and a reopening reason.");
    const [t] = await tx.select({ status: tournaments.status }).from(tournaments).where(eq(tournaments.id, id));
    if (t.status !== "active") throw new ApiError(409, "Tournament is not active.");
    return lifecycle(tx, id, room, session!.userId, cmd.data.contextId, "reopen", cmd.data);
  });
}
