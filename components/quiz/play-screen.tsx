"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { GameTeam } from "@/lib/db/schema";
import { AnswerButtons, TimeBar } from "./answer-buttons";
import { api, ordinal, serverClock, storage } from "./api";
import { Score } from "./count-up";
import { MeBadge, Message, PhoneFrame } from "./frame";
import { MediaView } from "./media";

// A player's phone: join with the PIN, answer each question, see how you did (was play/play.js)

type Rank = { rank: number; name: string; score: number; gained: number };
type Question = { text: string; answers: string[]; time: number; points: number; media: { type: "image" | "video"; src: string } | null };
type View =
  | { status: "kicked" }
  | {
      status: "lobby" | "question" | "reveal" | "leaderboard" | "finished";
      title: string;
      index: number;
      total: number;
      you: { name: string; score: number; rank: number; streak: number; of: number; gained?: number };
      question?: Question;
      opens_in_ms?: number;
      remaining_ms?: number;
      answered?: number | null;
      correct?: number;
      result?: { correct: boolean; points: number } | null;
      leaderboard?: Rank[];
    };
type Lookup = { title: string; teams: GameTeam[] | null; started: boolean };

const inputClass = "h-12 w-full border border-line bg-white/5 px-3 text-base text-text focus:border-live focus:outline-none";

export function PlayScreen({ pin: initialPin }: { pin: string }) {
  const [pin, setPin] = useState(initialPin);
  const [game, setGame] = useState<Lookup | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The answer pressed, remembered with the question it was for, so a new question starts clean
  const [pick, setPick] = useState<{ key: string; choice: number } | null>(null);
  const [timing, setTiming] = useState({ waiting: 0, left: 0 });
  const opens = useRef<() => number>(() => 0);
  const clock = useRef<() => number>(() => 0);
  const checked = useRef(false);

  const apply = useCallback((next: View) => {
    if ("question" in next && next.question) {
      opens.current = serverClock(next.opens_in_ms ?? 0);
      clock.current = serverClock(next.remaining_ms ?? 0);
      setTiming({ waiting: Math.max(0, next.opens_in_ms ?? 0), left: Math.max(0, next.remaining_ms ?? 0) });
    }
    setView(next);
  }, []);

  const refresh = useCallback(
    async (t: string) => {
      const result = await api<View>("/api/games/state", { body: { token: t } });
      if (result.ok) return apply(result);
      if (result.status === 401) {
        storage.set(`quizotab-play-${pin}`, null);
        apply({ status: "kicked" });
      }
    },
    [apply, pin],
  );

  // A phone that was already in this game (the page was reloaded) goes straight back in
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    (async () => {
      const saved = initialPin ? storage.get(`quizotab-play-${initialPin}`) : null;
      if (saved) {
        const result = await api<View>("/api/games/state", { body: { token: saved } });
        if (result.ok && result.status !== "finished") {
          setToken(saved);
          apply(result);
          return;
        }
        storage.set(`quizotab-play-${initialPin}`, null);
      }
      if (initialPin) lookup(initialPin);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While in a game: check every few seconds, and move the clock between checks
  useEffect(() => {
    if (!token) return;
    const first = window.setTimeout(() => refresh(token), 0);
    const poll = window.setInterval(() => !document.hidden && refresh(token), 3000);
    const tick = window.setInterval(() => setTiming({ waiting: opens.current(), left: clock.current() }), 150);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [token, refresh]);

  const questionKey = view && "index" in view ? `${view.status}:${view.index}` : "";
  const picked = pick && pick.key === questionKey ? pick.choice : null;

  async function lookup(code: string) {
    setError("");
    if (code.length !== 6) return setError("The PIN has 6 digits.");
    setBusy(true);
    const result = await api<Lookup>("/api/games/lookup", { body: { pin: code } });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setPin(code);
    history.replaceState(null, "", `?pin=${code}`);
    setGame(result);
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    const result = await api<{ token: string }>("/api/games/join", { body: { pin, nickname: form.get("nick") ?? "", team_id: form.get("team") ?? "" } });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    storage.set(`quizotab-play-${pin}`, result.token);
    setToken(result.token);
  }

  async function answer(choice: number) {
    if (!token || !view || view.status !== "question" || picked !== null) return;
    setPick({ key: questionKey, choice });
    navigator.vibrate?.(30);
    const result = await api<View>("/api/games/answer", { body: { token, index: view.index, choice } });
    if (result.ok) return apply(result);
    setPick(null);
    setError(result.error);
    refresh(token);
  }

  /* ---------- Joining ---------- */

  if (!token || !view) {
    return (
      <PhoneFrame>
        {!game ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              lookup(String(new FormData(e.currentTarget).get("pin") ?? ""));
            }}
            className="border border-line bg-panel p-6"
          >
            <h1 className="text-3xl font-extrabold text-white">Join a live quiz</h1>
            <p className="mt-2 text-muted">Type the 6-digit game PIN shown on the big screen. Playing is free.</p>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-sm font-medium">Game PIN</span>
              <input
                name="pin"
                defaultValue={pin}
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                required
                autoFocus={pin.length !== 6}
                onInput={(e) => (e.currentTarget.value = e.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
                className={cn(inputClass, "wide h-16 text-center font-display text-3xl font-extrabold tracking-[0.3em]")}
              />
            </label>
            {error && (
              <p role="alert" className="mt-3 text-sm text-bad">
                {error}
              </p>
            )}
            <Button type="submit" className="mt-5 w-full" disabled={busy}>
              Next
            </Button>
          </form>
        ) : (
          <form onSubmit={join} className="border border-line bg-panel p-6">
            <h1 className="text-3xl font-extrabold text-white">{game.title}</h1>
            <p className="mt-2 text-muted">{game.teams ? "Pick your team. One phone plays for the whole team." : "Choose the name the big screen will show."}</p>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-sm font-medium">{game.teams ? "Your team" : "Nickname"}</span>
              {game.teams ? (
                <select name="team" required autoFocus defaultValue="" className={inputClass}>
                  <option value="">Choose your team</option>
                  {game.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input name="nick" maxLength={24} autoComplete="nickname" required autoFocus className={inputClass} />
              )}
            </label>
            {error && (
              <p role="alert" className="mt-3 text-sm text-bad">
                {error}
              </p>
            )}
            <Button type="submit" className="mt-5 w-full" disabled={busy}>
              {game.started ? "Join the game in progress" : "Join"}
            </Button>
          </form>
        )}
      </PhoneFrame>
    );
  }

  /* ---------- Playing ---------- */

  if (view.status === "kicked") {
    return (
      <PhoneFrame>
        <Message title="You're out of this game" text="The host removed you, or the game was reset. Join again with the PIN if you were meant to be in.">
          <ButtonLink href="/play" className="mt-6">
            Enter a PIN
          </ButtonLink>
        </Message>
      </PhoneFrame>
    );
  }

  // While a question is open the new points stay hidden, so the score can't give the answer away
  const shownScore = view.you.score - (view.status === "question" ? (view.you.gained ?? 0) : 0);
  const me = (
    <MeBadge name={view.you.name}>
      <Score key={`${view.status === "question" ? "q" : "r"}:${view.index}`} score={shownScore} gained={view.status === "question" ? 0 : (view.you.gained ?? 0)} />
    </MeBadge>
  );
  const label = `Question ${view.index + 1} of ${view.total}`;
  const q = view.question;

  const rankLine = (
    <p className="mt-5 text-center text-muted">
      You&apos;re <strong className="text-white">{ordinal(view.you.rank)}</strong> of {view.you.of} with{" "}
      <strong className="text-white">
        <Score key={view.index} score={view.you.score} gained={view.you.gained ?? 0} showGain={view.index > 0} delay={400} />
      </strong>{" "}
      points
    </p>
  );

  let body = null;
  if (view.status === "lobby") {
    body = <Message title="You're in!" text="Look for your name on the big screen. The quiz starts when the host is ready." />;
  } else if (view.status === "question" && q) {
    if (timing.waiting > 0) {
      body = (
        <div className="text-center">
          <p className="text-sm text-muted">{label}</p>
          <p className="mt-3 text-4xl font-extrabold text-white">Get ready</p>
          <p className="mt-3 text-muted">{q.text}</p>
        </div>
      );
    } else if (view.answered !== null && view.answered !== undefined) {
      body = <Message title="Answer locked in" text="Waiting for everyone else, or for time to run out." />;
    } else if (timing.left <= 0) {
      body = <Message title="Time's up" text="Let's see the answer…" />;
    } else {
      body = (
        <div>
          <p className="text-sm text-muted">
            {label}
            {q.points === 2 ? ", double points" : ""}
          </p>
          <p className="mt-2 text-xl leading-snug font-bold text-white">{q.text}</p>
          {q.media?.type === "video" ? <p className="mt-3 text-sm text-muted">Watch the video on the big screen</p> : <MediaView media={q.media} className="mt-3" />}
          <TimeBar fraction={timing.left / (q.time * 1000)} />
          <AnswerButtons answers={q.answers} picked={picked} locked={picked !== null} onPick={answer} />
          {error && (
            <p role="alert" className="mt-3 text-sm text-bad">
              {error}
            </p>
          )}
        </div>
      );
    }
  } else if (view.status === "reveal" && q) {
    const right = q.answers[view.correct ?? 0];
    const r = view.result;
    body = (
      <div>
        {r?.correct ? (
          <div className="bg-good px-6 py-10 text-center text-studio">
            <p className="text-4xl font-extrabold">Correct!</p>
            <p className="wide mt-2 font-display text-3xl font-extrabold">+{r.points.toLocaleString("en-US")}</p>
            {view.you.streak >= 2 && <p className="mt-2 font-medium">{view.you.streak} right in a row</p>}
          </div>
        ) : (
          <div className="bg-bad px-6 py-10 text-center text-white">
            <p className="text-4xl font-extrabold">{r ? "Not this time" : "No answer"}</p>
            <p className="mt-2">
              The answer was <strong>{right}</strong>.
            </p>
          </div>
        )}
        {rankLine}
      </div>
    );
  } else if (view.status === "leaderboard") {
    const top = view.leaderboard ?? [];
    const ahead = view.you.rank > 1 ? top[view.you.rank - 2] : undefined;
    body = (
      <div className="text-center">
        <p className="text-sm text-muted">Leaderboard</p>
        <p className="mt-3 text-4xl font-extrabold text-white">{view.you.rank === 1 ? "You're in the lead!" : `You're ${ordinal(view.you.rank)}`}</p>
        {ahead && (
          <p className="mt-2 text-muted">
            {(ahead.score - view.you.score).toLocaleString("en-US")} points behind {ahead.name}
          </p>
        )}
        {rankLine}
      </div>
    );
  } else if (view.status === "finished") {
    const rows = view.leaderboard ?? [];
    const place = view.you.rank <= 3 ? ["You won!", "Second place!", "Third place!"][view.you.rank - 1] : `You finished ${ordinal(view.you.rank)}`;
    storage.set(`quizotab-play-${pin}`, null);
    body = (
      <div>
        <p className="text-center text-sm text-muted">Final results</p>
        <p className="mt-2 text-center text-4xl font-extrabold text-white">{place}</p>
        {rankLine}
        <ol className="mt-6 border-t border-line">
          {rows.map((r) => (
            <li key={r.name} className={cn("grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-2.5", r.rank === view.you.rank && "bg-live/15")}>
              <span className={cn("wide font-display font-extrabold", r.rank === 1 ? "text-amber" : "text-muted")}>{r.rank}</span>
              <span className="truncate">
                {r.name}
                {r.rank === view.you.rank && <em className="ml-1 text-muted not-italic">(you)</em>}
              </span>
              <span className="wide font-display font-extrabold text-white">
                <Score key={view.index} score={r.score} gained={r.gained} showGain={view.index > 0} delay={1600} />
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-7 text-center">
          <ButtonLink href="/play" variant="line">
            Play another game
          </ButtonLink>
        </p>
      </div>
    );
  }

  return <PhoneFrame me={me}>{body}</PhoneFrame>;
}
