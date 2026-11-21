import { defineConfig } from "drizzle-kit";
import { readDevDatabase } from "./scripts/dev-database";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // SQL generation is offline. Every command that needs a connection uses the guard.
  ...(process.argv[2] === "generate" ? {} : { dbCredentials: { url: readDevDatabase().direct } }),
});
