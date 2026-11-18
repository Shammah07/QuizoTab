import "server-only";
import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
import { env, isProduction } from "@/lib/env";

// The login cookie. It replaces the PHP session: the user's id travels inside an encrypted,
// tamper-proof cookie, so there is no session table to look up.
// Hidden from JavaScript, not sent from other sites, and HTTPS-only on the live site.

const COOKIE = "qt_session";
const LIFETIME_DAYS = 30;

export type Session = { userId: number; name: string; role: "host" | "judge" };

function key() {
  // A256GCM needs exactly 32 bytes; hashing accepts a secret of any length
  return createHash("sha256").update(env("SESSION_SECRET")).digest();
}

export async function createSession(session: Session) {
  const token = await new EncryptJWT({ ...session })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${LIFETIME_DAYS}d`)
    .encrypt(key());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: LIFETIME_DAYS * 24 * 60 * 60,
  });
}

// Who is logged in, or null. A missing, expired or altered cookie all count as logged out.
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, key());
    const { userId, name, role } = payload;
    if (typeof userId !== "number" || typeof name !== "string" || (role !== "host" && role !== "judge")) return null;
    return { userId, name, role };
  } catch {
    return null;
  }
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}
