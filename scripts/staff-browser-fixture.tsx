// Bundled only by the local headless browser test.
import { createRoot } from "react-dom/client";
import { RoomWorkspace } from "@/components/host/room-workspace";
import { scoreRequest } from "@/components/host/staff-requests";
import { api } from "@/components/quiz/api";
import type { StaffWorkspace } from "@/lib/tournament/staff-workspace";

async function test() {
  const root = createRoot(document.getElementById("app")!);
  const sleep = () => new Promise(resolve=>setTimeout(resolve,10));
  const expect = (ok:unknown,msg:string) => {if (!ok) throw new Error(msg);};
  async function until(check:()=>boolean,msg:string) {
    for(let i=0;i<150;i++){if(check()) return;await sleep();}
    throw new Error(msg);
  }
  const has = (label:string)=>document.getElementById("app")!.textContent.includes(label);
  const button = (label:string)=>Array.from(document.querySelectorAll("button")).find(b=>b.textContent===label)!;
  const context = {id:"fixture",label:"Final",completed:false,bye:false,teams:[{id:"team",name:"Team A"}],
    rounds:[{id:"round",name:"Skills",questions:[{id:"Q1",minPoints:0,maxPoints:3}]}]};
  const history:StaffWorkspace["history"] = JSON.parse(sessionStorage.getItem("mock-server") ?? "[]");
  let revoked=false,delayed=false;
  let oldReply:(()=>void)|undefined;
  let posts=0;
  const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
  window.fetch = async (url,options)=>{
    const path = String(url);
    if (path==="/incomplete") return new Response("{", {status:200});
    expect(options?.signal instanceof AbortSignal,"Room request lacks a deadline signal");
    if (revoked) return json({error:"No active assignment for this room and role."},403);
    if (path.endsWith("/scores") && options?.method==="POST") {
      posts++;
      const body=JSON.parse(String(options.body));
      history.push({id:"score",points:body.points,status:"pending",reason:null,revision:1,...{
        contextId:"fixture",roundId:"round",teamId:"team",questionKey:"Q1"}});
      sessionStorage.setItem("mock-server",JSON.stringify(history));
      sessionStorage.setItem("sent-id",body.clientRequestId);
      throw new Error("Simulated lost response after commit");
    }
    if(path.endsWith("/scores/pending")) return json({scores:[{scoreId:"s",teamName:"Team A",contextName:"Final",judgeName:"Guest judge",
      roundName:"Skills",questionKey:"Q1",points:2,previousPoints:1,correctionOf:"previous",reason:"Review",judgeUserId:2,
      adjudication:{approval:true,rejection:true}}]});
    if(path.includes("/completion?")) return json({coverage:{required:1,approved:0,missingCount:0,missing:[],pendingScores:0,pendingRevisions:1},blocker:"Resolve pending reviews.",completed:false,contextId:"fixture"});
    if(delayed && path.startsWith("/old/")) await new Promise<void>(resolve=>{oldReply=resolve;});
    return json({tournament:"Quiz",room:path.startsWith("/old/")?"Old room":"New room",userId:1,status:"active",
      role:path.includes("room_host")?"room_host":"judge",contexts:[context],history,coverage:[],standings:[]});
  };
  const mount=(base:string,role:"judge"|"room_host")=>root.render(<RoomWorkspace key={base+role} base={base} role={role} userId={1}/>);
  const incomplete = await api("/incomplete");
  expect(!incomplete.ok && incomplete.status===0,"Unreadable receipt reported success");
  if(!sessionStorage.getItem("mock-server")) {
    mount("/new","judge");
    await until(()=>!!button("Submit for review"),"Judge form did not load");
    const input=document.querySelector<HTMLInputElement>('input[name="points"]')!;
    input.value="2";
    button("Submit for review").click();button("Submit for review").click();
    await until(()=>has("Awaiting review"),"Lost response did not reconcile");
    await until(()=>has("check score history"),"Lost-response recovery guidance missing");
    expect(posts===1,"Double click sent a second submission");
    location.reload();
    return;
  }
  mount("/new","judge");
  await until(()=>has("Awaiting review"),"Refresh lost the committed entry");
  const retry=await scoreRequest(sessionStorage,"1//new","scores",{contextId:"fixture",teamId:"team",roundId:"round",questionKey:"Q1",points:2});
  expect(retry.requestId===sessionStorage.getItem("sent-id"),"Exact retry lost its ID on reload");
  mount("/old","judge");
  await until(()=>has("Old room"),"Old room failed");
  delayed=true;button("Refresh room").click();
  await until(()=>!!oldReply,"Expected delayed read");
  mount("/new","room_host");
  await until(()=>has("Pending administrator adjudication"),"Host adjudication handoff missing");
  oldReply!();await sleep();
  expect(has("New room")&&!has("Old room"),"Stale response replaced the new room");
  expect(button("Approve").disabled && button("Reject").disabled && button("Complete Final").disabled,"Blocked controls enabled");
  revoked=true;button("Refresh room").click();
  await until(()=>has("No active assignment"),"Revocation message missing");
  expect(!has("Team A")&&!has("Guest judge")&&!has("New room"),"Protected data survived revocation");
  document.getElementById("result")!.textContent="PASS";
}
void test().catch(e=>{document.getElementById("result")!.textContent="FAIL "+String(e);});
