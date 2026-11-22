"use client";
import { useRef, useState } from "react";
import { api } from "@/components/quiz/api";
import { Button } from "@/components/ui/button";

type Preview={contextId:string;configRevision:string;lifecycleRevision:number;completed:boolean;blocker:string|null};
export function ReopenContext({endpoint,contextId,label,refresh}:{endpoint:string;contextId:string;label:string;refresh:()=>Promise<void>}) {
  const [preview,setPreview]=useState<Preview|null>(null);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  async function review() {
    const result=await api<Preview>(endpoint+"?preview=1&contextId="+encodeURIComponent(contextId));
    setPreview(result.ok?result:null);
    if(!result.ok) setMessage(result.error);
  }
  async function run(work:()=>Promise<void>) {
    if(lock.current) return;
    lock.current=true;setBusy(true);setMessage("");
    try {await work();} finally {lock.current=false;setBusy(false);}
  }
  return <div className="my-2 space-y-2">
    <Button size="sm" variant="line" disabled={busy} onClick={()=>void run(review)}>Review reopening</Button>
    {message && <p role="status">{message}</p>}
    {preview && <form key={preview.configRevision+":"+preview.lifecycleRevision} onSubmit={e=>{
      e.preventDefault();
      const reason=String(new FormData(e.currentTarget).get("reason") ?? "").trim();
      if(reason.length<3){setMessage("Enter a reason of at least three characters.");return;}
      if(preview.blocker || !preview.completed) return;
      void run(async()=>{
        const result=await api(endpoint,{body:{contextId,configRevision:preview.configRevision,lifecycleRevision:preview.lifecycleRevision,reason}});
        if(result.ok) {setPreview(null);setMessage("Fixture reopened.");}
        else {setMessage(result.error);await review();}
        await refresh();
      });
    }}>
      <p>{label} · {preview.completed?"Completed":"Open"}</p>
      {preview.blocker ? <p>{preview.blocker}</p> : preview.completed && <>
        <label>Reopening reason <input required minLength={3} maxLength={1000} name="reason" disabled={busy}/></label>{" "}
        <Button size="sm" type="submit" disabled={busy}>Reopen {label}</Button></>}
    </form>}
  </div>;
}
