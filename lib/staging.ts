import "server-only";
import {readPins, pilotUrl} from "./db/pilot-target";
import {approvedStagingFixtures,stagingApproval} from "./db/staging-approval";

export function stagingEnabled(settings = process.env) {
  return settings.QUIZOTAB_STAGE !== undefined || settings.VERCEL_TARGET_ENV === "staging" || settings.STAGING_VERCEL_PROJECT_ID !== undefined;
}

// Provision these independently from the deployment credential store.
export function stagingConfig(settings = process.env, trusted=approvedStagingFixtures) {
  const refuse = () => { throw new Error("Unsafe staging configuration."); };
  if (settings.QUIZOTAB_STAGE !== "staging" || settings.NODE_ENV !== "production" ||
      settings.VERCEL!=="1" || settings.VERCEL_TARGET_ENV!=="staging") refuse();
  if (!settings.STAGING_VERCEL_PROJECT_ID?.startsWith("prj_") || settings.VERCEL_PROJECT_ID!==settings.STAGING_VERCEL_PROJECT_ID) refuse();
  let origin:URL;
  try {origin=new URL(settings.APP_URL ?? "");} catch {throw new Error("Invalid staging origin.");}
  if (origin.protocol !== "https:" || origin.origin !== settings.APP_URL) refuse();
  let pins:ReturnType<typeof readPins>;
  try {pins=readPins(JSON.parse(settings.QUIZOTAB_PILOT_PINS ?? "{}"));} catch {throw new Error("Invalid staging pins.");}
  stagingApproval({purpose:"synthetic-staging-acceptance",pins,origin:origin.origin,project:settings.VERCEL_PROJECT_ID,
    tournament:settings.STAGING_TOURNAMENT_ID,spectators:Number(settings.STAGING_SPECTATORS)},trusted);
  if (pins.projectId === "noisy-violet-99522280" || pins.branchId === "br-restless-king-bdli89ow" ||
      pins.endpointId === "ep-long-fog-bdc5rxjn" || pins.runtimeRole !== "quizotab_pilot_app" || pins.setupRole !== "quizotab_pilot_setup") refuse();
  pilotUrl(settings.DATABASE_URL ?? "",pins);
  const secrets=[settings.SESSION_SECRET,settings.HMAC_SECRET,settings.STAGING_OBSERVER_SECRET];
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(settings.STAGING_TOURNAMENT_ID ?? "") ||
      !Number.isSafeInteger(Number(settings.STAGING_MEMORY_LIMIT_MIB)) || Number(settings.STAGING_MEMORY_LIMIT_MIB)<1) refuse();
  if (secrets.some(s=>!s || s.length<32) || new Set(secrets).size!==3) refuse();
  const excluded=/^(?:DATABASE_|DIRECT_URL|DB_|PRISMA_DATABASE_URL|POSTGRES|PG(?:HOST|PORT|DATABASE|USER|PASSWORD|SERVICE|SSL|OPTIONS)|DEV_NEON_|NEON_API_KEY|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|SUPABASE_SERVICE_ROLE_KEY|SNIPPE_|SMTP_|QUIZOTAB_PILOT_)/i;
  if (Object.keys(settings).some(key=>excluded.test(key) && !["DATABASE_URL","QUIZOTAB_PILOT_PINS"].includes(key))) refuse();
  if (Object.entries(settings).some(([key,value])=>key.startsWith("NEXT_PUBLIC_") &&
    (/SECRET|PASSWORD|DATABASE|SMTP|PRIVATE_KEY|ACCESS_TOKEN/i.test(key) ||
     secrets.some(secret=>value?.includes(secret!)) || value?.includes(settings.DATABASE_URL!)))) refuse();
  return {origin:origin.origin,pins};
}
