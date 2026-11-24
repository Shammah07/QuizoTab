// HTTPS transport for the real authentication services against the runner's restricted role.
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createRequire} from "node:module";
import {mock} from "node:test";
import {createServer,request} from "node:https";
import {NextRequest} from "next/server";
import {proxy} from "../proxy.ts";
import {checkLogin} from "../lib/auth/accounts.ts";
import {createSession,getSession,destroySession} from "../lib/auth/session.ts";
import {staffWorkspace} from "../lib/tournament/staff-workspace.ts";

export async function testStagingLogin({dir,db,email,password,tournament,room}) {
  const key=join(dir,"loopback.key"),cert=join(dir,"loopback.crt");
  const openssl=process.env.QT_TEST_OPENSSL || "openssl";
  execFileSync(openssl,["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-subj","/CN=localhost",
    "-addext","subjectAltName=IP:127.0.0.1","-keyout",key,"-out",cert],{stdio:"ignore",windowsHide:true});
  const ca=readFileSync(cert), previous={...process.env};
  const headers=createRequire(import.meta.url)("next/headers");
  const {RequestCookies,ResponseCookies}=createRequire(import.meta.url)("next/dist/compiled/@edge-runtime/cookies");
  let jar,origin;
  const cookies=mock.method(headers,"cookies",async()=>jar);
  const server=createServer({key:readFileSync(key),cert:ca},async(req,res)=>{
    try {
      const h=new Headers(req.headers);
      const entry=new NextRequest(origin+req.url,{method:req.method,headers:h});
      if(proxy(entry).status!==200) {res.writeHead(403).end();return;}
      const incoming=new RequestCookies(h),outgoing=new Headers(), responseCookies=new ResponseCookies(outgoing);
      jar={get:n=>incoming.get(n),set:(...args)=>responseCookies.set(...args)};
      let status=200;
      if(req.url==="/login" && req.method==="POST") {
        const chunks=[];
        for await(const chunk of req) chunks.push(chunk);
        const body=JSON.parse(Buffer.concat(chunks).toString());
        const login=await checkLogin(db,body.email,body.password);
        if(login.status!=="ok") status=401;
        else await createSession({userId:login.user.id,name:login.user.name,role:login.user.role},db);
      } else if(req.url==="/logout" && req.method==="POST") await destroySession(db);
      else if(req.url==="/staff" && req.method==="GET") {
        const actor=await getSession(db);
        if(!actor) status=401;
        else assert.equal((await staffWorkspace(db,tournament,room,actor,"judge")).userId,actor.userId);
      } else status=404;
      res.writeHead(status,Object.fromEntries(outgoing)).end();
    } catch {res.writeHead(500).end();}
  });
  try {
    await new Promise((ok,fail)=>server.once("error",fail).listen(0,"127.0.0.1",ok));
    origin="https://127.0.0.1:"+server.address().port;
    Object.assign(process.env,{QUIZOTAB_STAGE:"staging",APP_URL:origin,SESSION_SECRET:randomBytes(32).toString("hex")});
    function call(path,method,headers={},body) {
      return new Promise((ok,fail)=>{
        const req=request(origin+path,{method,ca,agent:false,headers:{origin,...headers}},res=>{
          res.resume();res.once("end",()=>ok(res));
        });
        req.on("error",fail);req.end(body?JSON.stringify(body):undefined);
      });
    }
    assert.equal((await call("/login","POST",{"x-forwarded-host":"wrong.invalid"},{email,password})).statusCode,403);
    const login=await call("/login","POST",{},{email,password});
    assert.equal(login.statusCode,200);
    const issued=login.headers["set-cookie"][0];
    for(const flag of ["HttpOnly","Secure","SameSite=lax","Path=/","Max-Age=28800"]) assert.ok(issued.includes(flag));
    const cookie=issued.split(";")[0];
    assert.equal((await call("/staff","GET",{cookie})).statusCode,200);
    assert.equal((await call("/logout","POST",{cookie})).statusCode,200);
    assert.equal((await call("/staff","GET",{cookie})).statusCode,401);
    console.log("Verified authenticated staging staff workspace and logout replay over loopback TLS.");
  } finally {
    await new Promise(ok=>server.close(ok));
    cookies.mock.restore();
    for(const k of ["QUIZOTAB_STAGE","APP_URL","SESSION_SECRET"]) {
      if(previous[k]===undefined) delete process.env[k];else process.env[k]=previous[k];
    }
  }
}
