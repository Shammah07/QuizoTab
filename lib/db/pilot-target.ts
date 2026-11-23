import { createHash } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { Db } from "./index";
import { pinnedNeonUrl } from "./target";

const roleName = z.string().min(1).max(63).regex(/^[A-Za-z0-9_-]+$/);
const manifest = z.strictObject({
  projectId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  branchId: z.string().regex(/^br-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  endpointId: z.string().max(63).regex(/^ep-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  directHost: z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}neon\.tech$/),
  database: z.literal("quizotab_pilot"),
  runtimeRole: roleName,
  setupRole: roleName,
});
export type PilotPins = z.infer<typeof manifest>;

export function readPins(raw: unknown): PilotPins {
  const result = manifest.safeParse(raw);
  if (result.success) {
    const pins = result.data;
    if (pins.directHost.split(".")[0] === pins.endpointId && !pins.endpointId.endsWith("-pooler") &&
        pins.setupRole !== pins.runtimeRole && pins.runtimeRole !== "quizotab_pilot_owner" &&
        pins.setupRole !== "quizotab_pilot_owner") return pins;
  }
  throw new Error("Invalid independent pilot target pins.");
}

export function requireApprovedPins(p: PilotPins) {
  const fields = [p.projectId, p.branchId, p.endpointId, p.directHost, p.database, p.runtimeRole, p.setupRole];
  const digest = createHash("sha256").update(JSON.stringify(fields)).digest("hex");
  if (digest !== "6197f894dfeb1acc69e95ac39779ea692c85460ed5eeff05fe5487268ee70ddf")
    throw new Error("Manifest differs from the independently verified pilot.");
}

export async function requirePilotSession(db: Pick<Db, "execute">, pins: PilotPins, role: string) {
  requireApprovedPins(pins);
  const id = await probeIdentity(db);
  if (id?.project_id !== pins.projectId || id.branch_id !== pins.branchId || id.endpoint_id !== pins.endpointId ||
      id.database !== pins.database || id.login_role !== role || id.effective_role !== role)
    throw new Error("Pilot session identity mismatch.");
}

export function rejectInherited(env:Record<string,string|undefined>) {
  if(Object.keys(env).some(k=>/^(?:DATABASE_|DIRECT_URL|DB_|PRISMA_DATABASE_URL|POSTGRES|PG|NEON_|DEV_NEON_|QUIZOTAB_PILOT|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS)/i.test(k)))
    throw new Error("Remove inherited database, pilot or TLS settings before launching.");
}

export function pilotUrl(value: string, pins: PilotPins, direct = false) {
  return pinnedNeonUrl(value, pins.directHost, pins.database, !direct,
    direct ? "Direct setup URL" : "Runtime URL", direct ? pins.setupRole : pins.runtimeRole);
}

export async function probeIdentity(client: Pick<Db, "execute">) {
  const result = await client.execute(sql`
    select current_setting('neon.project_id', true) as project_id,
           current_setting('neon.branch_id', true) as branch_id,
           current_setting('neon.endpoint_id', true) as endpoint_id,
           current_database() as database, session_user as login_role, current_user as effective_role
  `);
  return result.rows[0];
}

type Probe = () => Promise<Record<string, unknown> | undefined>;

export async function verifyPilot(pins: PilotPins, http: Probe, transaction: Probe, setup?: Probe) {
  const checks: [Probe, string][] = [[http, pins.runtimeRole], [transaction, pins.runtimeRole]];
  if (setup) checks.push([setup, pins.setupRole]);
  for (const [probe, role] of checks) {
    try {
      const row = await probe();
      if (row?.project_id === pins.projectId && row.branch_id === pins.branchId &&
          row.endpoint_id === pins.endpointId && row.database === pins.database &&
          row.login_role === role && row.effective_role === role) continue;
    } catch { /* Driver errors can include credentials. */ }
    throw new Error("Pilot database identity verification failed. Startup refused.");
  }
}
