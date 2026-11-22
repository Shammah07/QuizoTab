export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.QUIZOTAB_PILOT_PINS !== undefined) {
    const { verifyRuntimePilot } = await import("./lib/db");
    await verifyRuntimePilot();
  }
}
