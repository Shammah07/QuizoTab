import "server-only";
import { ApiError, int } from "@/lib/api";
import type { Db } from "@/lib/db";
import { recordAttempt, tooManyAttempts, visitorIp } from "@/lib/rate-limit";
import { gameById, gameByPin, type Game } from "./engine";

// Lookups the quiz API routes share

// The live game behind a PIN. Wrong PINs per visitor are limited (30 every 10 minutes),
// so nobody can walk through every PIN to crash games.
export async function gameForPin(db: Db, pin: unknown): Promise<Game> {
  const key = `pin:${await visitorIp()}`;
  if (await tooManyAttempts(db, key, 30, 600)) throw new ApiError(429, "Too many wrong PINs. Wait a few minutes and try again.");

  const game = typeof pin === "string" && /^\d{6}$/.test(pin) ? await gameByPin(db, pin) : null;
  if (!game || game.status === "finished") {
    await recordAttempt(db, key);
    throw new ApiError(404, "No live game uses that PIN. Check it on the big screen.");
  }
  return game;
}

// A game the logged-in host owns. Someone else's game looks the same as one that doesn't exist.
export async function ownGame(db: Db, id: unknown, ownerId: number): Promise<Game> {
  const gameId = int(id);
  const game = Number.isNaN(gameId) ? null : await gameById(db, gameId);
  if (!game || game.ownerId !== ownerId) throw new ApiError(404, "Game not found.");
  return game;
}
