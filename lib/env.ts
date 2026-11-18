import "server-only";

// Server settings, read from .env.local on your computer and from Vercel's environment variables when live.
// Was quizotab-private/config.php. More names are added here as each feature is moved over.
type Name = "DATABASE_URL" | "SESSION_SECRET" | "HMAC_SECRET";

// Read when first needed, with a clear message naming the missing setting
export function env(name: Name): string {
  const value = process.env[name];
  if (!value) throw new Error(`QuizoTab is not set up yet: ${name} is missing. Copy .env.example to .env.local and fill it in.`);
  return value;
}

export const isProduction = process.env.NODE_ENV === "production";
