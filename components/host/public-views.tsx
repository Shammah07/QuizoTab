"use client";
import { useEffect, useState } from "react";
import type { Section, SpectatorView } from "@/lib/tournament/spectator";
import { spectatorRefresh } from "@/lib/tournament/spectator-refresh";
import { CopyButton, fieldClass, LiveDot, panelClass } from "./bits";

export function Spectator({ initial, accessKey, section, room }: { initial: SpectatorView; accessKey: string; section: Section; room?: string }) {
  const [view,setView] = useState<SpectatorView | null>(initial);
  const [stale,setStale] = useState(false);
  const [search,setSearch] = useState("");
  const [selected,setSelected] = useState(0);
  const base = "/host/t/" + encodeURIComponent(accessKey);
  const query = new URLSearchParams({section, ...(room ? {room} : {})});
  const url = "/api/tournaments/" + encodeURIComponent(accessKey) + "?" + query;
  useEffect(() => {
    const controller = new AbortController();
    const poll = spectatorRefresh<SpectatorView>(() => fetch(url,{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}),
      data => { setView(data); setStale(false); }, () => setStale(true));
    const refresh = () => { if (document.visibilityState === "visible") void poll.refresh(); };
    const timer = window.setInterval(refresh,6000);
    document.addEventListener("visibilitychange",refresh);
    window.addEventListener("pageshow",refresh);
    return () => { poll.cancel(); controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange",refresh); window.removeEventListener("pageshow",refresh); };
  },[url]);
  if (!view) return <p role="status">This tournament view is unavailable.</p>;
  const table = view.tables[selected] ?? view.tables[0];
  const rows = table?.rows.map((r,i) => ({...r,rank:i+1})).filter(r => (r.name+" "+r.schoolOrCategory).toLowerCase().includes(search.toLowerCase())) ?? [];
  return <div className="space-y-5">
    <div className="flex items-center gap-3"><LiveDot status={view.status} /><span className="capitalize">{view.competitionStatus}</span></div>
    <h1 className="text-4xl font-bold">{view.title}{view.room && " · "+view.room}</h1>
    {stale && <p role="status" className="text-amber">Refresh failed. Showing the last available results.</p>}
    {section === "overview" && view.about && <p>{view.about}</p>}
    <nav className="flex flex-wrap gap-4 underline">
      {view.standings && (section !== "standings" || room) && <a href={base+"/standings"}>Tournament standings</a>}
      {view.draw && section !== "draw" && <a href={base+"/draw"}>Released draw</a>}
      {section === "overview" && accessKey.length === 36 && <a href={"/host/"+accessKey+"/judge"}>Judge portal</a>}
    </nav>
    {view.rooms.length > 0 && !room && <nav aria-label="Room standings" className="flex flex-wrap gap-3">
      {view.rooms.map(r => <a className="underline" key={r.id} href={base+"/standings?room="+encodeURIComponent(r.id)}>{r.name}</a>)}
    </nav>}
    {view.contexts.length > 0 && <p>{view.contexts.join(" · ")}</p>}
    {section === "standings" && <>
      <p>Last official score update · {view.updatedAt ? new Date(view.updatedAt).toISOString().replace("T"," ").replace(/\.\d+Z$/," UTC") : "Unavailable"}</p>
      <input aria-label="Search teams" placeholder="Search teams or schools" className={fieldClass} value={search} onChange={e => setSearch(e.target.value)} />
      {view.tables.length > 1 && <div className="flex gap-4">{view.tables.map((t,i) => <button key={t.label} aria-pressed={selected===i} onClick={() => setSelected(i)}>{t.label}</button>)}</div>}
      <ol className="space-y-2">{rows.map(r => <li key={r.rank} className={panelClass}><details className="p-3"><summary>{r.rank}. {r.name} {r.schoolOrCategory && " · "+r.schoolOrCategory} · {r.total} points</summary>
        {r.rounds.map((round,i) => <p key={i}>{round.name} · {round.points ?? "—"}</p>)}</details></li>)}</ol>
      {rows.length ? <CopyButton label="Copy standings" text={[view.title,...rows.map(r => r.rank+". "+r.name+" · "+r.total)].join("\n")} /> : <p>No teams to show.</p>}
    </>}
    {section === "draw" && !view.fixtures.length && <p>The host has not released a draw yet.</p>}
    {view.fixtures.map((f,i) => <article key={i} className={panelClass}><div className="p-3"><h2>{f.stage} · {f.label}</h2><p>{f.a ?? "Bye"} vs {f.b ?? "Bye"}</p>
      {f.room && <p>{f.room}</p>}{f.winner && <p>Winner · {f.winner}</p>}</div></article>)}
  </div>;
}
