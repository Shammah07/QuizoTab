import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

// Secret tokens (email links, a player's place in a game). The person gets the token;
// the database keeps only its SHA-256, so a leaked database can't be used to log in or play as someone.

export function newToken(bytes = 24) {
  const token = randomBytes(bytes).toString("hex");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Player and solo-run tokens are 48 hex characters
export function looksLikePlayerToken(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-f]{48}$/.test(token);
}

function hmac(text: string) {
  return createHmac("sha256", env("HMAC_SECRET")).update(text).digest("hex");
}

// Guest codes: public pages only ever see this keyed fingerprint, which can't be reversed without the server's secret
export function guestCodeKey(code: string) {
  return hmac("guest:" + code.trim().toUpperCase());
}

// An opaque public handle, so the tournament directory never reveals a tournament's id
export function tournamentHandle(tournamentId: string) {
  return hmac("handle:" + tournamentId).slice(0, 16);
}

// Six letters and numbers, leaving out the look-alikes I, O, 0 and 1
export function makeGuestCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[randomInt(chars.length)];
  return code;
}

// Compares two secrets without revealing, through timing, how much of a guess was right
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
