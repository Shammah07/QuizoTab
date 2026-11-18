"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/quiz/api";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import { formatDateRange, todayStatus, tournamentLabel, type TournamentRow } from "@/lib/tournament/rules";
import { iconButtonClass, LiveDot, panelClass } from "./bits";

// The host's tournaments: open one, or delete one (with a confirmation)

export function TournamentList({ tournaments: initial }: { tournaments: TournamentRow[] }) {
  const router = useRouter();
  const [tournaments, setTournaments] = useState(initial);
  const [deleting, setDeleting] = useState<TournamentRow | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function remove() {
    if (!deleting) return;
    setWorking(true);
    setError("");
    const result = await api(`/api/host/tournaments/${deleting.id}`, { method: "DELETE" });
    setWorking(false);
    if (!result.ok) return setError(result.error);
    setTournaments((list) => list.filter((t) => t.id !== deleting.id));
    setNotice(`${tournamentLabel(deleting)} was deleted.`);
    setDeleting(null);
    router.refresh();
  }

  if (tournaments.length === 0) {
    return (
      <p className={cn(panelClass, "px-5 py-6 text-muted")}>
        No tournaments yet. Press <strong className="text-white">New tournament</strong> to set up your first one.
      </p>
    );
  }

  return (
    <>
      {notice && (
        <Alert type="success" className="mb-4">
          {notice}
        </Alert>
      )}
      <ul className="border-t border-line">
        {tournaments.map((t) => (
          <li key={t.id} className="grid items-center gap-x-4 gap-y-3 border-b border-line py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <LiveDot status={todayStatus({ startDate: t.startDate ?? "", endDate: t.endDate ?? "" })} />
              <h2 className="mt-1 truncate text-lg font-semibold text-white [font-stretch:100%]">{t.name}</h2>
              <p className="text-sm text-muted">
                {[t.category, t.year, formatDateRange(t.startDate ?? "", t.endDate ?? "")].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ButtonLink href={`/host/t/${t.id}`} variant="line" size="sm">
                Audience page
              </ButtonLink>
              <ButtonLink href={`/host/${t.id}`} size="sm">
                Open
              </ButtonLink>
              <button type="button" onClick={() => setDeleting(t)} title="Delete tournament" aria-label={`Delete ${t.name}`} className={cn(iconButtonClass, "hover:text-bad")}>
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Modal open={deleting !== null} onClose={() => !working && setDeleting(null)} title={deleting ? `Delete ${tournamentLabel(deleting)}?` : ""}>
        <p className="text-sm text-muted">This removes the tournament and everything in it: teams, scores, rounds, draws, rooms, judge logins and its public page.</p>
        <p className="mt-2 text-sm font-semibold text-bad">This can&apos;t be undone.</p>
        {error && (
          <Alert type="error" className="mt-4">
            {error}
          </Alert>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="line" size="sm" onClick={() => setDeleting(null)} disabled={working}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={remove} disabled={working}>
            {working ? "Deleting…" : "Yes, delete it"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
