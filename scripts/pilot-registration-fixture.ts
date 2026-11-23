import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { registerUser } from "../lib/auth/accounts";
import type { Db } from "../lib/db";
import { requireApprovedPins, requirePilotSession, type PilotPins } from "../lib/db/pilot-target";
import { recordAttempt, tooManyAttempts } from "../lib/rate-limit";

export const fixtureEmail = "room-host-d5b@pilot.invalid";
const loopback = "127.0.0.1";

function isLocalFixtureRequest(req: IncomingMessage) {
  return req.socket.localAddress === loopback && req.socket.remoteAddress === loopback;
}

export function requireFixtureConfiguration(configuredEmail: string) {
  if (process.env.NODE_ENV==="production" || process.env.VERCEL || process.env.VERCEL_ENV)
    throw new Error("Fixture registration is unavailable in deployed environments.");
  if (configuredEmail !== fixtureEmail) throw new Error("Invalid fixture email configuration.");
}

// Invoked only by the operator CLI. The web application has no import or route here.
export async function startRegistrationFixture(db: Db, pins: PilotPins, configuredEmail: string) {
  requireApprovedPins(pins);
  requireFixtureConfiguration(configuredEmail);
  await db.transaction(tx=>requirePilotSession(tx,pins,pins.runtimeRole), {accessMode:"read only"});

  const path = "/" + randomBytes(32).toString("hex");
  let claimed = false;
  let registered = false;
  const server = createServer({requestTimeout:15000, headersTimeout:10000}, (req,res)=>{
    void handle(req,res).catch(()=>{
      if (claimed) server.close();
      // Never log request bodies, connection details, or database errors.
      res.writeHead(500).end("Registration could not be confirmed. Check the account before retrying.");
    });
  });
  await new Promise<void>((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,loopback,resolve);
  });
  const address = server.address();
  if (!address || typeof address==="string") throw new Error("Missing fixture listener.");
  const host = loopback + ":" + address.port;
  const origin = "http://" + host;
  const done = once(server,"close").then(()=>registered);
  const timer = setTimeout(()=>{
    server.close();
    if (!claimed) server.closeAllConnections();
  }, 5 * 60_000);
  server.once("close",()=>clearTimeout(timer));

  async function handle(req: IncomingMessage,res: ServerResponse) {
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Referrer-Policy","no-referrer");
    res.setHeader("Content-Security-Policy","default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (!isLocalFixtureRequest(req) || req.url !== path || req.headers.host !== host) {
      res.writeHead(403).end(); return;
    }
    if (req.method === "GET") {
      res.setHeader("Content-Type","text/html; charset=utf-8");
      res.end('<!doctype html><title>Pilot host registration</title><h1>Register '+fixtureEmail+
        '</h1><form method="post"><label>New pilot-only password <input type="password" name="password" autocomplete="new-password" required></label> <button>Register host</button></form>');
      return;
    }
    if (req.method!=="POST" || req.headers.origin!==origin || req.headers["content-type"]!=="application/x-www-form-urlencoded") {
      res.writeHead(403).end(); return;
    }
    const chunks:Buffer[]=[];
    let length=0;
    for await (const chunk of req) {
      const bytes=Buffer.from(chunk);
      length+=bytes.length;
      if (length>8192) { res.writeHead(413).end(); return; }
      chunks.push(bytes);
    }
    const form=new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    if ([...form.keys()].join(",")!=="password") { res.writeHead(400).end(); return; }
    if (claimed) { res.writeHead(409).end(); return; }
    claimed=true;
    // Only the request that claimed this listener may enter the transaction.
    res.setHeader("Connection","close");
    const result=await db.transaction(async tx=>{
      await requirePilotSession(tx,pins,pins.runtimeRole);
      const key="register:"+loopback;
      if (await tooManyAttempts(tx,key,10,3600)) return {status:429,message:"Registration rate limit reached."};
      const account=await registerUser(tx,{
        name:"QuizoTab Pilot D5B Synthetic Host", email:configuredEmail, password:form.get("password")!,
      }, async email=>email===fixtureEmail && email===configuredEmail);
      if (!account.ok) return {status:400,message:account.error};
      if (account.user.role!=="host" || account.user.email!==fixtureEmail) throw new Error("Unexpected fixture account.");
      await recordAttempt(tx,key);
      return {status:201,message:"Synthetic host registered. Sign in through the ordinary pilot login."};
    });
    server.close();
    registered=result.status===201;
    res.writeHead(result.status,{"Content-Type":"text/plain; charset=utf-8"}).end(result.message);
  }
  return {url:origin+path, done, close:()=>server.close()};
}
