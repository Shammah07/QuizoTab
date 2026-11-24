// Operator-run only. Each invocation consumes one fresh, two-room synthetic fixture.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {closeSync,fsyncSync,openSync,readFileSync,writeSync} from "node:fs";
import {isAbsolute} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {z} from "zod";
import {readPins} from "../lib/db/pilot-target.ts";
import {stagingApproval} from "../lib/db/staging-approval.ts";

const label=z.string().min(1).max(120);
const actor=z.number().int().positive();
const id=z.uuid();
const room=z.strictObject({id,context:label,round:label,judge:actor,host:actor,teams:z.array(z.strictObject({id,name:label})).length(2),questions:z.array(label)});
const manifest=z.strictObject({origin:z.url(),pins:z.unknown(),project:label,commit:z.string().regex(/^[0-9a-f]{40}$/),tournament:id,
  owner:actor,rooms:z.array(room).length(2),publicText:z.array(z.string()).min(1),spectators:z.union([z.literal(30),z.literal(60)])});
const credential=z.string().regex(/^[A-Za-z0-9._-]+$/);
const credentials=z.strictObject({observer:credential.min(32),guestCode:z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/),owner:credential,
  judges:z.array(credential).length(2),hosts:z.array(credential).length(2),protectionBypass:credential.optional()});
const pct=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(p*values.length)-1];
const allowed=(value,keys)=>assert.ok(value && Object.keys(value).every(key=>keys.includes(key)),"Unexpected spectator field");

export async function rehearsal(raw,privateInput,record,{transport=fetch,intervalScale=1,trusted}={}) {
  const m=manifest.parse(raw), secrets=credentials.parse(privateInput), pins=readPins(m.pins), origin=new URL(m.origin);
  stagingApproval({purpose:"synthetic-staging-acceptance",pins,origin:m.origin,project:m.project,tournament:m.tournament,spectators:m.spectators},trusted);
  assert.ok(origin.protocol==="https:" && origin.origin===m.origin && pins.projectId!=="noisy-violet-99522280" &&
    pins.branchId!=="br-restless-king-bdli89ow" && pins.endpointId!=="ep-long-fog-bdc5rxjn" && m.project.startsWith("prj_"));
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED,undefined);
  const minutes=m.spectators===30?15:10;
  const teams=m.rooms.flatMap(r=>r.teams);
  assert.equal(new Set(teams.map(t=>t.id)).size,4);
  assert.equal(new Set(teams.map(t=>t.name)).size,4);
  assert.equal(new Set([m.owner,...m.rooms.flatMap(r=>[r.judge,r.host])]).size,5);
  assert.equal(new Set(m.rooms.map(r=>r.id)).size,2);
  for(const r of m.rooms) assert.ok(r.questions.length===minutes && new Set(r.questions).size===minutes);
  const stop=new AbortController(),samples=[],ledger=new Map(),instances=new Map();
  const publicPath="/api/tournaments/"+secrets.guestCode;
  const base="/api/tournaments/"+m.tournament+"/rooms/";
  const owner="/api/host/tournaments/"+m.tournament;
  let requests=0,errors=0,concurrent=0,peak=0,stopping=false;
  const statuses={};
  async function http(kind,path,{cookie,body,status=200,observe=false,interruptRead=false}={}) {
    assert.ok(!stopping);
    const begin=performance.now(), method=body===undefined?"GET":"POST";
    requests++; peak=Math.max(peak,++concurrent);
    try {
      const headers={accept:"application/json",origin:m.origin};
      if(cookie) headers.cookie="__Host-qt_stage_session="+cookie;
      if(interruptRead) {
        assert.equal(method,"GET");
        headers.connection="close";
      }
      if(body!==undefined) headers["content-type"]="application/json";
      if(observe) headers.authorization="Bearer "+secrets.observer;
      if(secrets.protectionBypass) headers["x-vercel-protection-bypass"]=secrets.protectionBypass;
      const response=await transport(new URL(path,m.origin),{method,headers,redirect:"error",cache:"no-store",
        signal:AbortSignal.any([stop.signal,AbortSignal.timeout(5000)]),body:body===undefined?undefined:JSON.stringify(body)});
      const outcome=method+" "+kind+" "+response.status;
      statuses[outcome]=(statuses[outcome]??0)+1;
      if(response.status!==status) throw new Error(kind+" unexpected HTTP "+response.status);
      if(interruptRead) {
        await response.body.cancel();
        samples.push({kind,method,at:performance.now(),ms:performance.now()-begin});
        return;
      }
      const data=await response.json();
      samples.push({kind,method,at:performance.now(),ms:performance.now()-begin});
      return data;
    } catch { errors++;record({failed:kind,errors,requests,statuses:{...statuses},at:new Date().toISOString()});throw new Error(kind+" failed; reconcile before another run"); }
    finally {concurrent--;}
  }
  const telemetry=async(full=false)=>{
    const v=await http("telemetry","/api/staging/acceptance"+(full?"?ledger=1":""),{observe:true});
    assert.deepEqual(v.identity,{project_id:pins.projectId,branch_id:pins.branchId,endpoint_id:pins.endpointId,
      database:pins.database,login_role:pins.runtimeRole,effective_role:pins.runtimeRole});
    assert.ok(v.project===m.project && v.commit===m.commit && v.id===m.tournament && v.origin===m.origin && v.owner===m.owner);
    const now=performance.now(),prior=instances.get(v.instance);
    assert.ok(v.lock.seconds<=5 && v.rss>0 && v.rss<.8*v.memoryLimitMiB*1048576 && v.pool.max>0);
    const high=v.pool.active/v.pool.max>.8 ? prior?.high??now : null;
    assert.ok(high===null || now-high<60000);
    const cpu=v.cpu.user+v.cpu.system;
    instances.set(v.instance,{high,cpu,at:now,maxCpuPercent:Math.max(prior?.maxCpuPercent??0,
      prior?(cpu-prior.cpu)/(10*(now-prior.at)):0),peakRss:Math.max(prior?.peakRss??0,v.rss),
      peakActive:Math.max(prior?.peakActive??0,v.pool.active),peakWaiting:Math.max(prior?.peakWaiting??0,v.pool.waiting),
      peakLockSeconds:Math.max(prior?.peakLockSeconds??0,v.lock.seconds)});
    record({at:new Date().toISOString(),instance:v.instance,pool:v.pool,lock:v.lock,rss:v.rss,cpu:v.cpu});
    return v;
  };
  const publicBoard=async(r,team,expected)=>{
    const data=await http("standings",publicPath+"?section=standings"+(r?"&room="+r.id:""));
    allowed(data,["title","about","format","competitionStatus","status","standings","draw","room","rooms","tables","fixtures","contexts","updatedAt"]);
    assert.equal(data.fixtures.length,0);
    const texts=new Set([...m.publicText,...teams.map(t=>t.name),...m.rooms.map(r=>r.id)]);
    function checkStrings(value) {
      if(typeof value==="string") assert.ok(texts.has(value),"Unreviewed public text");
      else if(value && typeof value==="object") for(const v of Object.values(value)) checkStrings(v);
    }
    const {updatedAt,...display}=data;
    assert.ok(updatedAt===null || (typeof updatedAt==="string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(updatedAt)));
    checkStrings(display);
    for(const info of data.rooms) allowed(info,["id","name"]);
    assert.ok(data.contexts.every(c=>typeof c==="string"));
    assert.equal(data.tables.length,1);
    const table=data.tables[0];allowed(table,["label","rows"]);
    assert.deepEqual(table.rows.map(t=>t.name).sort(),(r?r.teams:teams).map(t=>t.name).sort());
    for(const row of table.rows) {
      allowed(row,["name","schoolOrCategory","total","rounds"]);
      for(const round of row.rounds) allowed(round,["name","points"]);
      if(row.name===team) assert.equal(row.total,expected);
    }
    return table.rows;
  };
  const workspace=(i,role)=>http(role,base+m.rooms[i].id+"/workspace?role="+role,{cookie:role==="judge"?secrets.judges[i]:secrets.hosts[i]});
  const totals=new Map(teams.map(t=>[t.name,0]));
  const initial=await telemetry(true);
  assert.deepEqual(initial.ledger,[]);
  assert.ok((await publicBoard()).every(row=>row.total===0));
  await http("owner",owner+"/operations",{cookie:secrets.owner});
  for(const [i,r] of m.rooms.entries()) {
    assert.equal((await workspace(i,"judge")).userId,r.judge);
    assert.equal((await workspace(i,"room_host")).userId,r.host);
    await http("assignment denial",base+r.id+"/workspace?role=judge",{cookie:secrets.judges[1-i],status:403});
  }
  const start=performance.now(),jobs=[];
  function schedule(offset,period,work) {
    jobs.push((async()=>{
      try {
        for(let t=offset;t<minutes*60000;t+=period) {
          await sleep(Math.max(0,start+t*intervalScale-performance.now()),undefined,{signal:stop.signal});
          await work(Math.floor((t-offset)/period));
        }
      } catch(err) {stopping=true;stop.abort();throw err;}
    })());
  }
  for(let i=0;i<m.spectators;i++) schedule(i*6000/m.spectators,6000,()=>publicBoard(i%2?m.rooms[Math.floor(i/2)%2]:undefined));
  schedule(0,15000,()=>http("owner",owner+"/operations",{cookie:secrets.owner}));
  for(const [i,r] of m.rooms.entries()) {
    const path=base+r.id;
    schedule(i*1000,12000,()=>Promise.all([workspace(i,"judge"),workspace(i,"room_host"),
      http("queue",path+"/scores/pending",{cookie:secrets.hosts[i]}),
      http("preview",path+"/completion?preview=1&contextId="+encodeURIComponent(r.context),{cookie:secrets.hosts[i]})]));
    schedule(2500,60000,async q=>{
      for(const [index,team] of r.teams.entries()) {
        const points=(i+index+q)%4,clientRequestId=randomUUID(),questionKey=r.questions[q];
        const payload={teamId:team.id,roundId:r.round,contextId:r.context,points,questionKey,clientRequestId};
        record({at:new Date().toISOString(),action:"submit",tournament:m.tournament,room:r.id,judge:r.judge,payload});
        const receipt=await http("submit",path+"/scores",{cookie:secrets.judges[i],body:payload,status:201});
        const submittedAt=performance.now();
        assert.ok(receipt.status==="pending" && z.uuid().safeParse(receipt.scoreId).success);
        await publicBoard(r,team.name,totals.get(team.name));
        const queue=await http("pending review",path+"/scores/pending",{cookie:secrets.hosts[i]});
        assert.ok(queue.scores.some(s=>s.scoreId===receipt.scoreId && s.points===points && s.judgeUserId===r.judge));
        const decision=await http("review",path+"/decisions",{cookie:secrets.hosts[i],body:{scoreId:receipt.scoreId,decision:"approve"}});
        assert.equal(decision.status,"approved");
        assert.ok(performance.now()-submittedAt<=10000,"Room-host review exceeded ten seconds");
        totals.set(team.name,totals.get(team.name)+points);
        ledger.set(clientRequestId,{id:receipt.scoreId,client_request_id:clientRequestId,room_id:r.id,context_id:r.context,
          round_id:r.round,team_id:team.id,question_key:questionKey,points,status:"approved",judge_user_id:r.judge,
          reviewer_user_id:r.host,events:[["submitted",r.judge],["approved",r.host]]});
      }
    });
  }
  let slow=0;
  schedule(0,5000,async tick=>{
    await telemetry();
    if(tick>0 && tick%12===0) {
      const recent=samples.filter(s=>performance.now()-s.at<=60000);
      const tail=method=>pct(recent.filter(s=>s.method===method).map(s=>s.ms),.95)??0;
      slow=tail("GET")>1000 || tail("POST")>2000 ? slow+1 : 0;
      assert.ok(slow<2,"Latency stop threshold");
    }
  });
  const outcomes=await Promise.allSettled(jobs);
  if(outcomes.some(r=>r.status==="rejected")) throw new Error("Stopped workload. Reconcile in-flight requests read-only.");
  const drain=performance.now();
  for(const [i,r] of m.rooms.entries()) {
    const path=base+r.id+"/completion",cookie=secrets.hosts[i];
    const preview=await http("completion preview",path+"?contextId="+encodeURIComponent(r.context),{cookie});
    const closed=await http("close",path,{cookie,body:{contextId:r.context,configRevision:preview.configRevision,lifecycleRevision:preview.lifecycleRevision}});
    assert.equal(closed.completed,true);
  }
  const final=await telemetry(true);
  assert.equal(ledger.size,4*minutes);assert.equal(final.ledger.length,ledger.size);
  for(const row of final.ledger) assert.deepEqual(row,ledger.get(row.client_request_id));
  for(const row of await publicBoard()) assert.equal(row.total,totals.get(row.name));
  await http("interrupted staff read",base+m.rooms[0].id+"/workspace?role=judge",{cookie:secrets.judges[0],interruptRead:true});
  const disconnect=performance.now();
  assert.equal((await workspace(0,"judge")).userId,m.rooms[0].judge);
  const reconnectMs=performance.now()-disconnect;
  const recoveryMs=performance.now()-drain;
  assert.ok(recoveryMs<30000 && final.pool.waiting===0);
  await http("sharing revocation",owner+"/sharing",{cookie:secrets.owner,body:{action:"save",listed:false,showStandings:false,showDraw:false}});
  for(const key of [secrets.guestCode,m.tournament]) await http("sharing denial","/api/tournaments/"+key+"?section=standings",{status:404});
  await http("device logout","/api/account/session",{cookie:secrets.judges[0],body:{}});
  await http("revoked session",base+m.rooms[0].id+"/workspace?role=judge",{cookie:secrets.judges[0],status:401});
  await workspace(1,"judge");
  const latency=Object.fromEntries([...new Set(samples.map(s=>s.kind))].map(kind=>{
    const times=samples.filter(s=>s.kind===kind).map(s=>s.ms);
    return [kind,{n:times.length,ms:[.5,.95,.99].map(p=>Math.ceil(pct(times,p))),maxMs:Math.ceil(Math.max(...times))}];
  }));
  assert.ok(pct(samples.map(s=>s.ms),.99)<=5000);
  const report={requests,peak,errors,errorRate:errors/requests,statuses,rps:1000*requests/(performance.now()-start),recoveryMs,reconnectMs,
    entries:ledger.size,events:ledger.size*2,latency,instances:[...instances.values()]};
  record(report);
  return report;
}

if(process.argv[1] && import.meta.url===(await import("node:url")).pathToFileURL(process.argv[1]).href) {
  try {
    const args=process.argv.slice(2);
    assert.ok(args.length===3 && args.every(f=>isAbsolute(f)) && new Set(args).size===3);
    const [plan,secrets]=args.slice(0,2).map(f=>JSON.parse(readFileSync(f,"utf8")));
    const fd=openSync(args[2],"wx",0o600);
    try {
      const report=await rehearsal(plan,secrets,value=>{writeSync(fd,JSON.stringify(value)+"\n");fsyncSync(fd);});
      console.log(JSON.stringify(report));
    } finally {closeSync(fd);}
  } catch {console.error("HTTPS acceptance refused or stopped. Preserve evidence and reconcile before another run.");process.exitCode=1;}
}
