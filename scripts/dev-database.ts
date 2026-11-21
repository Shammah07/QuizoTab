import { readFileSync } from "node:fs";
import { parse } from "dotenv";

// Both CLI entry points run from the package root. Never fill a missing local
// setting from the shell (or from Drizzle Kit's automatic .env loading).
export function readDevDatabase() {
  let local: Record<string, string>;
  try {
    local = parse(readFileSync(".env.local"));
  } catch {
    throw new Error("Cannot read the development worktree's .env.local.");
  }
  return verifyDevDatabase(local, process.env);
}

export function verifyDevDatabase(local: Record<string, string>, inherited: Record<string, string | undefined>) {
  function required(key: string) {
    const value = local[key];
    if (!value) throw new Error(`Set ${key} in the development worktree's .env.local.`);
    if (inherited[key] !== undefined && inherited[key] !== value) {
      throw new Error(`Inherited ${key} conflicts with .env.local.`);
    }
    return value;
  }

  if (inherited.PGOPTIONS || inherited.PGHOSTADDR || inherited.PGSERVICE || inherited.PGSERVICEFILE) {
    throw new Error("Clear inherited PostgreSQL routing or startup options before using development tools.");
  }
  const host = required("DEV_NEON_DIRECT_HOST");
  const database = required("DEV_NEON_DATABASE");
  if (!/^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/.test(host) || host.split(".")[0].endsWith("-pooler")) {
    throw new Error("DEV_NEON_DIRECT_HOST must be the full direct Neon endpoint hostname.");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(database)) throw new Error("Unsupported DEV_NEON_DATABASE name.");

  function connection(key: string, expectedHost: string) {
    const value = required(key);
    // URL parser exceptions may carry the entire input, including its password.
    try {
      const url = new URL(value);
      const tls = url.searchParams.get("sslmode");
      const safeOptions = [...url.searchParams.keys()].every(
        (name) => ["sslmode", "channel_binding"].includes(name) && url.searchParams.getAll(name).length === 1,
      );
      if (
        ["postgres:", "postgresql:"].includes(url.protocol) &&
        decodeURIComponent(url.username) && decodeURIComponent(url.password) &&
        url.hostname === expectedHost && url.pathname === "/" + database &&
        (!url.port || url.port === "5432") && !url.hash && safeOptions &&
        (tls === "require" || tls === "verify-full")
      ) return url.href;
    } catch {
      // Report only the setting name below.
    }
    throw new Error(`${key} must be a TLS PostgreSQL URL for the pinned development host and database.`);
  }
  return {
    direct: connection("DATABASE_URL_UNPOOLED", host),
    pooled: connection("DATABASE_URL", host.replace(".", "-pooler.")),
  };
}
