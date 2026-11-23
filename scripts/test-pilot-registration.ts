import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import dns from "node:dns/promises";
import { channel } from "node:diagnostics_channel";
import { mock } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { checkLogin, registerUser } from "../lib/auth/accounts";
import * as schema from "../lib/db/schema";
import type { PilotPins } from "../lib/db/pilot-target";
import { fixtureEmail, startRegistrationFixture } from "./pilot-registration-fixture";
import { pilotHostAdmission, readHostApproval } from "./pilot-host-admission";

export async function testPilotRegistration(local: PGlite,pins: PilotPins) {
  // This test runs inside the admission suite's disposable, fully granted pilot.
  const db=drizzle(local,{schema});
  const start=(email=fixtureEmail)=>startRegistrationFixture(db,pins,email);
  await assert.rejects(start(),/identity mismatch/); // setup role cannot register
  await local.exec("set session authorization quizotab_pilot_app");
  await assert.rejects(start(""),/configuration/);
  await assert.rejects(start("other@pilot.invalid"),/configuration/);
  await assert.rejects(startRegistrationFixture(db,{...pins,projectId:"another-project"},fixtureEmail),/independently verified/);
  const oldEnv=process.env.NODE_ENV;
  try {
    Object.assign(process.env,{NODE_ENV:"production"});
    await assert.rejects(start(),/deployed/);
  } finally {
    if (oldEnv===undefined) Reflect.deleteProperty(process.env,"NODE_ENV");
    else Object.assign(process.env,{NODE_ENV:oldEnv});
  }

  const password="local-only-fixture-password";
  const post=(url:string,body:Record<string,string>,origin=new URL(url).origin) => fetch(url,{
    method:"POST",headers:{origin,"content-type":"application/x-www-form-urlencoded","x-forwarded-for":"127.0.0.1"},
    body:new URLSearchParams(body),redirect:"error",
  });
  let listener=await start();
  const smtpKeys=["SMTP_HOST","SMTP_PORT","SMTP_USER","SMTP_PASS"] as const;
  const saved=smtpKeys.map(k=>process.env[k]);
  let deliveries=0;
  const smtp=createServer(socket=>{deliveries++; socket.destroy();});
  smtp.listen(0,"127.0.0.1");
  await once(smtp,"listening");
  try {
    const address=smtp.address();
    assert.ok(address && typeof address!=="string");
    Object.assign(process.env,{SMTP_HOST:"127.0.0.1",SMTP_PORT:String(address.port),SMTP_USER:"local",SMTP_PASS:"local"});
    const origin=new URL(listener.url).origin;
    // Exercise the real handler with a simulated external transport peer on a
    // disposable socket. Forwarding headers still claim loopback.
    const requests=channel("http.server.request.start");
    const external=(event:unknown)=>{
      const {request}=event as {request:IncomingMessage};
      Object.defineProperty(request.socket,"remoteAddress",{value:"192.0.2.15",configurable:true});
    };
    requests.subscribe(external);
    try {
      const response=await fetch(listener.url,{method:"POST",headers:{origin,connection:"close",
        "x-forwarded-for":"127.0.0.1","content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({password})});
      assert.equal(response.status,403);
    } finally {requests.unsubscribe(external);}
    assert.equal((await post(origin+"/register",{password})).status,403);
    assert.equal((await post(listener.url,{password},"http://example.invalid")).status,403);
    assert.equal((await post(listener.url,{email:"other@pilot.invalid",password})).status,400);
    // A verified startup cannot authorize writes after a target mismatch.
    await local.exec("set neon.endpoint_id='ep-wrong'");
    assert.equal((await post(listener.url,{password})).status,500);
    assert.equal(await listener.done,false);
    await local.exec(`set neon.endpoint_id='${pins.endpointId}'`);
    await local.exec("insert into public.rate_limits(key) select 'register:127.0.0.1' from generate_series(1,10)");
    listener=await start();
    assert.equal((await post(listener.url,{password})).status,429);
    assert.equal(await listener.done,false);
    await local.exec("delete from public.rate_limits where key='register:127.0.0.1'");
    listener=await start();
    assert.equal((await post(listener.url,{password:"short"})).status,400);
    assert.equal(await listener.done,false);
    listener=await start();
    assert.equal((await fetch(listener.url)).status,200);
    const response=await post(listener.url,{password});
    assert.equal(response.status,201);
    assert.equal(response.headers.get("set-cookie"),null);
    assert.equal(await listener.done,true);
    listener=await start();
    const duplicate=await post(listener.url,{password:"different password"});
    assert.equal(duplicate.status,400);
    assert.match(await duplicate.text(),/already registered/);
    assert.equal(await listener.done,false);
    assert.equal((await checkLogin(db,fixtureEmail,password)).status,"ok");
    // Simulate authoritative negative DNS responses, preserving the ordinary validator.
    const missing=async()=>{throw Object.assign(new Error("No record"),{code:"ENOTFOUND"});};
    const mx=mock.method(dns,"resolveMx",missing);
    const a=mock.method(dns,"resolve4",missing);
    try {
      for(const email of [fixtureEmail,"other@pilot.invalid"]) {
        const ordinary=await registerUser(db,{name:"Local",email,password});
        assert.ok(!ordinary.ok && ordinary.field==="email" && ordinary.error.includes("receive mail"));
      }
      assert.equal(mx.mock.callCount(),2);
      assert.equal(a.mock.callCount(),2);
    } finally {mx.mock.restore(); a.mock.restore();}
    assert.equal(deliveries,0);
  } finally {
    listener.close();
    smtp.close();
    smtpKeys.forEach((k,i)=>{if(saved[i]===undefined) delete process.env[k]; else process.env[k]=saved[i];});
    await local.exec("set session authorization quizotab_pilot_setup");
  }
  const rows=await local.query<{id:number;role:string;hashed:boolean;verified:boolean;stamp:string}>(`
    select id,role,password like '$2%' as hashed,email_verified_at is not null as verified,
    to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as stamp
    from public.users where email=$1`,[fixtureEmail]);
  assert.equal(rows.rows.length,1);
  const host=rows.rows[0];
  assert.ok(host.role==="host" && host.hashed && host.verified);
  assert.equal((await local.query("select 1 from public.auth_tokens where user_id=$1",[host.id])).rows.length,0);
  const approval=readHostApproval(String(host.id),{purpose:"synthetic-room-admission",hostId:host.id,email:fixtureEmail,createdAtUtc:host.stamp});
  assert.deepEqual(await pilotHostAdmission(drizzle(local),pins,"host-preflight",approval),{open:false,hostId:null});
  console.log("ok  pilot-only loopback registration, live-session recheck on local database, hashing, duplicate, login, no mail and host preflight");
}
