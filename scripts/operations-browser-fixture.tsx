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
  document.getElementById("result")!.textContent="PASS";
}
void test().catch(error=>{document.getElementById("result")!.textContent="FAIL "+String(error);});
