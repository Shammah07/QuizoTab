import "server-only";
import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
import { env, isProduction } from "@/lib/env";
import {and,eq,gt,isNull,sql} from "drizzle-orm";
import {db,type Db} from "@/lib/db";
import {authTokens,users} from "@/lib/db/schema";
import {hashToken,newToken} from "./tokens";
import {stagingEnabled} from "@/lib/staging";

// Ordinary login retains its encrypted cookie contract. Staging additionally
// checks a device-specific, expiring record on every authenticated request.

const cookieName = () => stagingEnabled() ? "__Host-qt_stage_session" : "qt_session";
const LIFETIME_DAYS = 30;

export type Session = { userId: number; name: string; role: "host" | "judge" };

function key() {
  // A256GCM needs exactly 32 bytes; hashing accepts a secret of any length
  return createHash("sha256").update(env("SESSION_SECRET")).digest();
}

export async function createSession(session: Session, database?: Db) {
  const staged = stagingEnabled();
  const seconds = staged ? 8 * 3600 : LIFETIME_DAYS * 86400;
  const claims = new EncryptJWT({ ...session });
  if (staged) {
    const {token,hash} = newToken(32);
    await (database ?? db()).insert(authTokens).values({userId:session.userId,purpose:"session",tokenHash:hash,
      expiresAt:sql`now() + interval '8 hours'`});
    claims.setJti(token).setAudience("quizotab-staging");
  }
  const token = await claims
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now()/1000)+seconds)
    .encrypt(key());

  (await cookies()).set(cookieName(), token, {
    httpOnly: true,
    secure: staged || isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: seconds,
  });
}

// Who is logged in, or null. A missing, expired or altered cookie all count as logged out.
async function claims() {
  const token = (await cookies()).get(cookieName())?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, key(), stagingEnabled() ? {audience:"quizotab-staging"} : {});
    return payload;
  } catch {
    return null;
  }
}

export async function getSession(database?: Db): Promise<Session | null> {
  const payload = await claims();
  if (!payload) return null;
  const { userId,name,role,jti } = payload;
  if(typeof userId!=="number" || typeof name!=="string" || (role!=="host" && role!=="judge")) return null;
  if (!stagingEnabled()) return payload.aud || jti ? null : {userId,name,role};
  if (typeof jti!=="string") return null;
  const [active] = await (database ?? db()).select({userId:users.id,name:users.name,role:users.role}).from(authTokens)
    .innerJoin(users,eq(users.id,authTokens.userId)).where(and(eq(authTokens.tokenHash,hashToken(jti)),
      eq(authTokens.userId,userId),eq(authTokens.purpose,"session"),isNull(authTokens.usedAt),gt(authTokens.expiresAt,sql`now()`)));
  return active?.role===role ? active : null;
}

export async function destroySession(database?: Db) {
  if (stagingEnabled()) {
    const payload = await claims();
    if (typeof payload?.jti==="string" && typeof payload.userId==="number") {
      await (database ?? db()).update(authTokens).set({usedAt:sql`now()`}).where(and(eq(authTokens.purpose,"session"),
        eq(authTokens.userId,payload.userId),eq(authTokens.tokenHash,hashToken(payload.jti)),isNull(authTokens.usedAt)));
    }
  }
  const jar=await cookies();
  if(stagingEnabled()) jar.set(cookieName(),"",{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:0});
  else jar.delete(cookieName());
}

export async function listDevices(database:Db,actor:Session) {
  const current=await claims();
  const digest=typeof current?.jti==="string" ? hashToken(current.jti) : null;
  const devices=await database.select({createdAt:authTokens.createdAt,expiresAt:authTokens.expiresAt,hash:authTokens.tokenHash})
    .from(authTokens).where(and(eq(authTokens.userId,actor.userId),eq(authTokens.purpose,"session"),
      isNull(authTokens.usedAt),gt(authTokens.expiresAt,sql`now()`))).orderBy(authTokens.createdAt);
  return devices.map(({hash,...device})=>({...device,id:hashToken("device:"+hash),current:hash===digest}));
}

export async function revokeDevice(database:Db,actor:Session,id:string) {
  const active=and(eq(authTokens.userId,actor.userId),eq(authTokens.purpose,"session"),
    isNull(authTokens.usedAt),gt(authTokens.expiresAt,sql`now()`));
  const devices=await database.select({hash:authTokens.tokenHash}).from(authTokens).where(active);
  const device=devices.find(row=>hashToken("device:"+row.hash)===id);
  if(!device) return false;
  const rows=await database.update(authTokens).set({usedAt:sql`now()`})
    .where(and(active,eq(authTokens.tokenHash,device.hash))).returning({usedAt:authTokens.usedAt});
  return rows.length===1;
}
