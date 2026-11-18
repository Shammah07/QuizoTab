"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/site/logo";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { QuizQuestion } from "@/lib/db/schema";
import { api, plural, reducedMotion, serverClock } from "./api";
import { Score } from "./count-up";
import { MediaView } from "./media";
import { ANSWER_STYLES, Shape } from "./shapes";

// The big screen. It drives the game: opens each question, reveals the answer when time is up
// (or everyone has answered), then shows the leaderboard and moves on. (Was quiz/host.js.)

type Status = "lobby" | "question" | "reveal" | "leaderboard" | "finished";
type Rank = { rank: number; name: string; score: number; gained: number };
type View = {
  id: number;
  pin: string;
  status: Status;
  version: number;
  title: string;
  index: number;
  total: number;
  players: Array<{ id: number; name: string; score: number }>;
  tournament: { label: string; sent: boolean } | null;
  question?: QuizQuestion;
  counts?: number[];
  answered?: number;
  opens_in_ms?: number;
  remaining_ms?: number;
  leaderboard: Rank[];
};

const REVEAL_SECONDS = 6;
const BOARD_SECONDS = 6;
const CIRCUMFERENCE = 2 * Math.PI * 48;

export function BigScreen({ gameId, joinUrl, joinLabel }: { gameId: number; joinUrl: string; joinLabel: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(true);
  // Updated a few times a second while a question is open, so the clock moves
  const [timing, setTiming] = useState({ waiting: 0, left: 0 });

  const busy = useRef(false);
  const opens = useRef<() => number>(() => 0);
  const clock = useRef<() => number>(() => 0);
  const revealAsked = useRef("");
  const lastPoll = useRef(0);

  const apply = useCallback((next: View) => {
    if (next.question) {
      opens.current = serverClock(next.opens_in_ms ?? 0);
      clock.current = serverClock(next.remaining_ms ?? 0);
      setTiming({ waiting: Math.max(0, next.opens_in_ms ?? 0), left: Math.max(0, next.remaining_ms ?? 0) });
    }
    setView(next);
  }, []);

  const refresh = useCallback(async () => {
    const result = await api<View>(`/api/host/games/${gameId}`);
    if (result.ok) apply(result);
    else if (result.status === 404 || result.status === 401) setError(result.error);
  }, [gameId, apply]);

  const advance = useCallback(
    async (to: "start" | "reveal" | "next" | "end") => {
      if (busy.current) return;
      busy.current = true;
      const result = await api<View>(`/api/host/games/${gameId}/advance`, { body: { to } });
      busy.current = false;
      if (result.ok) apply(result);
    },
    [gameId, apply],
  );

  // Answer counts come in fast during a question and names during the lobby; otherwise a slower check is enough
  useEffect(() => {
    const first = window.setTimeout(refresh, 0);
    const timer = window.setInterval(() => {
      const gap = !view || view.status === "question" || view.status === "lobby" ? 1000 : 4000;
      if (Date.now() - lastPoll.current < gap) return;
      lastPoll.current = Date.now();
      refresh();
    }, 250);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [refresh, view]);

  // The clock between server updates. Time's up, or every player has answered: show the answer.
  const phase = view ? `${view.status}:${view.index}` : "";
  useEffect(() => {
    if (!view || view.status !== "question") return;
    const timer = window.setInterval(() => {
      setTiming({ waiting: opens.current(), left: clock.current() });
      if (opens.current() > 0) return;
      const everyone = view.players.length > 0 && (view.answered ?? 0) >= view.players.length;
      if ((clock.current() <= 0 || everyone) && revealAsked.current !== phase) {
        revealAsked.current = phase;
        advance("reveal");
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [view, phase, advance]);

  // Moving on by itself after the reveal and the leaderboard. Keyed on the phase, not the whole view,
  // so the regular polling (which replaces the view) doesn't restart the countdown.
  useEffect(() => {
    if (!auto) return;
    const status = phase.split(":")[0];
    const seconds = status === "reveal" ? REVEAL_SECONDS : status === "leaderboard" ? BOARD_SECONDS : 0;
    if (!seconds) return;
    const timer = window.setTimeout(() => advance("next"), seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [auto, phase, advance]);

  async function kick(player: { id: number; name: string }) {
    if (!confirm(`Remove ${player.name} from the game?`)) return;
    const result = await api<View>(`/api/host/games/${gameId}/kick`, { body: { player_id: player.id } });
    if (result.ok) apply(result);
  }

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }

  const last = view ? view.index >= view.total - 1 : false;
  const nextLabel = !view ? "" : view.status === "question" ? "Skip to answer" : view.status === "reveal" && !last ? "Show leaderboard" : last ? "Final results" : "Next question";

  return (
    <div className="flex min-h-dvh flex-col bg-studio">
      <div className="flex items-center gap-4 border-b border-line px-6 py-3">
        <Logo className="text-[22px]" />
        <span className="min-w-0 flex-1 truncate text-sm text-muted">{view && (view.tournament ? `${view.title}: ${view.tournament.label}` : view.title)}</span>
        {view && view.status !== "lobby" && view.status !== "finished" && (
          <span className="text-sm text-muted">
            Join at {joinLabel} with PIN <strong className="wide font-display text-lg text-amber">{view.pin}</strong>
          </span>
        )}
      </div>

      <main className="flex flex-1 flex-col px-6 py-6 lg:px-10" aria-live="polite">
        {error && <p className="text-bad">{error}</p>}
        {!view && !error && <p className="text-muted">Loading the game…</p>}
        {view?.status === "lobby" && <Lobby view={view} joinUrl={joinUrl} joinLabel={joinLabel} onStart={() => advance("start")} onKick={kick} />}
        {view && (view.status === "question" || view.status === "reveal") && view.question && (
          <Question view={view} question={view.question} revealed={view.status === "reveal"} waiting={timing.waiting} left={timing.left} />
        )}
        {view?.status === "leaderboard" && <Board view={view} />}
        {view?.status === "finished" && <Podium view={view} gameId={gameId} onSent={apply} />}
      </main>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="size-4 accent-live" />
          Move on automatically
        </label>
        <span className="flex-1" />
        <Button variant="line" size="sm" onClick={fullscreen}>
          Full screen
        </Button>
        {view && view.status !== "finished" && (
          <Button
            variant="line"
            size="sm"
            onClick={() => {
              if (confirm("End the game now and show the final results?")) advance("end");
            }}
          >
            End game
          </Button>
        )}
        {view && ["question", "reveal", "leaderboard"].includes(view.status) && (
          <Button size="sm" onClick={() => advance(view.status === "question" ? "reveal" : "next")}>
            {nextLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------- Screens ---------- */

function Lobby({ view, joinUrl, joinLabel, onStart, onKick }: { view: View; joinUrl: string; joinLabel: string; onStart: () => void; onKick: (player: { id: number; name: string }) => void }) {
  const word = view.tournament ? (view.players.length === 1 ? "team" : "teams") : view.players.length === 1 ? "player" : "players";
  return (
    <div className="grid flex-1 items-center gap-10 lg:grid-cols-[1.2fr_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="text-lg text-muted">
          Join on your phone at <strong className="text-white">{joinLabel}</strong>, or use Join on QuizoTab
        </p>
        <p className="wide mt-4 font-display text-[clamp(64px,10vw,150px)] leading-none font-extrabold tracking-wider text-amber tabular-nums" aria-label={`Game PIN ${view.pin.split("").join(" ")}`}>
          {view.pin}
        </p>
        <Button size="lg" className="mt-6" onClick={onStart} disabled={view.players.length === 0}>
          Start the quiz
        </Button>
        <p className="mt-8 text-lg">
          <strong className="wide font-display text-3xl text-white">{view.players.length}</strong> <span className="text-muted">{word} in</span>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[...view.players].reverse().map((p) => (
            <button key={p.id} type="button" title="Remove from the game" onClick={() => onKick(p)} className="cursor-pointer border border-line bg-panel px-3 py-1.5 text-sm font-medium transition-colors hover:border-bad hover:text-bad">
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="border border-line bg-panel p-8">
        <p className="text-sm text-muted">Players open this address on their phones and type the PIN</p>
        <p className="wide mt-3 font-display text-[clamp(20px,2vw,28px)] leading-tight font-extrabold break-words text-white">{joinLabel}</p>
        <p className="mt-6 text-sm text-muted">Or share the link with the PIN already filled in:</p>
        <p className="mt-1 break-words text-live">{`${joinUrl}?pin=${view.pin}`}</p>
      </div>
    </div>
  );
}

function Question({ view, question, revealed, waiting, left }: { view: View; question: QuizQuestion; revealed: boolean; waiting: number; left: number }) {
  const counts = view.counts ?? [];
  const most = Math.max(1, ...counts);
  const total = question.time * 1000;
  const pointsNote = question.points === 2 ? ", double points" : question.points === 0 ? ", no points" : "";

  if (!revealed && waiting > 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-lg text-muted">
          Question {view.index + 1} of {view.total}
          {pointsNote}
        </p>
        <p className="mt-4 max-w-[26ch] text-[clamp(28px,4vw,56px)] leading-tight font-extrabold text-white">{question.text}</p>
        <span className="wide mt-8 font-display text-[clamp(80px,14vw,160px)] leading-none font-extrabold text-amber">{Math.ceil(waiting / 1000)}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="grid items-center gap-6 md:grid-cols-[110px_minmax(0,1fr)_auto]">
        {revealed ? (
          <span className="hidden md:block" />
        ) : (
          <div className={cn("relative size-[110px]", left < 5000 && "text-bad")}>
            <svg viewBox="0 0 110 110" aria-hidden="true" className="size-full -rotate-90">
              <circle cx="55" cy="55" r="48" className="fill-none stroke-white/10" strokeWidth="8" />
              <circle cx="55" cy="55" r="48" className="fill-none stroke-current text-amber" strokeWidth="8" strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - left / total)} style={{ color: left < 5000 ? "var(--color-bad)" : undefined }} />
            </svg>
            <span className="wide absolute inset-0 grid place-items-center font-display text-4xl font-extrabold text-white tabular-nums">{Math.ceil(left / 1000)}</span>
          </div>
        )}
        <div>
          <p className="text-sm text-muted">
            Question {view.index + 1} of {view.total}
          </p>
          <p className="mt-1 text-[clamp(24px,3.2vw,44px)] leading-tight font-extrabold text-white">{question.text}</p>
        </div>
        <p className="text-right text-muted">
          <strong className="wide block font-display text-4xl font-extrabold text-white">{view.answered ?? 0}</strong>answered
        </p>
      </div>

      <MediaView media={question.media} className={cn("mx-auto mt-6 w-full", revealed ? "max-w-sm" : "max-w-3xl")} autoPlay />

      <div className={cn("mt-6 grid flex-1 gap-4", question.answers.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-2")}>
        {question.answers.map((text, i) => {
          const right = revealed && i === question.correct;
          return (
            <div key={i} className={cn("relative flex min-h-[120px] items-center gap-4 overflow-hidden px-6 py-5 text-[clamp(18px,2.2vw,30px)] font-bold", ANSWER_STYLES[i], revealed && !right && "opacity-40")}>
              {revealed && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 bg-black/25 transition-[height] duration-700" style={{ height: `${((counts[i] ?? 0) / most) * 100}%` }} />}
              {right ? <Check aria-label="Right answer" className="relative size-9 shrink-0" strokeWidth={3} /> : <Shape index={i} className="relative size-9" />}
              <span className="relative">{text}</span>
              {revealed && <span className="wide relative ml-auto font-display text-4xl font-extrabold tabular-nums">{counts[i] ?? 0}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Board({ view }: { view: View }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <h2 className="text-center text-[clamp(32px,4vw,52px)] font-extrabold text-white">Leaderboard</h2>
      <ol className="mt-8 border-t border-line">
        {view.leaderboard.map((r) => (
          <li key={r.name} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-4 border-b border-line py-4 text-xl">
            <span className={cn("wide font-display text-2xl font-extrabold", r.rank === 1 ? "text-amber" : "text-muted")}>{r.rank}</span>
            <span className="truncate font-semibold text-white">{r.name}</span>
            <span className="wide font-display text-2xl font-extrabold text-white">
              <Score key={view.index} score={r.score} gained={r.gained} showGain={view.index > 0} delay={500} />
            </span>
          </li>
        ))}
      </ol>
      {view.leaderboard.length === 0 && <p className="mt-6 text-center text-muted">Nobody has scored yet.</p>}
    </div>
  );
}

function Podium({ view, gameId, onSent }: { view: View; gameId: number; onSent: (view: View) => void }) {
  const top = view.leaderboard.slice(0, 3);
  const rest = view.leaderboard.slice(3);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const order = [1, 0, 2]; // second, first, third: the winner stands in the middle
  const heights = ["h-40", "h-28", "h-20"];

  async function send() {
    setSending(true);
    setSendError("");
    const result = await api<View>(`/api/host/games/${gameId}/send-scores`, { body: {} });
    setSending(false);
    if (result.ok) return onSent(result);
    setSendError(result.error);
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Confetti on={top.length > 0} />
      <h2 className="text-center text-[clamp(32px,4.5vw,60px)] font-extrabold text-white">{top.length ? `${top[0].name} wins!` : "Game over"}</h2>

      <div className="mt-10 grid grid-cols-3 items-end gap-3">
        {order.map((i) => {
          const r = top[i];
          if (!r) return <span key={i} />;
          return (
            <div key={r.name} className="text-center">
              <p className="truncate text-lg font-semibold text-white">{r.name}</p>
              <p className="text-muted">
                <Score key={view.index} score={r.score} gained={r.gained} showGain={view.index > 0} delay={1600} /> points
              </p>
              <div className={cn("wide mt-3 grid place-items-center font-display text-5xl font-extrabold", heights[i], i === 0 ? "bg-amber text-studio" : i === 1 ? "bg-panel-2 text-white" : "bg-panel text-white")}>{i + 1}</div>
            </div>
          );
        })}
      </div>

      {rest.length > 0 && (
        <ol className="mt-8 grid gap-x-8 border-t border-line sm:grid-cols-2">
          {rest.map((r) => (
            <li key={r.name} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-2.5">
              <span className="wide font-display font-extrabold text-muted">{r.rank}</span>
              <span className="truncate">{r.name}</span>
              <span className="wide font-display font-extrabold text-white">
                <Score key={view.index} score={r.score} gained={r.gained} showGain={view.index > 0} delay={1600} />
              </span>
            </li>
          ))}
        </ol>
      )}

      {view.tournament && (
        <div className="mt-8 border border-line bg-panel p-5">
          {view.tournament.sent ? (
            <p>
              Scores sent to <strong className="text-white">{view.tournament.label}</strong>. Approve them in the tournament&apos;s Scores tab.
            </p>
          ) : (
            <>
              <p className="text-muted">
                Each team&apos;s score is turned into points out of the round&apos;s maximum and sent to <strong className="text-white">{view.tournament.label}</strong>, waiting for your approval.
              </p>
              <Button className="mt-4" onClick={send} disabled={sending}>
                {sending ? "Sending…" : "Send scores to the tournament"}
              </Button>
              {sendError && (
                <p role="alert" className="mt-3 text-sm text-bad">
                  {sendError}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <p className="mt-8 text-center">
        <ButtonLink href="/quiz" variant="line" size="sm">
          Back to my quizzes
        </ButtonLink>
        <Link href="/quiz" className="sr-only">
          My quizzes
        </Link>
      </p>
    </div>
  );
}

// A moment of confetti over the podium
function Confetti({ on }: { on: boolean }) {
  const [pieces, setPieces] = useState<Array<{ left: number; color: string; duration: number; delay: number }>>([]);
  useEffect(() => {
    if (!on || reducedMotion()) return;
    const colors = ["#2f6bff", "#ffb300", "#2ee6a6", "#ff3b5c", "#ffffff"];
    const show = window.setTimeout(() => {
      setPieces(Array.from({ length: 80 }, () => ({ left: Math.random() * 100, color: colors[Math.floor(Math.random() * colors.length)], duration: 2.5 + Math.random() * 2.5, delay: 1.2 + Math.random() * 1.5 })));
    }, 0);
    const hide = window.setTimeout(() => setPieces([]), 8000);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [on]);
  if (pieces.length === 0) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-10 overflow-hidden">
      {pieces.map((p, i) => (
        <i key={i} className="absolute -top-4 block h-4 w-2.5 animate-[confetti_linear_forwards]" style={{ left: `${p.left}%`, background: p.color, animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s` }} />
      ))}
    </div>
  );
}

export const playersWord = plural;
