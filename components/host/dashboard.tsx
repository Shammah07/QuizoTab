"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/quiz/api";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import { FORMATS, formatDateRange, formatOf, todayStatus, tournamentSubtitle, tournamentTitle, type Judge, type Pairing, type Room, type Sharing, type TournamentConfig } from "@/lib/tournament/rules";
import type { HostView, ScoreOp } from "@/lib/tournament/store";
import { ConfirmButton, LinkBox, LiveDot, payload, StatCard, Tabs } from "./bits";
import { isDashboardTab, type DashboardTab } from "./dashboard-tabs";
import { AdjudicationPanel } from "./adjudication-panel";
import { JudgesPanel, type JudgeFields } from "./judges-panel";
import { PairingsPanel } from "./pairings-panel";
import { RoomsPanel } from "./rooms-panel";
import { ScoresPanel } from "./scores-panel";
import { SettingsPanel } from "./settings-panel";
import { SharePanel } from "./share-panel";
import { TeamsPanel, type TeamFields } from "./teams-panel";

// The host's dashboard for one tournament (was AdminDashboard in the tournament app).
// It refreshes every few seconds, so scores judges enter and teams they register show up on their own.

const REFRESH_MS = 6000;

type Props = { initial: HostView; initialTab: DashboardTab; audienceUrl: string; judgeUrl: string };

export function Dashboard({ initial, initialTab, audienceUrl, judgeUrl }: Props) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [tab, setTabState] = useState<DashboardTab>(initialTab);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [spinning, setSpinning] = useState(false);
  const id = view.tournament.id;
  const base = `/api/host/tournaments/${id}`;
  const { config, teams, scores } = view;
  const format = formatOf(config);
  const usesDraw = FORMATS[format].hasDraw;
  const status = todayStatus(config);
  const pending = scores.filter((s) => !s.approved).length;

  // The open tab lives in the address, so a reload or a shared link opens the same tab
  const setTab = (next: string) => {
    if (!isDashboardTab(next)) return;
    setTabState(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  };

  const load = useCallback(async () => {
    const result = await api<HostView>(base);
    if (result.ok) setView(payload(result));
    return result.ok ? null : result.error;
  }, [base]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // Saves one or more documents; the answer is the whole fresh view
  async function patch(data: Partial<{ config: TournamentConfig; pairings: Pairing[]; rooms: Room[]; judges: Judge[] }>) {
    const body = data.pairings ? { ...data, expectedPairings: view.pairings } : data;
    const result = await api<HostView>(base, { method: "PATCH", body });
    if (!result.ok) return result.error;
    setView(payload(result));
    return null;
  }

  async function teamsCall(method: string, body: Record<string, unknown>) {
    const result = await api<{ teams: HostView["teams"] }>(`${base}/teams`, { method, body });
    if (!result.ok) return result.error;
    setView((v) => ({ ...v, teams: result.teams }));
    // A removed team takes its scores with it
    if (method === "DELETE") load();
    return null;
  }

  async function scoreOp(op: ScoreOp) {
    const result = await api<{ scores: HostView["scores"] }>(`${base}/scores`, { body: op });
    if (!result.ok) return result.error;
    setView((v) => ({ ...v, scores: result.scores }));
    return null;
  }

  async function addJudge(fields: JudgeFields) {
    const result = await api<{ existing: boolean; judges: Judge[] }>(`${base}/judges`, { body: fields });
    if (!result.ok) return { error: result.error };
    setView((v) => ({ ...v, judges: result.judges }));
    return { existing: result.existing };
  }

  async function removeJudge(judge: Judge) {
    const result = await api<{ judges: Judge[] }>(`${base}/judges`, { method: "DELETE", body: { id: judge.id } });
    if (!result.ok) return result.error;
    await load();
    return null;
  }

  async function sharingCall(body: Record<string, unknown>) {
    const result = await api<{ sharing: Sharing; code: string }>(`${base}/sharing`, { body });
    if (!result.ok) return result.error;
    setView((v) => ({ ...v, sharing: result.sharing, code: result.code }));
    return null;
  }

  async function reset() {
    const result = await api<HostView>(`${base}/reset`, { method: "POST", body: {} });
    if (!result.ok) return setError(result.error);
    setView(payload(result));
  }

  async function remove() {
    setDeleteError("");
    const result = await api(base, { method: "DELETE" });
    if (!result.ok) return setDeleteError(result.error);
    router.push("/host?deleted=1");
  }

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "settings", label: "Settings" },
    { key: "teams", label: "Teams", count: teams.length },
    { key: "scores", label: "Scores", count: pending },
    ...(usesDraw ? [{ key: "draw", label: "Draw" }] : []),
    { key: "rooms", label: "Rooms" },
    { key: "judges", label: "Judges", count: view.judges.length },
    { key: "share", label: "Share" },
  ];
  const shownTab = !usesDraw && tab === "draw" ? "overview" : tab;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <LiveDot status={status} />
          <h1 className="mt-2 text-[clamp(28px,4vw,40px)] leading-[1.05] font-extrabold break-words text-white">{tournamentTitle(view.tournament, config.name)}</h1>
          <p className="mt-2 text-sm text-muted">{[tournamentSubtitle(view.tournament), FORMATS[format].label, formatDateRange(config.startDate, config.endDate)].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={audienceUrl} variant="line" size="sm" target="_blank" rel="noopener">
            Audience page
          </ButtonLink>
          <ButtonLink href={judgeUrl} variant="line" size="sm">
            Judge portal
          </ButtonLink>
          <Button
            variant="ghost"
            size="sm"
            title="Refresh"
            aria-label="Refresh"
            onClick={async () => {
              setSpinning(true);
              const failed = await load();
              setError(failed ?? "");
              window.setTimeout(() => setSpinning(false), 500);
            }}
          >
            <RefreshCw aria-hidden="true" className={cn("size-4", spinning && "animate-spin")} />
          </Button>
        </div>
      </div>

      <Tabs tabs={tabs} active={shownTab} onChange={setTab} label="Tournament sections" />

      {error && (
        <Alert type="error" className="mb-5">
          {error}
        </Alert>
      )}

      {shownTab === "overview" && (
        <div className="flex flex-col gap-6">
          {view.roomAwards && <AdjudicationPanel endpoint={base+"/adjudication"} />}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Teams registered" value={teams.length} />
            <StatCard label="Scores entered" value={scores.length} tone="live" />
            <StatCard label="Awaiting approval" value={pending} tone={pending > 0 ? "amber" : "muted"} />
            <StatCard label="Format" value={FORMATS[format].label} />
            <StatCard label="Rounds" value={config.rounds.length} />
            <StatCard label="Judges" value={view.judges.length} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <LinkBox label="Audience link" href={audienceUrl} hint="Standings and the released draw, open to everyone" />
            <LinkBox label="Judge link" href={judgeUrl} hint="Judges sign in here to register teams and enter scores" />
          </div>

          <p className="text-sm text-muted">
            Start another event?{" "}
            <Link href={`/host/new?copy=${id}`} className="font-semibold text-live hover:underline">
              New tournament with these rules
            </Link>{" "}
            or{" "}
            <Link href="/host" className="font-semibold text-live hover:underline">
              open another tournament
            </Link>
            .
          </p>

          <div className="border border-bad/40 bg-bad/5 p-4">
            <p className="font-semibold text-white">Danger zone</p>
            <p className="mt-1 mb-4 text-sm text-muted">Clearing removes every registered team, score and pairing of this tournament. Settings, rooms, judges and sharing are kept. Deleting removes the whole tournament, its judge logins included. Neither can be undone.</p>
            <div className="flex flex-wrap gap-2">
              <ConfirmButton confirmLabel="Click again to clear teams, scores and the draw" onConfirm={reset}>
                Clear teams, scores and draw
              </ConfirmButton>
              <Button variant="line" size="sm" onClick={() => setDeleting(true)}>
                Delete tournament
              </Button>
            </div>
          </div>
        </div>
      )}

      {shownTab === "settings" && <SettingsPanel key={JSON.stringify(config)} config={config} scores={scores} pairings={view.pairings} onSave={(next) => patch({ config: next })} />}

      {shownTab === "teams" && <TeamsPanel teams={teams} onAdd={(fields: TeamFields) => teamsCall("POST", fields)} onUpdate={(teamId, fields) => teamsCall("PUT", { id: teamId, ...fields })} onDelete={(teamId) => teamsCall("DELETE", { id: teamId })} />}

      {shownTab === "scores" && <ScoresPanel config={config} teams={teams} scores={scores} onChange={scoreOp} />}

      {shownTab === "draw" && usesDraw && <PairingsPanel config={config} teams={teams} scores={view.roomAwards ?? scores.filter(s => s.approved)} fixtureResults={view.fixtureResults} pairings={view.pairings} rooms={view.rooms} judges={view.judges} onPairingsChange={(pairings) => patch({ pairings })} onConfigChange={(next) => patch({ config: next })} />}

      {shownTab === "rooms" && <RoomsPanel endpoint={`${base}/rooms`} judges={view.judges} onSaved={load} />}

      {shownTab === "judges" && <JudgesPanel judges={view.judges} judgeUrl={judgeUrl} onAdd={addJudge} onRemove={removeJudge} />}

      {shownTab === "share" && <SharePanel key={view.code + JSON.stringify(view.sharing)} sharing={view.sharing} code={view.code} audienceUrl={audienceUrl} onSave={(sharing) => sharingCall({ action: "save", ...sharing })} onNewCode={() => sharingCall({ action: "new_code" })} />}

      <Modal open={deleting} onClose={() => setDeleting(false)} title="Delete this tournament?">
        <p className="text-sm text-muted">This removes the tournament and everything in it: teams, scores, rounds, draws, rooms, judge logins and its public page.</p>
        <p className="mt-2 text-sm font-semibold text-bad">This can&apos;t be undone.</p>
        {deleteError && (
          <Alert type="error" className="mt-4">
            {deleteError}
          </Alert>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="line" size="sm" onClick={() => setDeleting(false)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={remove}>
            Yes, delete it
          </Button>
        </div>
      </Modal>
    </div>
  );
}
