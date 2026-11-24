export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && (process.env.QUIZOTAB_STAGE !== undefined || process.env.VERCEL_TARGET_ENV === "staging" || process.env.STAGING_VERCEL_PROJECT_ID !== undefined)) {
    const {stagingConfig} = await import("./lib/staging");
    stagingConfig();
    const {verifyRuntimePilot,db} = await import("./lib/db");
    await verifyRuntimePilot();
    const {sql} = await import("drizzle-orm");
    await db().execute(sql`select 'session'::public.token_purpose from public.auth_tokens limit 0`);
    return;
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.QUIZOTAB_PILOT_PINS !== undefined) {
    const { verifyRuntimePilot } = await import("./lib/db");
    await verifyRuntimePilot();
  }
}
