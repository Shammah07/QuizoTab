import { sql } from "drizzle-orm";
import { z } from "zod";
import { requirePilotSession, type PilotPins } from "../lib/db/pilot-target";
import { PilotMigrationRefusal } from "./pilot-migration";
import { inspectScoringPermissions, type Database } from "./pilot-upgrade";

const modes = ["host-preflight","host-add","host-open","host-verify","host-close","host-verify-closed"] as const;
type Mode = typeof modes[number];
export const isHostMode = (value: string): value is Mode => modes.some(mode => mode === value);
export const needsHostApproval = (mode: Mode) => ["host-preflight","host-add","host-open"].includes(mode);

const approvalSchema = z.strictObject({
  purpose: z.literal("synthetic-room-admission"),
  hostId: z.number().int().positive().max(2147483647),
  email: z.email().max(255).regex(/@(?:[a-z0-9-]+\.)+invalid$/),
  createdAtUtc: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/),
});
type Approval = z.infer<typeof approvalSchema>;
function requireState(condition: unknown, message: string): asserts condition {
  if (!condition) throw new PilotMigrationRefusal("Pilot host admission refused. " + message);
}

export function readHostApproval(id: string, record: unknown): Approval {
  const parsed = approvalSchema.safeParse(record);
  requireState(parsed.success && String(parsed.data.hostId)===id, "Check the explicit ID and operator fixture record.");
  return parsed.data;
}

async function state(db: Database) {
  const result = await db.execute(sql`select enabled,
    (select count(*)::integer from pilot_admission.hosts) as count,
    (select min(user_id) from pilot_admission.hosts) as host
    from pilot_admission.policy where singleton`);
  const row = result.rows[0];
  requireState(result.rows.length===1 && typeof row.enabled==="boolean" &&
    (row.count===0 && row.host===null || row.count===1 && typeof row.host==="number"), "Unexpected policy or allowlist.");
  requireState(!row.enabled || row.count===1, "Open policy has no host.");
  return { open: row.enabled, hostId: row.host as number | null };
}

export async function pilotHostAdmission(db: Database, pins: PilotPins, mode: Mode, approval?: Approval) {
  requireState(isHostMode(mode) && needsHostApproval(mode)===Boolean(approval), "Check operation and fixture approval.");
  const write = mode==="host-add" || mode==="host-open" || mode==="host-close";
  return db.transaction(async tx => {
    await tx.execute(sql`set local search_path=pg_catalog`);
    await requirePilotSession(tx,pins,pins.setupRole);
    if (write) {
      await tx.execute(sql`set local lock_timeout='5s'`);
      const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(62410923001) as acquired`);
      requireState(lock.rows[0]?.acquired===true, "Another pilot procedure is running.");
      // The admission trigger takes row-share table locks for a room insert.
      // EXCLUSIVE waits for admitted creations and serializes subsequent ones.
      await tx.execute(sql`lock table pilot_admission.policy, pilot_admission.hosts in exclusive mode`);
    }
    requireState(await inspectScoringPermissions(tx,"either")==="full", "Complete scoring permissions required.");
    const before = await state(tx);
    if (mode==="host-verify") return before;
    if (mode==="host-verify-closed") {
      requireState(!before.open && before.hostId===null, "Expected closed admission and an empty allowlist.");
      return before;
    }
    if (mode==="host-close") {
      await tx.execute(sql`update pilot_admission.policy set enabled=false where singleton and enabled`);
      if (before.hostId!==null)
        await tx.execute(sql`delete from pilot_admission.hosts where user_id=${before.hostId}`);
    } else {
      requireState(approval && approvalSchema.safeParse(approval).success && !before.open, "Closed policy and fixture approval required.");
      requireState(before.hostId===(mode==="host-open" ? approval.hostId : null), "Unexpected allowlisted host.");
      const account = await tx.execute(sql`select id from public.users where id=${approval.hostId}
        and role='host' and email=${approval.email}
        and to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=${approval.createdAtUtc}
        ${write ? sql`for share` : sql``}`);
      requireState(account.rows.length===1, "Persisted host does not match the approved synthetic fixture.");
      if (mode==="host-preflight") return before;
      if (mode==="host-add") await tx.execute(sql`insert into pilot_admission.hosts(user_id) values (${approval.hostId})`);
      if (mode==="host-open") await tx.execute(sql`update pilot_admission.policy set enabled=true where singleton and not enabled`);
    }
    const after = await state(tx);
    requireState(after.open===(mode==="host-open") && after.hostId===(approval?.hostId ?? null), "Postcondition failed.");
    return after;
  }, { isolationLevel: write ? "read committed" : "repeatable read", accessMode: write ? "read write" : "read only" });
}
