"use client";
import { useState } from "react";
import type { StaffWorkspace } from "@/lib/tournament/staff-workspace";
type Context = StaffWorkspace["contexts"][number];
export type StaffCommand = (path:string,body:Record<string,unknown>,retryable?:boolean)=>Promise<void>;

export function JudgeQuestionForm({context,history,send,disabled}:{context:Context;history:StaffWorkspace["history"];send:StaffCommand;disabled:boolean}) {
  const [team,setTeam] = useState(context.teams[0]?.id ?? "");
  const [roundId,setRound] = useState(context.rounds[0]?.id ?? "");
  const round = context.rounds.find(r=>r.id===roundId) ?? context.rounds[0];
  const [questionId,setQuestion] = useState("");
  const question = round?.questions.find(q=>q.id===questionId) ?? round?.questions[0];
  const attempts = history.filter(s=>s.contextId===context.id && s.teamId===team && s.roundId===round?.id && s.questionKey===question?.id);
  const pending = attempts.find(s=>s.status==="pending");
  const previous = attempts.find(s=>s.status==="approved") ?? attempts.find(s=>s.status==="rejected");
  const blocked = disabled || !!pending || !context.teams.some(t=>t.id===team) || !question || (context.completed && previous?.status!=="approved");
  return <section className="space-y-3">
    <h2 className="text-xl font-bold">Question scoring</h2>
    <label>Team<select value={team} onChange={e=>setTeam(e.target.value)}>{context.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <label>Round<select value={round?.id ?? ""} onChange={e=>{setRound(e.target.value);setQuestion("");}}>{context.rounds.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    <label>Question<select value={question?.id ?? ""} onChange={e=>setQuestion(e.target.value)}>{round?.questions.map(q=><option key={q.id}>{q.id}</option>)}</select></label>
    {attempts.map(s=><p key={s.id}>Revision {s.revision} · {s.points!==null && s.points+" points · "}{s.status}{s.reason && " · "+s.reason}</p>)}
    {question ? <form key={JSON.stringify([team,round.id,question.id,previous?.id,pending?.id])} className="space-y-3" onSubmit={e=>{
      e.preventDefault();
      if (blocked) return;
      const data = new FormData(e.currentTarget);
      const points = Number(data.get("points"));
      if (previous) void send("corrections",{scoreId:previous.id,points,reason:String(data.get("reason")).trim()},true);
      else void send("scores",{contextId:context.id,teamId:team,roundId:round.id,questionKey:question.id,points},true);
    }}>
      <label>Points ({question.minPoints}–{question.maxPoints})<input type="number" inputMode="numeric" name="points" required step={1}
        min={question.minPoints} max={question.maxPoints} disabled={blocked}/></label>
      {previous && <label>Reason for change<input name="reason" required minLength={3} maxLength={1000} disabled={blocked}/></label>}
      <button disabled={blocked}>{pending ? "Awaiting review" : previous?.status==="approved" ? "Propose correction" : previous ? "Replace rejected score" : "Submit for review"}</button>
    </form> : <p>No configured questions for this context.</p>}
  </section>;
}
