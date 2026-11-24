import "server-only";
import { resolve4, resolveMx } from "node:dns/promises";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { authTokens, users } from "@/lib/db/schema";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "./password";
import { hashToken, newToken } from "./tokens";
import { stagingEnabled } from "@/lib/staging";

// Accounts: register, log in, confirm email, reset password.
// Moved over from auth_process.php, account.php, verify.php, forgot.php and reset.php.
// New accounts count as confirmed from the start, so nobody has to open an email before logging in.
// The confirm and resend code below is kept for accounts made earlier that were never confirmed.
// Nothing here sends email or sets cookies: each function returns what happened and the
// server actions in app/(auth)/actions.ts act on it.

export const VERIFY_HOURS = 24;
export const RESET_MINUTES = 60;
const TOKENS_PER_HOUR = 3;

export type TokenPurpose = "verify" | "reset";
export type AccountUser = { id: number; name: string; email: string; role: "host" | "judge" };

const account = { id: users.id, name: users.name, email: users.email, role: users.role };

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function wellFormed(email: string) {
  return email.length <= 255 && z.email().safeParse(email).success;
}

// DNS answers that mean "this domain doesn't exist or has no such records"
const NO_RECORDS = new Set(["ENOTFOUND", "ENODATA", "ENONAME", "EBADNAME"]);

// A well-formed address on a domain that can receive mail.
// If the lookup itself breaks (timeout, DNS server down) the address is accepted:
// a network hiccup shouldn't stop people registering, and the confirmation email is the real test.
export async function emailLooksReal(email: string) {
  if (!wellFormed(email)) return false;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const missing = (error: unknown) => NO_RECORDS.has((error as NodeJS.ErrnoException)?.code ?? "");
  try {
    if ((await resolveMx(domain)).length > 0) return true;
  } catch (error) {
    if (!missing(error)) return true;
    // No mail records: some domains still accept mail on their plain address
  }
  try {
    return (await resolve4(domain)).length > 0;
  } catch (error) {
    return !missing(error);
  }
}

// ---------- Tokens for emailed links ----------

// Only a hash is stored, so a leaked database can't be used to confirm or reset accounts
export async function createAuthToken(db: Db, userId: number, purpose: TokenPurpose) {
  const { token, hash } = newToken(32);
  const minutes = purpose === "verify" ? VERIFY_HOURS * 60 : RESET_MINUTES;
  await db.insert(authTokens).values({
    userId,
    purpose,
    tokenHash: hash,
    expiresAt: sql`now() + make_interval(mins => ${minutes}::int)`,
  });
  return token;
}

// The user behind an unused, unexpired token, or null
export async function findTokenUser(db: Db, token: unknown, purpose: TokenPurpose): Promise<AccountUser | null> {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return null;
  const [row] = await db
    .select(account)
    .from(authTokens)
    .innerJoin(users, eq(users.id, authTokens.userId))
    .where(and(eq(authTokens.tokenHash, hashToken(token)), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt), gt(authTokens.expiresAt, sql`now()`)));
  return row ?? null;
}

// Marks every open token of this kind as used, so older emailed links stop working too
async function retireTokens(db: Db, userId: number, purpose: TokenPurpose | "session") {
  await db
    .update(authTokens)
    .set({ usedAt: sql`now()` })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));
}

async function tooManyTokens(db: Db, userId: number, purpose: TokenPurpose) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(authTokens)
    .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), gt(authTokens.createdAt, sql`now() - interval '1 hour'`)));
  return (row?.count ?? 0) >= TOKENS_PER_HOUR;
}

// ---------- Register ----------

export type RegisterResult = { ok: true; user: AccountUser } | { ok: false; field: "name" | "email" | "password"; error: string };

export async function registerUser(
  db: Db,
  input: { name: string; email: string; password: string },
  // Tests switch the DNS lookup off
  checkEmail: (email: string) => Promise<boolean> = emailLooksReal,
): Promise<RegisterResult> {
  if (stagingEnabled()) return {ok:false,field:"email",error:"Staging accounts are provisioned by the rehearsal operator."};
  const name = input.name.trim();
  const email = normalizeEmail(input.email);

  if (name === "" || [...name].length > 100) return { ok: false, field: "name", error: "Enter your name (up to 100 characters)." };
  if (!(await checkEmail(email))) return { ok: false, field: "email", error: "That email address can't receive mail. Check it for typos." };
  if (input.password.length < MIN_PASSWORD_LENGTH) return { ok: false, field: "password", error: "Use a password with at least 8 characters." };

  // The unique rule on users.email decides, so two sign-ups at the same moment can't both get the address
  const [user] = await db
    .insert(users)
    .values({ name, email, password: await hashPassword(input.password), emailVerifiedAt: sql`now()` })
    .onConflictDoNothing({ target: users.email })
    .returning(account);
  if (!user) return { ok: false, field: "email", error: "Email is already registered!" };

  return { ok: true, user };
}

// ---------- Log in ----------

export type LoginResult = { status: "ok"; user: AccountUser } | { status: "unverified"; email: string } | { status: "invalid" };

export async function checkLogin(db: Db, emailInput: string, password: string): Promise<LoginResult> {
  const email = normalizeEmail(emailInput);
  const [user] = await db
    .select({ ...account, password: users.password, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.email, email));

  if (!user || !(await verifyPassword(password, user.password))) return { status: "invalid" };
  // Right password but unconfirmed email: the page offers to resend the link instead of logging in
  if (user.emailVerifiedAt === null) return { status: "unverified", email: user.email };
  return { status: "ok", user: { id: user.id, name: user.name, email: user.email, role: user.role } };
}

// ---------- Confirm email ----------

// A fresh confirmation link for an account that still needs one.
// "none" covers both "no such account" and "already confirmed", so the page can answer the same for both.
export async function newVerificationToken(db: Db, emailInput: string): Promise<{ status: "sent"; user: AccountUser; token: string } | { status: "too_many"; email: string } | { status: "none" }> {
  const [user] = await db
    .select(account)
    .from(users)
    .where(and(eq(users.email, normalizeEmail(emailInput)), isNull(users.emailVerifiedAt)));
  if (!user) return { status: "none" };
  if (await tooManyTokens(db, user.id, "verify")) return { status: "too_many", email: user.email };
  return { status: "sent", user, token: await createAuthToken(db, user.id, "verify") };
}

// Opened from the "Confirm email" button. True when the link was good.
export async function confirmEmail(db: Db, token: unknown) {
  const user = await findTokenUser(db, token, "verify");
  if (!user) return false;
  await db.update(users).set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` }).where(eq(users.id, user.id));
  await retireTokens(db, user.id, "verify");
  return true;
}

// ---------- Reset password ----------

// A reset link for this email, or null when there is no such account or too many were sent this hour.
// The page says the same thing either way, so it can't be used to find out who has an account.
export async function newResetToken(db: Db, emailInput: string): Promise<{ user: AccountUser; token: string } | null> {
  const email = normalizeEmail(emailInput);
  if (!wellFormed(email)) return null;
  const [user] = await db.select(account).from(users).where(eq(users.email, email));
  if (!user || (await tooManyTokens(db, user.id, "reset"))) return null;
  return { user, token: await createAuthToken(db, user.id, "reset") };
}

export type ResetResult = { ok: true } | { ok: false; reason: "expired" } | { ok: false; reason: "invalid"; field: "password" | "confirm"; error: string };

export async function resetPassword(db: Db, token: unknown, password: string, confirm: string): Promise<ResetResult> {
  const user = await findTokenUser(db, token, "reset");
  if (!user) return { ok: false, reason: "expired" };
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: "invalid", field: "password", error: "Use a password with at least 8 characters." };
  if (password !== confirm) return { ok: false, reason: "invalid", field: "confirm", error: "The two passwords don't match." };

  // Opening the emailed link proves the address is theirs, so it also counts as confirming it
  await db
    .update(users)
    .set({ password: await hashPassword(password), emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
    .where(eq(users.id, user.id));
  await retireTokens(db, user.id, "reset");
  await retireTokens(db, user.id, "verify");
  if (stagingEnabled()) await retireTokens(db,user.id,"session");
  return { ok: true };
}
