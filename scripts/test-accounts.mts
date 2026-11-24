// Checks the account rules (register, confirm, log in, reset) against a throwaway Postgres that runs
// inside this script, with the real migrations applied. Run with: npm test
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mock } from "node:test";
import {readFileSync} from "node:fs";
import {NextRequest} from "next/server";
import {proxy} from "../proxy";
import {stagingConfig} from "../lib/staging";
import {describeStagingFixture} from "../lib/db/staging-approval";
import { createSession, getSession, destroySession, listDevices, revokeDevice } from "@/lib/auth/session";
import {scoreSubmissionHandler} from "@/lib/tournament/room-handlers";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { checkLogin, confirmEmail, createAuthToken, findTokenUser, newResetToken, newVerificationToken, registerUser, resetPassword } from "@/lib/auth/accounts";
import * as schema from "@/lib/db/schema";
import { pointsFor, cleanQuestions, scaleToRound } from "@/lib/quiz/rules";
import { recordAttempt, tooManyAttempts, visitorIp } from "@/lib/rate-limit";

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

await check("rate limiting trusts only the managed ingress client address",async()=>{
  const original=process.env.VERCEL;
  const incoming=new Headers({"x-forwarded-for":"192.0.2.1","x-vercel-forwarded-for":"192.0.2.2"});
  const stub=mock.method(createRequire(import.meta.url)("next/headers"),"headers",async()=>incoming);
  try {
    delete process.env.VERCEL;
    assert.equal(await visitorIp(),"unknown");
    process.env.VERCEL="1";
    assert.equal(await visitorIp(),"192.0.2.2");
    incoming.delete("x-vercel-forwarded-for");
    assert.equal(await visitorIp(),"unknown");
  } finally {stub.mock.restore();if(original===undefined) delete process.env.VERCEL;else process.env.VERCEL=original;}
});

await check("staging session revocation, expiration, rotation and canonical ingress",async()=>{
  await assert.rejects(db.execute(sql`select 'session'::token_purpose`));
  await db.execute(sql.raw(readFileSync("staging-upgrades/0001_session_tokens.sql","utf8")));
  const [user]=await db.select().from(schema.users).limit(1);
  const actor={userId:user.id,name:user.name,role:user.role};
  const headers=createRequire(import.meta.url)("next/headers");
  const original={...process.env};
  let value:string|undefined;
  const jar=mock.method(headers,"cookies",async()=>({
    set(name:string,token:string,flags:Record<string,unknown>){
      assert.equal(name,"__Host-qt_stage_session");
      assert.deepEqual(flags,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:token?28800:0});
      value=token || undefined;
    },get:()=>value?{value}:undefined,delete:()=>{value=undefined;},
  }));
  try {
    const origin="https://staging.example.test";
    const pins={projectId:"synthetic-staging",branchId:"br-staging",endpointId:"ep-staging",directHost:"ep-staging.test.neon.tech",
      database:"quizotab_pilot",runtimeRole:"quizotab_pilot_app",setupRole:"quizotab_pilot_setup"};
    const settings={...process.env,NODE_ENV:"production" as const,APP_URL:origin,QUIZOTAB_STAGE:"staging",STAGING_VERCEL_PROJECT_ID:"prj_test",VERCEL_PROJECT_ID:"prj_test",
      QUIZOTAB_PILOT_PINS:JSON.stringify(pins),STAGING_TOURNAMENT_ID:crypto.randomUUID(),STAGING_MEMORY_LIMIT_MIB:"1024",
      DATABASE_URL:"postgres://quizotab_pilot_app:"+randomBytes(16).toString("hex")+"@ep-staging-pooler.test.neon.tech/quizotab_pilot?sslmode=require",
      SESSION_SECRET:randomBytes(32).toString("hex"),HMAC_SECRET:randomBytes(32).toString("hex"),STAGING_OBSERVER_SECRET:randomBytes(32).toString("hex")};
    const trusted=[describeStagingFixture({purpose:"synthetic-staging-acceptance",pins,origin,project:settings.VERCEL_PROJECT_ID,
      tournament:settings.STAGING_TOURNAMENT_ID,spectators:30}).digest];
    Object.assign(settings,{STAGING_SPECTATORS:"30",VERCEL:"1",VERCEL_TARGET_ENV:"staging"});
    assert.throws(()=>stagingConfig(settings));
    assert.equal(stagingConfig(settings,trusted).origin,origin);
    for(const extra of [{APP_URL:"http://example.test"},{DATABASE_URL_UNPOOLED:"forbidden"},{QUIZOTAB_PILOT_PINS:""},
      {NEXT_PUBLIC_EXAMPLE:settings.STAGING_OBSERVER_SECRET},{NEXT_PUBLIC_DATABASE_URL:"forbidden"},{SMTP_HOST:"example.invalid"},{SNIPPE_API_KEY:"forbidden"},
      {QUIZOTAB_PILOT_PINS:JSON.stringify({...pins,projectId:"noisy-violet-99522280"})}]) assert.throws(()=>stagingConfig({...settings,...extra},trusted));
    Object.assign(process.env,{QUIZOTAB_STAGE:"staging",APP_URL:origin,SESSION_SECRET:settings.SESSION_SECRET});
    const publicSignup=await registerUser(db,{email:"staff@stage.invalid",name:"External",password:"unused"},anyEmail);
    assert.ok(!publicSignup.ok && publicSignup.error.includes("rehearsal operator"));
    const post=(h:Record<string,string>)=>proxy(new NextRequest(origin+"/login",{method:"POST",headers:{host:"staging.example.test",origin,...h}}));
    assert.equal(post({}).status,200);
    for(const h of [{origin:"null"},{host:"other.test"},{"x-forwarded-host":"other.test"}] as Record<string,string>[]) assert.equal(post(h).status,403);
    await createSession(actor,db);const first=value;
    await createSession(actor,db);const second=value;
    assert.deepEqual(await getSession(db),actor);
    await destroySession(db);
    value=second;
    assert.equal(await getSession(db),null);
    const protectedRoute=scoreSubmissionHandler(()=>db,()=>getSession(db));
    const refused=await protectedRoute(new NextRequest(origin+"/api/test",{method:"POST",headers:{origin,host:"staging.example.test"}}),
      {params:Promise.resolve({id:crypto.randomUUID(),roomId:"hall"})});
    assert.equal(refused.status,401);
    value=first;
    assert.deepEqual(await getSession(db),actor);
    const [device]=await listDevices(db,actor);
    assert.ok(device.current);
    assert.equal(await revokeDevice(db,{...actor,userId:actor.userId+1},device.id),false);
    assert.ok(await revokeDevice(db,actor,device.id));
    assert.equal(await getSession(db),null);
    await createSession(actor,db);
    process.env.SESSION_SECRET=randomBytes(32).toString("hex");
    assert.equal(await getSession(db),null);
    process.env.SESSION_SECRET=settings.SESSION_SECRET;
    await db.update(schema.authTokens).set({expiresAt:sql`now() - interval '1 second'`}).where(eq(schema.authTokens.purpose,"session"));
    assert.equal(await getSession(db),null);
    await createSession(actor,db);
    const reset=await createAuthToken(db,user.id,"reset");
    const changed=randomBytes(32).toString("hex");
    assert.ok((await db.transaction(tx=>resetPassword(tx,reset,changed,changed))).ok);
    assert.equal(await getSession(db),null);
    assert.equal((await checkLogin(db,user.email,changed)).status,"ok");
    delete process.env.QUIZOTAB_STAGE;
    jar.mock.restore();
    let ordinary:string|undefined;
    const legacyJar=mock.method(headers,"cookies",async()=>({
      set(name:string,token:string){assert.equal(name,"qt_session");ordinary=token;},
      get:()=>ordinary?{value:ordinary}:undefined,
      delete(name:string){assert.equal(name,"qt_session");ordinary=undefined;},
    }));
    try {
      await createSession(actor,db);
      assert.deepEqual(await getSession(db),actor);
      await destroySession(db);
      assert.equal(await getSession(db),null);
    } finally {legacyJar.mock.restore();}
  } finally {
    jar.mock.restore();
    for(const k of ["APP_URL","SESSION_SECRET","QUIZOTAB_STAGE"]) {
      if(original[k]===undefined) delete process.env[k]; else process.env[k]=original[k];
    }
  }
});
console.log(`\n${passed} checks passed`);
