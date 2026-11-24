"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api as request } from "@/components/quiz/api";
import type { StaffWorkspace } from "@/lib/tournament/staff-workspace";
import type { pendingRoomScores } from "@/lib/tournament/score-review";
import type { completionPreview } from "@/lib/tournament/fixture-lifecycle";
import { JudgeQuestionForm, type StaffCommand } from "./judge-question-form";
import { scoreRequest, StaffRequests } from "./staff-requests";

type Queue = Awaited<ReturnType<typeof pendingRoomScores>>;
type Preview = Awaited<ReturnType<typeof completionPreview>>;
type View = {room:StaffWorkspace;queue:Queue;preview:Preview|null;contextId:string};

function api<T extends object>(path: string, options: {body?: unknown} = {}) {
  return request<T>(path, {...options, signal: AbortSignal.timeout(15000)});
}

export function RoomWorkspace({base,role,userId}:{base:string;role:"judge"|"room_host";userId:number}) {
  const [selection,select] = useState("");
  const [view,setView] = useState<View|null>(null);
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [requests] = useState(()=>new StaffRequests());
  const mounted = useRef(false);
  const refresh = useCallback(async ()=>{
    const current = requests.read();
    const valid = ()=>mounted.current && current();
    function fail(reason:string) { if (valid()) {setView(null);setError(reason);} }
    const room = await api<StaffWorkspace>(base+"/workspace?role="+role);
    if (!valid()) return;
    if (!room.ok) return fail(room.error);
    if (room.userId!==userId) return fail("Account changed. Open your room assignments again.");
    const contextId = room.contexts.find(c=>c.id===selection)?.id ?? room.contexts[0]?.id ?? "";
    let queue:Queue = [];
    let preview:Preview|null = null;
    if (role==="room_host") {
      const [pending,completion] = await Promise.all([
        api<{scores:Queue}>(base+"/scores/pending"),
        contextId ? api<Preview>(base+"/completion?preview=1&contextId="+encodeURIComponent(contextId)) : null,
      ]);
      if (!valid()) return;
      if (!pending.ok) return fail(pending.error);
      if (completion && !completion.ok) return fail(completion.error);
      queue = pending.scores;
      preview = completion;
    }
    if (valid()) {setError("");setView({room,queue,preview,contextId});}
  },[base,role,userId,selection,requests]);
  useEffect(()=>{
    mounted.current = true;
    let alive = true;
    let timer:ReturnType<typeof setTimeout>;
    async function tick() {
      if (!requests.busy && document.visibilityState==="visible") await refresh();
      if (alive) timer = setTimeout(tick,12000);
    }
    function wake() { if (!requests.busy && document.visibilityState==="visible") void refresh(); }
    function hide() { if (document.hidden) { requests.invalidate();setView(null); } else wake(); }
    function leave() { requests.invalidate();setView(null); }
    void tick();
    window.addEventListener("online",wake);
    window.addEventListener("pageshow",wake);
    window.addEventListener("pagehide",leave);
    document.addEventListener("visibilitychange",hide);
    return ()=>{alive=false;mounted.current=false;requests.invalidate();clearTimeout(timer);
      window.removeEventListener("online",wake);window.removeEventListener("pageshow",wake);
      window.removeEventListener("pagehide",leave);document.removeEventListener("visibilitychange",hide);};
  },[refresh,requests]);
  const send:StaffCommand = async(path,body,retryable=false)=>{
    if (!requests.begin()) return;
    setBusy(true);setMessage("");
    let dispatched = false;
    try {
      const token = retryable ? await scoreRequest(sessionStorage,userId+"/"+base,path,body) : null;
      dispatched = true;
      const result = await api(base+"/"+path,{body:token ? {...body,clientRequestId:token.requestId} : body});
      if (!mounted.current) return;
      if (!result.ok && (result.status===401 || result.status===403)) setView(null);
      if (result.ok && token) sessionStorage.removeItem(token.key);
      let notice = result.ok ? "Saved." : result.error;
      if (!result.ok && (result.status===0 || result.status>=500)) {
        notice = token ? "Confirmation unavailable. Refresh and check score history. If missing, retry the same details in this tab."
          : "Confirmation unavailable. Refresh the queue and fixture status before taking another action.";
      }
      await refresh();
      if (mounted.current) setMessage(notice);
    } catch {
      if (mounted.current) setMessage(dispatched ? "Refresh the room and check the recorded result before taking another action."
        : "Nothing sent. Check that tab storage is available and try again.");
    } finally {requests.finish();if (mounted.current) setBusy(false);}
  };
  const c = view?.room.contexts.find(c=>c.id===view.contextId);
  const preview = view?.preview;
  const coverage = preview?.coverage;
  return <div className="space-y-5 [&_label]:block [&_select]:block [&_select]:w-full [&_input]:block [&_input]:w-full [&_input]:rounded [&_input]:border [&_input]:p-2 [&_select]:rounded [&_select]:p-2 [&_select]:bg-white [&_select]:text-black [&_button]:rounded [&_button]:border [&_button]:px-4 [&_button]:py-2 [&_button:disabled]:opacity-50">
    <h1 className="text-3xl font-bold">{view?.room.room ?? "Room workspace"}</h1>
    {view && <p>{view.room.tournament} · {role==="judge" ? "Judge" : "Room host"} · {view.room.status}</p>}
    <button type="button" disabled={busy} onClick={()=>void refresh()}>Refresh room</button>
    <div role="status">{busy ? "Saving and checking server state…" : message}</div>
    {error && <p role="alert">{error}</p>}
    {!view && !error && <p>Loading assigned room…</p>}
    {view && <>
      {view.room.contexts.length ? <label>Released competition<select value={view.contextId} disabled={busy} onChange={e=>{requests.invalidate();select(e.target.value);setView(null);setMessage("");}}>
        {view.room.contexts.map(x=><option key={x.id} value={x.id}>{x.label} · {x.teams.map(t=>t.name).join(" / ")}{x.completed ? " · Complete" : ""}</option>)}</select></label>
        : <p>No competition has been released to this room.</p>}
      {role==="judge" && c && <JudgeQuestionForm key={c.id} context={c} history={view.room.history} send={send} disabled={busy || view.room.status!=="active"}/>}
      {role==="room_host" && <>
        <h2 className="text-xl font-bold">Pending room reviews</h2>
        {!view.queue.length && <p>The review queue is empty.</p>}
        {view.queue.map(s=><form key={s.scoreId} className="space-y-2 rounded border border-line p-4" onSubmit={e=>{
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const decision = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
          if (decision==="approve" || decision==="reject") void send("decisions",{scoreId:s.scoreId,decision,...(decision==="reject" ? {reason:data.get("reason")} : {})});
        }}>
          <strong>{s.teamName} · {s.contextName}</strong><p>{s.judgeName} · {s.roundName} · {s.questionKey}</p>
          <p>{s.correctionOf ? "Revision: "+s.previousPoints+" → "+s.points+" points · "+s.reason : s.points+" points"}</p>
          {s.adjudication?.approval && <p role="status">{s.adjudication.rejection ? "Pending administrator adjudication. Refresh after the ruling." : "Approval is blocked by the protected result. Consult the administrator before continuing review."}</p>}
          <fieldset disabled={busy || s.judgeUserId===userId || view.room.status!=="active"} className="space-y-2">
            <label>Reason for rejection<input name="reason" minLength={3} maxLength={1000} required/></label>
            <button type="submit" value="approve" disabled={s.adjudication?.approval} formNoValidate>Approve</button> <button type="submit" value="reject" disabled={s.adjudication?.rejection}>Reject</button>
          </fieldset>{s.judgeUserId===userId && <p>Another room host must review this score.</p>}
        </form>)}
        {view.room.standings.map(table=><section key={table.label}><h2 className="text-xl font-bold">{table.label}</h2><ol>{table.rows.map(t=><li key={t.id}>{t.name} · {t.total} points</li>)}</ol></section>)}
        {c && preview && coverage && <section className="space-y-2"><h2 className="text-xl font-bold">Fixture completion</h2>
          <p>{preview.completed ? "Complete" : "Open"} · {coverage.approved}/{coverage.required} required answers approved</p>
          <p>{coverage.pendingScores} pending original submissions · {coverage.pendingRevisions} pending revisions</p>
          {coverage.missingCount>0 && <details><summary>{coverage.missingCount} missing answers{coverage.missingCount>40 && " (first 40 shown)"}</summary><ul>{coverage.missing.map((m,i)=><li key={i}>{m}</li>)}</ul></details>}
          {preview.blocker && <p>{preview.blocker}</p>}
          <button disabled={busy || !!preview.blocker} onClick={()=>void send("completion",{contextId:c.id,configRevision:preview.configRevision,lifecycleRevision:preview.lifecycleRevision})}>Complete {c.label}</button>
        </section>}
      </>}
    </>}
  </div>;
}
