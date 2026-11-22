"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomOperations } from "@/lib/tournament/room-operations";
import { api } from "@/components/quiz/api";
import { Button } from "@/components/ui/button";
import { ReopenContext } from "./reopen-context";
import { AdjudicationPanel } from "./adjudication-panel";

type Plan = RoomOperations["plan"];
type Command = (body:Record<string,unknown>)=>Promise<boolean>;

function PlanEditor({source,save,cancel,busy,stale}:{source:RoomOperations;save:Command;cancel:()=>void;busy:boolean;stale:boolean}) {
  const [plan,setPlan]=useState<Plan>(source.plan);
  const [roundId,chooseRound]=useState(source.rounds[0]?.id ?? "");
  const round=source.rounds.find(r=>r.id===roundId);
  const questions=plan.rounds.find(r=>r.id===roundId)?.questions ?? [];
  const totalMin=questions.reduce((n,q)=>n+q.minPoints,0);
  const totalMax=questions.reduce((n,q)=>n+q.maxPoints,0);
  function setQuestions(next:typeof questions) {
    const rounds=plan.rounds.filter(r=>r.id!==roundId);
    setPlan({...plan,rounds:next.length ? [...rounds,{id:roundId,questions:next}] : rounds});
  }
  type Roster=Plan["rosters"][number];
  function updateRoster(id:string,patch:Partial<Roster>) {
    setPlan({...plan,rosters:plan.rosters.map(r=>r.id===id ? {...r,...patch} : r)});
  }
  const problems:string[]=[];
  for (const p of plan.rounds) {
    const r=source.rounds.find(r=>r.id===p.id);
    if (!r) {problems.push("A configured round is no longer available.");continue;}
    const ids=p.questions.map(q=>q.id.trim());
    if (ids.some(id=>!id) || new Set(ids).size!==ids.length) problems.push(r.name+": give every question a distinct identifier.");
    if (p.questions.some(q=>!Number.isInteger(q.maxPoints) || !Number.isInteger(q.minPoints) || q.minPoints<0 || q.minPoints>q.maxPoints) ||
      p.questions.reduce((n,q)=>n+q.minPoints,0)<r.min || p.questions.reduce((n,q)=>n+q.maxPoints,0)>r.max) problems.push(r.name+": adjust the question limits.");
  }
  if (plan.rosters.some(r=>!r.teamIds.length || !plan.rounds.some(p=>p.id===r.roundId))) problems.push("Each roster needs teams and a configured round.");
  return <form className="space-y-4 border border-line p-4 [&_input]:rounded [&_select]:rounded [&_input]:p-2 [&_select]:p-2 [&_input]:border [&_select]:border" onSubmit={async e=>{
    e.preventDefault();if (!stale && !problems.length && await save({action:"save",revision:source.revision,plan})) cancel();
  }}>
    <h3 className="text-xl font-bold">Question plan</h3>
    <fieldset disabled={busy || stale} className="space-y-4">
      <label>Competition round <select value={roundId} onChange={e=>chooseRound(e.target.value)}>{source.rounds.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      {round && <p>Round limits {round.min}–{round.max} · Configured totals {totalMin}–{totalMax} · {questions.length} questions</p>}
      {questions.map((q,i)=><div key={i} className="flex flex-wrap items-end gap-2">
        <label>Question identifier <input required maxLength={80} value={q.id} onChange={e=>setQuestions(questions.map((v,j)=>i===j ? {...v,id:e.target.value} : v))}/></label>
        {(["minPoints","maxPoints"] as const).map(k=><label key={k}>{k==="minPoints"?"Minimum":"Maximum"} <input className="w-20" type="number" min={0} max={100000} required value={Number.isNaN(q[k])?"":q[k]}
          onChange={e=>setQuestions(questions.map((v,j)=>i===j ? {...v,[k]:e.target.valueAsNumber} : v))}/></label>)}
        <button type="button" onClick={()=>setQuestions(questions.filter((_,j)=>i!==j))}>Remove question</button>
      </div>)}
      <Button variant="line" size="sm" disabled={!round} onClick={()=>{
        let index=questions.length+1;
        while (questions.some(q=>q.id==="Q"+index)) index++;
        setQuestions([...questions,{id:"Q"+index,minPoints:0,maxPoints:Math.min(1,Math.max(0,(round?.max ?? 0)-totalMax))}]);
      }}>Add question</Button>
      {source.pointsFormat && <section className="space-y-3"><h3 className="text-xl font-bold">Round rosters</h3>
        {plan.rosters.map(r=><fieldset key={r.id} disabled={r.released} className="space-y-2 border border-line p-3">
          <legend>{r.released?"Released roster":"Draft roster"}</legend>
          <label>Room <select value={r.roomId} onChange={e=>updateRoster(r.id,{roomId:e.target.value})}>{source.rooms.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
          <label> Round <select value={r.roundId} onChange={e=>updateRoster(r.id,{roundId:e.target.value,teamIds:[]})}>{source.rounds.map(round=><option key={round.id} value={round.id}>{round.name}</option>)}</select></label>
          <div className="grid gap-2 sm:grid-cols-2">{source.teams.map(team=><label key={team.id}>
            <input type="checkbox" checked={r.teamIds.includes(team.id)} disabled={plan.rosters.some(o=>o.id!==r.id && o.roundId===r.roundId && o.teamIds.includes(team.id))}
              onChange={e=>updateRoster(r.id,{teamIds:e.target.checked?[...r.teamIds,team.id]:r.teamIds.filter(id=>id!==team.id)})}/> {team.name}</label>)}</div>
          {!r.released && <button type="button" onClick={()=>setPlan({...plan,rosters:plan.rosters.filter(o=>o.id!==r.id)})}>Remove draft roster</button>}
        </fieldset>)}
        <Button size="sm" variant="line" disabled={!source.rooms.length || !round} onClick={()=>setPlan({...plan,rosters:[...plan.rosters,{id:crypto.randomUUID(),roomId:source.rooms[0].id,roundId,released:false,teamIds:[]}]})}>Add draft roster</Button>
      </section>}
    </fieldset>
    {problems.map(p=><p key={p} role="alert">{p}</p>)}
    {stale && <p role="alert">Configuration changed. Discard this draft and reopen the editor to load the latest revision.</p>}
    <Button type="submit" disabled={busy || stale || !!problems.length}>Save plan</Button>{" "}
    <Button variant="line" onClick={cancel} disabled={busy}>Discard draft</Button>
  </form>;
}

export function RoomOperationsPanel({endpoint,adjudication}:{endpoint:string;adjudication:string}) {
  const [view,setView]=useState<RoomOperations|null>(null);
  const [editor,setEditor]=useState<RoomOperations|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [commandError,setCommandError]=useState("");
  const version=useRef(0);
  const writing=useRef(false);
  const read=useCallback(async()=>{
    if (writing.current) return;
    const ticket=++version.current;
    const result=await api<RoomOperations>(endpoint);
    if (version.current!==ticket) return;
    if (result.ok) {setView(result);setError("");}
    else {setError(result.error);setView(null);if (result.status===401 || result.status===404 || result.status===403) setEditor(null);}
  },[endpoint]);
  useEffect(()=>{
    const initial=setTimeout(()=>void read(),0);
    const invalidate=()=>{version.current++;};
    const timer=setInterval(()=>{if(document.visibilityState==="visible") void read();},15000);
    return ()=>{clearTimeout(initial);clearInterval(timer);invalidate();};
  },[read]);
  const change:Command=async body=>{
    if(writing.current) return false;
    writing.current=true;setBusy(true);setCommandError("");
    const ticket=++version.current;
    try {
      const result=await api<RoomOperations>(endpoint,{body});
      if(ticket!==version.current) return false;
      if(!result.ok) {
        if(result.status===401 || result.status===404 || result.status===403){setView(null);setEditor(null);}
        if(result.status===409) {
          const refreshed=await api<RoomOperations>(endpoint);
          if(ticket!==version.current) return false;
          if(refreshed.ok) setView(refreshed);
          else {setView(null);if([401,403,404].includes(refreshed.status)) setEditor(null);}
        }
        setCommandError(result.error);return false;
      }
      setView(result);setError("");return true;
    } finally {writing.current=false;setBusy(false);}
  };
  return <section className="space-y-5">
    <div className="flex flex-wrap items-center gap-3"><h2 className="text-2xl font-bold">Room operations</h2>
      <Button size="sm" variant="line" disabled={busy} onClick={()=>void read()}>Refresh monitor</Button>
      {view && !editor && <Button size="sm" disabled={view.status==="archived"} onClick={()=>{setEditor(view);setCommandError("");}}>Edit competition plan</Button>}</div>
    {error && <p role="alert">{error}</p>}
    {commandError && <p role="alert">{commandError}</p>}
    {!view && !error && <p>Loading room operations…</p>}
    {editor && <PlanEditor source={editor} stale={!view || view.revision!==editor.revision} busy={busy} save={change} cancel={()=>{setEditor(null);setCommandError("");}}/>}
    {view && <>
      {!view.enabled && <p>Room scoring is disabled. Preparation is available.</p>}
      <p>Tournament status · {view.status}</p>
      {!view.teams.length && <p>Register teams in Teams.</p>}
      {!view.rooms.length && <p>Create a room and assign staff in Rooms.</p>}
      {view.unassigned.map(c=><p key={c.id}>{c.label} · Assign a valid room.</p>)}
      {view.rooms.map(room=><section key={room.id} className="space-y-2 border border-line p-4">
        <h3 className="text-xl font-bold">{room.name}</h3>
        <p>Host · {room.staff.filter(s=>s.role==="room_host").map(s=>s.name).join(", ") || "Assign a host in Rooms"}</p>
        <p>Judges · {room.staff.filter(s=>s.role==="judge").map(s=>s.name).join(", ") || "Assign a judge in Rooms"}</p>
        <p>{room.pending} pending · {room.approved} approved · {room.missing} questions awaiting approved scores · {room.completed} complete</p>
        {!room.contexts.length && <p>{view.pointsFormat?"Configure a round roster.":"Assign a competition fixture in Draw."}</p>}
        {room.contexts.map(c=><article key={c.id} className="border-t border-line py-2"><strong>{c.label}</strong> · {c.completed?"Completed":c.released?"Released":"Upcoming draft"}
          <p>{c.participants.join(", ")}</p>
          {!c.completed && <><p>{c.reasons.length ? c.reasons.join(" ") : "Ready for scoring."}</p>
            <p>Completion · {c.blockers.length ? c.blockers.join(" ") : "Available to the assigned room host."}</p></>}
          {view.enabled && c.completed && <ReopenContext key={c.id} endpoint={endpoint.replace("/api/host/tournaments/","/api/tournaments/").replace(/\/operations$/, "")+"/rooms/"+encodeURIComponent(room.id)+"/reopen"}
            contextId={c.id} label={c.label} refresh={read}/>}
          {c.disputes.map(d=><p key={d.scoreId}>Adjudication · {d.status} · {d.changes.join(", ")}</p>)}
          {view.pointsFormat && !c.completed && <Button size="sm" variant="line" disabled={!!editor || busy || view.status==="archived" || (c.released ? c.hasHistory : !!c.setup.length)}
            onClick={()=>void change({action:c.released?"withdraw":"release",rosterId:c.id,revision:view.revision})}>{c.released?"Withdraw unscored roster":"Release roster"}</Button>}
        </article>)}
      </section>)}
      {view.enabled && <AdjudicationPanel endpoint={adjudication}/>}
    </>}
  </section>;
}
