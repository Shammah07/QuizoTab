import "server-only";

// The "doorbell": tells every screen in a game that something changed, so it fetches the new state
// straight away. Nothing about the game travels through here, only the game's version number.
//
// It rings through Supabase Realtime broadcast, as the PHP site did (set SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY). Without those settings nothing is rung and screens rely on
// checking for changes every few seconds, which still works, just a little slower.
export async function ring(pin: string, version: number) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  try {
    // Fire and forget: a slow or failed ring must never hold up or break the game
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ messages: [{ topic: `quiz-${pin}`, event: "changed", payload: { v: version } }] }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Screens also check on their own
  }
}
