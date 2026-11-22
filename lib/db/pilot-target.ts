import { z } from "zod";
import { sql } from "drizzle-orm";
import type { Db } from "./index";
import { pinnedNeonUrl } from "./target";

const name=z.string().regex(/^[a-zA-Z0-9_-]+$/);
const manifest=z.strictObject({
  branch:z.literal("quizo-room-pilot-test"), directHost:z.string().min(1), database:name, runtimeRole:name, setupRole:name.optional(),
});
export type PilotPins=z.infer<typeof manifest>;
export function readPins(raw:unknown):PilotPins {
  const result=manifest.safeParse(raw);
  if (!result.success || result.data.setupRole===result.data.runtimeRole) throw new Error("Invalid independent pilot target pins.");
  return result.data;
}
export function rejectInherited(env:Record<string,string|undefined>) {
  if(Object.keys(env).some(k=>/^(?:DATABASE_URL|POSTGRES|PG|NEON_|DEV_NEON_|QUIZOTAB_PILOT|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS)/i.test(k)))
    throw new Error("Remove inherited database, pilot or TLS settings before launching.");
}
export function pilotUrl(value:string,pins:PilotPins,direct=false) {
  const role=direct?pins.setupRole:pins.runtimeRole;
  if(!role) throw new Error("Missing pilot role pin.");
  return pinnedNeonUrl(value,pins.directHost,pins.database,!direct,direct?"Direct setup URL":"Runtime URL",role);
}
export async function probeIdentity(client:Pick<Db,"execute">) {
  const result=await client.execute(sql`select current_database() as database, current_user as role, current_setting('neon.endpoint_id') as endpoint`);
  return result.rows[0];
}
type Probe=()=>Promise<Record<string,unknown>|undefined>;
export async function verifyPilot(pins:PilotPins,http:Probe,transaction:Probe,setup?:Probe) {
  for(const [probe,role] of [[http,pins.runtimeRole],[transaction,pins.runtimeRole],...(setup?[[setup,pins.setupRole] as const]:[])] as const) {
    try {
      const row=await probe();
      if(role && row?.database===pins.database && row.role===role && row.endpoint===pins.directHost.split(".")[0]) continue;
    } catch { /* Driver errors can contain connection details. */ }
    throw new Error("Pilot database identity verification failed. Startup refused.");
  }
}
