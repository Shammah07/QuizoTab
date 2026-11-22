import { readFileSync, realpathSync, existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { parse } from "dotenv";
import { neon, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as pooled } from "drizzle-orm/neon-serverless";
import { pilotUrl, probeIdentity, readPins, rejectInherited, verifyPilot } from "../lib/db/pilot-target";

async function main() {
  const [mode, manifest, credentials, ...extra]=process.argv.slice(2);
  if (!["start","verify-setup"].includes(mode) || !manifest || !credentials || extra.length ||
      !isAbsolute(manifest) || !isAbsolute(credentials) || realpathSync(manifest)===realpathSync(credentials))
    throw new Error("Invalid pilot inputs.");
  rejectInherited(process.env);
  // Next automatically reads these files. A pilot checkout must never inherit another deployment's configuration.
  if ([".env",".env.local",".env.production",".env.production.local"].some(p=>existsSync(p))) throw new Error("Conflicting Next environment file.");
  const pins=readPins(JSON.parse(readFileSync(manifest,"utf8")));
  const values=parse(readFileSync(credentials));
  const prepare=mode==="verify-setup";
  const allowed=prepare?["DATABASE_URL","DATABASE_URL_UNPOOLED"]:["DATABASE_URL","SESSION_SECRET","HMAC_SECRET"];
  if(Object.keys(values).some(k=>!allowed.includes(k)) || allowed.some(k=>!values[k])) throw new Error("Invalid credential file.");
  const url=pilotUrl(values.DATABASE_URL,pins);
  const direct=prepare?pilotUrl(values.DATABASE_URL_UNPOOLED,pins,true):null;
  const pool=new Pool({connectionString:url,max:1,connectionTimeoutMillis:10000});
  const setup=direct?new Pool({connectionString:direct,max:1,connectionTimeoutMillis:10000}):null;
  try {
    await verifyPilot(pins,()=>probeIdentity(drizzle(neon(url))),()=>pooled(pool).transaction(tx=>probeIdentity(tx)),
      setup?()=>probeIdentity(pooled(setup)):undefined);
  } finally {await Promise.all([pool.end(),setup?.end()]);}
  if(prepare) {console.log("Pilot HTTP, transaction and direct setup identities verified.");return;}
  const env:NodeJS.ProcessEnv={...values,DATABASE_URL:url,QUIZOTAB_PILOT_PINS:JSON.stringify(pins),NODE_ENV:"production"};
  for(const [k,v] of Object.entries(process.env)) {
    if (/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|TZ)$/i.test(k)) env[k]=v;
  }
  const cli=createRequire(import.meta.url).resolve("next/dist/bin/next");
  const child=spawn(process.execPath,[cli,"start","--hostname","127.0.0.1"],{env,stdio:"inherit",windowsHide:true});
  const stop=()=>child.kill();
  process.once("SIGINT",stop);process.once("SIGTERM",stop);
  const code=await new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});
  process.exitCode=code ?? 1;
}
main().catch(()=>{console.error("Pilot refused. Check the isolated worktree, independent pins, credentials and live database identities.");process.exitCode=1;});
