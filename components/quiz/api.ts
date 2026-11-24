// Shared by the quiz screens in the browser: calling the JSON API, clocks and small helpers.
// (Was quiz/quiz.js on the PHP site.)

export type ApiResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

// Calls one of the routes under /api. Errors come back as { ok: false, error } so screens can show them.
export async function api<T extends object = Record<string, unknown>>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: options.signal,
    });
    const data = await response.json().catch(() => null);
    if (response.ok && (data === null || typeof data !== "object")) {
      return { ok: false, status: 0, error: "QuizoTab returned an unreadable response. Check the current state." };
    }
    if (response.ok) return { ok: true, ...(data as T) };
    return { ok: false, status: response.status, ...data, error: typeof data?.error === "string" ? data.error : "Something went wrong. Try again." };
  } catch {
    return { ok: false, status: 0, error: "Could not reach QuizoTab. Check your connection." };
  }
}

// Counts down from a server-provided number of milliseconds, unaffected by the device's clock being wrong
export function serverClock(ms: number) {
  const start = performance.now();
  return () => Math.max(0, ms - (performance.now() - start));
}

export const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// A player's place in a game, kept on the phone so a reload doesn't lose it
export const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Private mode
    }
  },
};
