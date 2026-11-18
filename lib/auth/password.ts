import "server-only";
import bcrypt from "bcryptjs";

// Passwords are stored as bcrypt hashes, the same kind PHP's password_hash() makes,
// so accounts moved over from the PHP site keep their passwords.

const COST = 12;

export function hashPassword(password: string) {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export const MIN_PASSWORD_LENGTH = 8;
