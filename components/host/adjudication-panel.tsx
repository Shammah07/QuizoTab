"use client";

import { useCallback, useEffect, useState } from "react";
import type { disputes } from "@/lib/tournament/adjudication";
import { api } from "@/components/quiz/api";

type Case = Awaited<ReturnType<typeof disputes>>[number];
type History = {contextId:string;roomId:string;scoreId:string; action:string; reason:string; at:string; actor:number};

export function AdjudicationPanel({endpoint}:{endpoint:string}) {
  const [cases,setCases] = useState<Case[]>([]);
  const [history,setHistory] = useState<History[]>([]);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const result = await api<{cases:Case[];history:History[]}>(endpoint);
    setCases(result.ok ? result.cases : []);
    setHistory(result.ok ? result.history : []);
    setError(result.ok ? "" : result.error);
  },[endpoint]);
  useEffect(() => {
    let mounted = true;
    void api<{cases:Case[];history:History[]}>(endpoint).then(result => {
      if (!mounted) return;
      setCases(result.ok ? result.cases : []);
      setHistory(result.ok ? result.history : []);
      setError(result.ok ? "" : result.error);
    });
    return () => { mounted = false; };
  },[endpoint]);
  async function rule(c:Case,form:FormData) {
    setBusy(true);
    const result = await api(endpoint,{body:{scoreId:c.scoreId,version:c.version,action:form.get("action"),
      reason:form.get("reason"),requestId:crypto.randomUUID()}});
    await refresh();
    if (!result.ok) setError(result.error);
    setBusy(false);
  }
  return <section className="space-y-3 border border-line p-4">
    <h2 className="font-bold">Score adjudication</h2>
    <button type="button" className="underline" disabled={busy} onClick={refresh}>Refresh disputes</button>
    {error && <p role="alert">{error}</p>}
    {!error && !cases.length && <p>No pending disputes.</p>}
    {cases.map(c => <form key={c.version} className="space-y-2 border-t border-line pt-3" onSubmit={e => {
      e.preventDefault(); void rule(c,new FormData(e.currentTarget));
    }}>
      <h3>{c.fixture} · {c.team} · {c.previous} → {c.proposed} points</h3>
      <p>{c.changes.join(", ")}{c.last && " · Last ruling: "+c.last.action}</p>
      {c.changes.includes("winner") && <p>Winner · {c.previousWinner ?? "Undecided"} → {c.proposedWinner ?? "Undecided"}</p>}
      <ul>{c.dependent.map(p => <li key={p.id}>{p.matchLabel || p.stage} · {p.teamA ?? "Bye"} / {p.teamB ?? "Bye"} · {p.scored ? "Scoring history" : p.released ? "Released" : "Draft"}</li>)}</ul>
      {!c.dependent.length && c.finalized && <p>Reopen this result in <a className="underline" href="?tab=operations">Room operations</a> before accepting a change to its outcome.</p>}
      {c.last?.action === "uphold" ? <p>The assigned room host must reject the proposal to finish review.</p> :
        <><label>Ruling <select name="action">
          {c.last?.action === "hold" ? <option value="resume">Lift hold</option> : <option value="hold">Hold for review</option>}
          <option value="uphold">Uphold the recorded result</option>
          {c.dependent.length > 0 && c.dependent.every(p => !p.scored && !p.released) && <option value="withdraw">Withdraw listed drafts</option>}
        </select></label>
        <label>Reason <input name="reason" minLength={3} maxLength={1000} required /></label>
        <button disabled={busy} className="underline">Record ruling</button></>}
    </form>)}
    {history.length > 0 && <details><summary>Ruling history</summary><ol>{history.map(h => <li key={h.scoreId+h.at}>{h.at} · {h.roomId} / {h.contextId} · account {h.actor} · {h.action} · {h.reason}</li>)}</ol></details>}
  </section>;
}
