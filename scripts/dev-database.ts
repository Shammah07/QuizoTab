import { pinnedNeonUrl } from "../lib/db/target";
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
  return {
    direct:pinnedNeonUrl(required("DATABASE_URL_UNPOOLED"),host,database,false,"DATABASE_URL_UNPOOLED",undefined,"DEV_NEON_DIRECT_HOST"),
    pooled:pinnedNeonUrl(required("DATABASE_URL"),host,database,true,"DATABASE_URL"),
  };
}
