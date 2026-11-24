// Checks the account rules (register, confirm, log in, reset) against a throwaway Postgres that runs
// inside this script, with the real migrations applied. Run with: npm test
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mock } from "node:test";
import { createSession, getSession, destroySession } from "@/lib/auth/session";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { checkLogin, confirmEmail, createAuthToken, findTokenUser, newResetToken, newVerificationToken, registerUser, resetPassword } from "@/lib/auth/accounts";
import * as schema from "@/lib/db/schema";
import { pointsFor, cleanQuestions, scaleToRound } from "@/lib/quiz/rules";
import { recordAttempt, tooManyAttempts } from "@/lib/rate-limit";

const db = drizzle(new PGlite(), { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
const anyEmail = async () => true;
let passed = 0;
async function check(name: string, run: () => Promise<void> | void) {
  await run();
  passed++;
  console.log("ok  " + name);
}

// An account made before confirmation was dropped: still waiting for its emailed link
async function leaveUnconfirmed(email: string) {
  await db.update(schema.users).set({ emailVerifiedAt: null }).where(eq(schema.users.email, email));
}

await check("staff session round trip, cookie settings and logout", async () => {
  const headers = createRequire(import.meta.url)("next/headers");
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
  let value: string | undefined;
  const jar = mock.method(headers, "cookies", async () => ({
    set(name:string, token:string, flags:Record<string,unknown>) {
      assert.equal(name,"qt_session");
      assert.equal(flags.httpOnly,true);
      assert.equal(flags.sameSite,"lax");
      assert.equal(flags.secure,process.env.NODE_ENV==="production");
      value = token;
    },
    get: () => value ? {value} : undefined,
    delete: () => { value = undefined; },
  }));
  try {
    const actor = {userId:1,name:"Local staff",role:"judge" as const};
    assert.equal(await getSession(),null);
    await createSession(actor);
    assert.deepEqual(await getSession(),actor);
    await destroySession();
    assert.equal(await getSession(),null);
  } finally {
    jar.mock.restore();
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

await check("register validates name, email and password", async () => {
  assert.deepEqual((await registerUser(db, { name: " ", email: "a@b.co", password: "longenough" }, anyEmail)).ok, false);
  const badEmail = await registerUser(db, { name: "Asha", email: "nope", password: "longenough" }, async () => false);
  assert.equal(!badEmail.ok && badEmail.field, "email");
  const short = await registerUser(db, { name: "Asha", email: "a@b.co", password: "short" }, anyEmail);
  assert.equal(!short.ok && short.field, "password");
});

await check("register stores a lower-case email and a hash, never the password, and needs no confirmation", async () => {
  const result = await registerUser(db, { name: " Asha ", email: " Asha@Example.COM ", password: "correct horse" }, anyEmail);
  assert.ok(result.ok);
  const [row] = await db.select().from(schema.users);
  assert.equal(row.email, "asha@example.com");
  assert.equal(row.name, "Asha");
  assert.match(row.password, /^\$2[aby]\$/);
  assert.ok(row.emailVerifiedAt instanceof Date);
  assert.equal(await db.$count(schema.authTokens), 0);
});

await check("the same email can't register twice, whatever the capitals", async () => {
  const again = await registerUser(db, { name: "Other", email: "ASHA@example.com", password: "another pass" }, anyEmail);
  assert.equal(!again.ok && again.error, "Email is already registered!");
});

await check("login: wrong password and unknown email look the same; a new account logs straight in", async () => {
  assert.equal((await checkLogin(db, "asha@example.com", "wrong")).status, "invalid");
  assert.equal((await checkLogin(db, "nobody@example.com", "correct horse")).status, "invalid");
  const login = await checkLogin(db, "Asha@example.com", "correct horse");
  assert.equal(login.status, "ok");
  assert.equal(login.status === "ok" && login.user.role, "host");
});

await check("an old unconfirmed account is held back until its link is opened; the link works once", async () => {
  await leaveUnconfirmed("asha@example.com");
  assert.equal((await checkLogin(db, "asha@example.com", "correct horse")).status, "unverified");
  const [{ id }] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "asha@example.com"));
  const verifyToken = await createAuthToken(db, id, "verify");
  assert.equal(await confirmEmail(db, "zz"), false);
  assert.equal(await confirmEmail(db, "a".repeat(64)), false);
  assert.equal(await confirmEmail(db, verifyToken), true);
  assert.equal(await confirmEmail(db, verifyToken), false);
  assert.equal((await checkLogin(db, "asha@example.com", "correct horse")).status, "ok");
});

await check("resend: nothing for confirmed or unknown accounts; capped at 3 an hour", async () => {
  assert.equal((await newVerificationToken(db, "asha@example.com")).status, "none");
  assert.equal((await newVerificationToken(db, "nobody@example.com")).status, "none");
  const second = await registerUser(db, { name: "Baraka", email: "baraka@example.com", password: "password one" }, anyEmail);
  assert.ok(second.ok);
  await leaveUnconfirmed("baraka@example.com");
  assert.equal((await newVerificationToken(db, "baraka@example.com")).status, "sent"); // 1st
  assert.equal((await newVerificationToken(db, "baraka@example.com")).status, "sent"); // 2nd
  assert.equal((await newVerificationToken(db, "baraka@example.com")).status, "sent"); // 3rd
  assert.equal((await newVerificationToken(db, "baraka@example.com")).status, "too_many");
});

await check("expired links are refused", async () => {
  const reset = await newResetToken(db, "asha@example.com");
  assert.ok(reset);
  await db.update(schema.authTokens).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(schema.authTokens.purpose, "reset"));
  assert.equal(await findTokenUser(db, reset.token, "reset"), null);
  assert.deepEqual(await resetPassword(db, reset.token, "new password 1", "new password 1"), { ok: false, reason: "expired" });
});

await check("reset: checks the passwords, changes it, works once, and confirms the email", async () => {
  assert.equal(await newResetToken(db, "nobody@example.com"), null);
  const reset = await newResetToken(db, "baraka@example.com"); // Baraka never confirmed
  assert.ok(reset);
  const short = await resetPassword(db, reset.token, "short", "short");
  assert.equal(!short.ok && short.reason, "invalid");
  const mismatch = await resetPassword(db, reset.token, "new password 1", "new password 2");
  assert.equal(!mismatch.ok && mismatch.reason === "invalid" && mismatch.field, "confirm");
  assert.deepEqual(await resetPassword(db, reset.token, "new password 1", "new password 1"), { ok: true });
  assert.deepEqual(await resetPassword(db, reset.token, "new password 3", "new password 3"), { ok: false, reason: "expired" });
  assert.equal((await checkLogin(db, "baraka@example.com", "password one")).status, "invalid");
  assert.equal((await checkLogin(db, "baraka@example.com", "new password 1")).status, "ok");
});

await check("a password hash made by PHP's password_hash() still logs in", async () => {
  // password_hash('secret123', PASSWORD_DEFAULT) from PHP
  const phpHash = "$2y$10$060He5KEdeYET1eAw/S8XecFz3V/wx/ikf/mSVTQoL.hacterk2pu";
  await db.insert(schema.users).values({ name: "Old", email: "old@example.com", password: phpHash, emailVerifiedAt: new Date() });
  assert.equal((await checkLogin(db, "old@example.com", "secret123")).status, "ok");
  assert.equal((await checkLogin(db, "old@example.com", "secret124")).status, "invalid");
});

await check("rate limit counts attempts inside the window", async () => {
  for (let i = 0; i < 3; i++) await recordAttempt(db, "login:test");
  assert.equal(await tooManyAttempts(db, "login:test", 3, 600), true);
  assert.equal(await tooManyAttempts(db, "login:test", 4, 600), false);
  assert.equal(await tooManyAttempts(db, "login:other", 1, 600), false);
});

await check("quiz scoring matches the PHP engine", () => {
  const q = { points: 1 as const, time: 20 };
  assert.equal(pointsFor(q, 0), 1000);
  assert.equal(pointsFor(q, 10_000), 750);
  assert.equal(pointsFor(q, 20_000), 500);
  assert.equal(pointsFor(q, 99_000), 500);
  assert.equal(pointsFor({ points: 2, time: 10 }, 5000), 1500);
  assert.equal(pointsFor({ points: 0, time: 10 }, 0), 0);
  assert.equal(scaleToRound(1500, 3000, 0, 100), 50);
  assert.equal(scaleToRound(9999, 3000, 10, 60), 60);
});

await check("quiz question checks", () => {
  assert.equal(cleanQuestions([]).error, "Add at least one question.");
  assert.equal(cleanQuestions([{ text: "Q", answers: ["a"], correct: 0 }]).error, "Question 1 needs 2 to 4 answers.");
  assert.equal(cleanQuestions([{ text: "Q", answers: ["a", "b"], correct: 2 }]).error, "Mark the right answer for question 1.");
  const ok = cleanQuestions([{ text: " Q ", answers: ["a", " b ", ""], correct: 1, time: 7, points: 2 }]);
  assert.deepEqual(ok.questions, [{ text: "Q", answers: ["a", "b"], correct: 1, time: 20, points: 2 }]);
});

console.log(`\n${passed} checks passed`);
