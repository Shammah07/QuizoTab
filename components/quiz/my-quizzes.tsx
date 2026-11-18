"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { api, plural } from "./api";

type Quiz = { id: number; title: string; is_public: boolean; plays: number; count: number };
type Tournament = { id: string; name: string; rounds: Array<{ id: string; label: string }> };

const fieldClass = "h-12 w-full border border-line bg-white/5 px-3 text-base text-text focus:border-live focus:outline-none";

// The list of the host's quizzes, and the "Host live" dialog that starts a game (was the list half of quiz/builder.js)
export function MyQuizzes({ joinLabel }: { joinLabel: string }) {
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<Quiz[] | null>(null);
  const [error, setError] = useState("");

  // The launch dialog
  const [launching, setLaunching] = useState<Quiz | null>(null);
  const [mode, setMode] = useState<"solo" | "tournament">("solo");
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [tournamentId, setTournamentId] = useState("");
  const [roundId, setRoundId] = useState("");
  const [launchError, setLaunchError] = useState("");
  const [opening, setOpening] = useState(false);

  async function load() {
    const result = await api<{ quizzes: Quiz[] }>("/api/quizzes");
    if (!result.ok) return setError(result.error);
    setQuizzes(result.quizzes);
  }

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function remove(quiz: Quiz) {
    if (!confirm(`Delete "${quiz.title}"? This can't be undone.`)) return;
    const result = await api(`/api/quizzes/${quiz.id}`, { method: "DELETE" });
    if (!result.ok) return setError(result.error);
    load();
  }

  function openLaunch(quiz: Quiz) {
    setLaunching(quiz);
    setMode("solo");
    setLaunchError("");
  }

  async function chooseMode(next: "solo" | "tournament") {
    setMode(next);
    if (next !== "tournament" || tournaments) return;
    const result = await api<{ tournaments: Tournament[] }>("/api/host/tournaments");
    const list = result.ok ? result.tournaments : [];
    setTournaments(list);
    setTournamentId(list[0]?.id ?? "");
    setRoundId(list[0]?.rounds[0]?.id ?? "");
  }

  function chooseTournament(id: string) {
    setTournamentId(id);
    setRoundId(tournaments?.find((t) => t.id === id)?.rounds[0]?.id ?? "");
  }

  async function launch() {
    if (!launching) return;
    setLaunchError("");
    const data: Record<string, unknown> = { quiz_id: launching.id };
    if (mode === "tournament") {
      if (!tournamentId) return setLaunchError("Choose a tournament.");
      data.tournament_id = tournamentId;
      data.round_id = roundId;
    }
    setOpening(true);
    const result = await api<{ game_id: number }>("/api/host/games", { body: data });
    if (result.ok) return router.push(`/quiz/host/${result.game_id}`);
    setLaunchError(result.error);
    setOpening(false);
  }

  const rounds = tournaments?.find((t) => t.id === tournamentId)?.rounds ?? [];

  return (
    <>
      {error && (
        <p role="alert" className="mt-6 text-sm text-bad">
          {error}
        </p>
      )}

      {quizzes && quizzes.length === 0 && (
        <p className="mt-8 border border-line bg-panel px-5 py-6 text-muted">
          No quizzes yet. Press <strong className="text-white">New quiz</strong> to build your first one.
        </p>
      )}

      {quizzes && quizzes.length > 0 && (
        <ul className="mt-8 border-t border-line">
          {quizzes.map((quiz) => (
            <li key={quiz.id} className="grid items-center gap-x-4 gap-y-3 border-b border-line py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-white [font-stretch:100%]">
                  <span className="truncate">{quiz.title}</span>
                  {quiz.is_public && <span className="bg-live px-1.5 py-0.5 text-[11px] font-bold text-white">Public</span>}
                </h2>
                <p className="text-sm text-muted">
                  {plural(quiz.count, "question")}
                  {quiz.is_public && `, played ${plural(quiz.plays, "time")}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={`/quiz/${quiz.id}/edit`} variant="line" size="sm">
                  Edit
                </ButtonLink>
                <Button variant="line" size="sm" onClick={() => remove(quiz)}>
                  Delete
                </Button>
                <Button size="sm" onClick={() => openLaunch(quiz)}>
                  Host live
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={launching !== null} onClose={() => setLaunching(null)} title={launching ? `Host ${launching.title}` : ""}>
        <p className="mb-5 text-sm text-muted">
          Open this on the screen everyone can see. Players join at <strong className="text-white">{joinLabel}</strong> with the PIN shown there.
        </p>

        <label className="mb-4 block">
          <span className="mb-1.5 block text-sm font-medium">How will people play?</span>
          <select value={mode} onChange={(e) => chooseMode(e.target.value as "solo" | "tournament")} className={fieldClass}>
            <option value="solo">Everyone plays with their own nickname</option>
            <option value="tournament">As a tournament round: each team plays on one phone</option>
          </select>
        </label>

        {mode === "tournament" && (
          <>
            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm font-medium">Tournament</span>
              <select value={tournamentId} onChange={(e) => chooseTournament(e.target.value)} className={fieldClass} disabled={!tournaments}>
                {!tournaments && <option>Loading your tournaments…</option>}
                {tournaments && tournaments.length === 0 && <option value="">You have no active tournaments yet</option>}
                {tournaments?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm font-medium">Round the scores go to</span>
              <select value={roundId} onChange={(e) => setRoundId(e.target.value)} className={fieldClass}>
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="mb-4 text-sm text-muted">At the end you send the scores to this round. They wait in the Scores tab for your approval, like a judge&apos;s scores.</p>
          </>
        )}

        {launchError && (
          <p role="alert" className="mb-4 text-sm text-bad">
            {launchError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="line" size="sm" onClick={() => setLaunching(null)}>
            Cancel
          </Button>
          <Button size="sm" onClick={launch} disabled={opening}>
            {opening ? "Opening…" : "Open the big screen"}
          </Button>
        </div>
      </Modal>

      {/* The link to the public list sits here too, so a host who only wants to play finds it */}
      <p className="mt-10 text-sm text-muted">
        Want to play on your own?{" "}
        <Link href="/quiz/explore" className="font-semibold text-live hover:underline">
          Browse public quizzes
        </Link>
      </p>
    </>
  );
}
