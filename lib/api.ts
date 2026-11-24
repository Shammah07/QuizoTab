import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getSession, type Session } from "@/lib/auth/session";
import { stagingEnabled } from "@/lib/staging";

// Shared plumbing for the JSON API under app/api: every route answers with JSON, errors look the same
// everywhere ({ error: "..." } with a fitting status), and nothing is cached.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const json = (status: number, data: unknown) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

// A request that changes something must come from QuizoTab's own pages, not from a form on another website
function fromOtherSite(request: NextRequest) {
  if (request.method === "GET" || request.method === "HEAD") return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (stagingEnabled()) return !origin || origin !== process.env.APP_URL || request.headers.get("host") !== new URL(process.env.APP_URL!).host;
  if (!origin) return false;
  try {
    if (process.env.APP_URL) return origin !== new URL(process.env.APP_URL).origin;
    const host = request.headers.get("host");
    return !host || origin !== request.nextUrl.protocol + "//" + host;
  } catch {
    return true;
  }
}

// Wraps a route: return a value to answer 200 with it, or throw ApiError for anything else
export function route<Context>(handler: (request: NextRequest, context: Context) => Promise<unknown>) {
  return async (request: NextRequest, context: Context) => {
    try {
      if (fromOtherSite(request)) throw new ApiError(403, "This request didn't come from QuizoTab.");
      const result = await handler(request, context);
      return result instanceof Response ? result : json(200, result);
    } catch (error) {
      if (error instanceof ApiError) return json(error.status, { error: error.message, ...error.extra });
      const reference = crypto.randomUUID();
      console.error("Unexpected QuizoTab API failure", { reference, method: request.method });
      return json(500, { error: "QuizoTab could not confirm the result. Check the current state.", reference });
    }
  };
}

// The JSON a request carries, or {} when it has none or it can't be read
export async function body(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const data = await request.json();
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export async function requireUser(message = "Log in to QuizoTab to host quizzes."): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ApiError(401, message);
  return session;
}

// A whole number from JSON or the address, or NaN
export const int = (value: unknown) => (typeof value === "number" || (typeof value === "string" && /^-?\d+$/.test(value)) ? Math.trunc(Number(value)) : NaN);

// Unwraps { ok, value | error } results from the lib functions
export function unwrap<R extends { ok: true; value: unknown } | { ok: false; error: string; status?: number }>(result: R, status = 400): Extract<R, { ok: true }>["value"] {
  if (!result.ok) throw new ApiError(result.status ?? status, result.error);
  return result.value;
}
