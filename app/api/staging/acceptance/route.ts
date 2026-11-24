import {randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {ApiError,route} from "@/lib/api";
import {safeEqual} from "@/lib/auth/tokens";
import {poolSample,transactionDb} from "@/lib/db";
import {probeIdentity} from "@/lib/db/pilot-target";
import {stagingConfig,stagingEnabled} from "@/lib/staging";

const instance = randomUUID();
export const GET = route(async request=>{
  if(!stagingEnabled()) throw new ApiError(404,"Unavailable.");
  const {pins,origin}=stagingConfig();
  if(!safeEqual(request.headers.get("authorization")??"", "Bearer "+process.env.STAGING_OBSERVER_SECRET)) throw new ApiError(404,"Unavailable.");
  const id=process.env.STAGING_TOURNAMENT_ID!;
  return transactionDb().transaction(async tx=>{
    const identity=await probeIdentity(tx);
    if(identity?.project_id!==pins.projectId || identity.branch_id!==pins.branchId || identity.endpoint_id!==pins.endpointId ||
      identity.database!==pins.database || identity.login_role!==pins.runtimeRole || identity.effective_role!==pins.runtimeRole) throw new ApiError(503,"Target check failed.");
    const [tournament]=(await tx.execute(sql`select owner_id,status,scoring_engine_version from tournaments where id=${id}`)).rows;
    if(tournament?.status!=="active" || tournament.scoring_engine_version!=="room_v1") throw new ApiError(409,"Fixture unavailable.");
    const [lock]=(await tx.execute(sql`select count(*)::int as waiters,coalesce(max(extract(epoch from clock_timestamp()-query_start)),0)::float as seconds
      from pg_stat_activity where datname=current_database() and usename=current_user and wait_event_type='Lock'`)).rows;
    const ledger=request.nextUrl.searchParams.get("ledger")==="1" ? (await tx.execute(sql`select s.id,s.client_request_id,s.room_id,s.context_id,s.round_id,s.team_id,s.question_key,s.points,s.status,
      s.judge_user_id,s.reviewer_user_id,(select json_agg(json_build_array(e.event_type,e.actor_user_id) order by e.created_at,e.id)
      from tournament_score_events e where e.score_entry_id=s.id) as events from tournament_score_entries s where s.tournament_id=${id} order by s.id`)).rows : undefined;
    return {identity,origin,id,owner:tournament.owner_id,project:process.env.VERCEL_PROJECT_ID,commit:process.env.VERCEL_GIT_COMMIT_SHA,
      instance,pool:poolSample(),lock,rss:process.memoryUsage.rss(),
      cpu:process.cpuUsage(),memoryLimitMiB:Number(process.env.STAGING_MEMORY_LIMIT_MIB),ledger};
  },{accessMode:"read only",isolationLevel:"repeatable read"});
});
