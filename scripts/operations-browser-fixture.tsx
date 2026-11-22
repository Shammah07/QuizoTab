import { createRoot } from "react-dom/client";
import { RoomOperationsPanel } from "@/components/host/room-operations-panel";

async function test() {
  let revision="initial",writes=0;
  const state={enabled:false,pointsFormat:true,status:"active",teams:[{id:"a",name:"Team A"}],
    rounds:[{id:"skills",name:"Skills",min:0,max:5}],plan:{rounds:[],rosters:[]},unassigned:[],
    rooms:[{id:"hall",name:"Hall",staff:[],pending:0,approved:0,missing:0,completed:0,
      contexts:[{participants:["Team A"],id:"draft",label:"Skills",setup:["Assign a room host."],reasons:["Assign a room host."],
        blockers:["Assign a room host."],released:false,completed:false,disputes:[]}]}]};
  window.fetch=async(_url,options)=>{
    if(options?.method==="POST"){
      const body=JSON.parse(String(options.body));
      if(body.action!=="save" || body.revision!==revision || body.plan.rounds[0].questions[0].id!=="Q1") throw new Error("Invalid save");
      state.plan=body.plan;revision="saved";writes++;
    }
    return Response.json({...state,revision});
  };
  const root=createRoot(document.getElementById("app")!);
  root.render(<RoomOperationsPanel endpoint="/operations" adjudication="/adjudication"/>);
  const btn=(s:string)=>Array.from(document.querySelectorAll("button")).find(b=>b.textContent===s);
  const until=async(predicate:()=>boolean,msg:string)=>{
    for(let i=0;i<200;i++){if(predicate()) return;await new Promise(r=>setTimeout(r,10));}
    throw new Error(msg);
  };
  await until(()=>!!btn("Edit competition plan"),"Monitor failed to load");
  if(!btn("Release roster")?.disabled) throw new Error("Release available without host");
  btn("Edit competition plan")!.click();
  await until(()=>!!btn("Add question"),"Editor missing");
  btn("Add question")!.click();
  await until(()=>document.body.textContent.includes("Configured totals 0–1"),"Point totals incorrect");
  revision="changed";btn("Refresh monitor")!.click();
  await until(()=>!!btn("Save plan")?.disabled,"Stale edit remained writable");
  if(!document.querySelector('input[value="Q1"]')) throw new Error("Refresh lost draft question");
  btn("Discard draft")!.click();
  await until(()=>!!btn("Edit competition plan"),"Discard failed");
  btn("Edit competition plan")!.click();
  await until(()=>!!btn("Add question"),"Reload failed");
  btn("Add question")!.click();
  await until(()=>!!document.querySelector('input[value="Q1"]'),"Slot missing");
  btn("Save plan")!.click();
  await until(()=>writes===1 && !!btn("Edit competition plan"),"Save failed");
  const base = "/api/host/tournaments/synthetic";
  const reopening = "/api/tournaments/synthetic/rooms/hall/reopen";
  let lifecycleRevision = 1, attempts = 0, blocked = true;
  state.enabled = true;
  const context = state.rooms[0].contexts[0];
  context.completed = true;
  context.released = true;
  window.fetch = async (url, options) => {
    if (url === base + "/operations") return Response.json({...state,revision});
    if (url === base + "/adjudication") return Response.json({cases:[],history:[]});
    if (url === reopening + "?preview=1&contextId=draft") return Response.json({
      contextId:"draft", completed:context.completed, configRevision:revision, lifecycleRevision,
      blocker:blocked ? "A released downstream fixture depends on this result." : null,
    });
    if (url !== reopening || options?.method !== "POST") throw new Error("Unexpected reopening request");
    const body = JSON.parse(String(options.body));
    if (body.contextId !== "draft" || body.reason !== "Check the scoring sheet" ||
        body.lifecycleRevision !== lifecycleRevision || body.configRevision !== revision) throw new Error("Incorrect reopening request");
    attempts++;
    lifecycleRevision++;
    if (attempts === 1) return Response.json({error:"Lifecycle revision changed."},{status:409});
    context.completed = false;
    return Response.json({completed:false});
  };
  root.render(<RoomOperationsPanel key="reopen" endpoint={base+"/operations"} adjudication={base+"/adjudication"}/>);
  await until(()=>!!btn("Review reopening"),"Missing reopening control");
  btn("Review reopening")!.click();
  await until(()=>document.body.textContent.includes("A released downstream fixture"),"Missing dependency blocker");
  if (btn("Reopen Skills")) throw new Error("Blocked reopening available");
  blocked = false;
  btn("Review reopening")!.click();
  await until(()=>!!btn("Reopen Skills"),"Missing reason form");
  const reason = ()=>document.querySelector<HTMLInputElement>('input[name="reason"]')!;
  btn("Reopen Skills")!.click();
  if (!reason().validity.valueMissing || attempts) throw new Error("Empty reason accepted");
  reason().value = "Check the scoring sheet";
  btn("Reopen Skills")!.click();
  await until(()=>document.body.textContent.includes("Lifecycle revision changed.") && !btn("Reopen Skills")?.disabled,"Stale response lost");
  reason().value = "Check the scoring sheet";
  btn("Reopen Skills")!.click();
  await until(()=>attempts===2 && !btn("Review reopening") && document.body.textContent.includes("Skills · Released"),"Official monitor did not refresh after reopening");
  document.getElementById("result")!.textContent="PASS";
}
void test().catch(error=>{document.getElementById("result")!.textContent="FAIL "+String(error);});
