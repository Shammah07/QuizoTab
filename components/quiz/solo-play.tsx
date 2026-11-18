"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { AnswerButtons, TimeBar } from "./answer-buttons";
import { api, ordinal, plural, serverClock, storage } from "./api";
import { Score } from "./count-up";
import { MeBadge, Message, PhoneFrame } from "./frame";
import { MediaView } from "./media";

// Solo play: the quiz runs by itself. The server times each answer and only reveals the right one afterwards. (Was play/solo.js.)

type BoardRow = { rank: number; id: number; name: string; score: number; correct: number };
type Info = { title: string; description: string; categoryLabel: string; count: number; plays: number; author: string; board: BoardRow[] };
type Question = { index: number; total: number; text: string; answers: string[]; time: number; points: number; media: { type: "image" | "video"; src: string } | null; opens_in_ms: number };
type Answered = { correct: boolean; timedOut: boolean; points: number; rightAnswer: number; score: number; question?: Question; finished?: true; rank?: number; players?: number; correctCount?: number; total?: number; runId?: number; board?: BoardRow[] };

const RESULT_MS = 3200; // same as SOLO_RESULT_MS on the server

function BoardList({ board, highlight }: { board: BoardRow[]; highlight?: number }) {
  if (board.length === 0) return <p className="text-sm text-muted">Nobody has played yet. Set the first score.</p>;
  return (
    <ol className="border-t border-line">
      {board.map((r) => (
        <li key={r.id} className={cn("grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-2 text-sm", r.id === highlight && "bg-live/15")}>
          <span className={cn("wide font-display font-extrabold", r.rank === 1 ? "text-amber" : "text-muted")}>{r.rank}</span>
          <span className="truncate">{r.name}</span>
          <strong className="wide font-display font-extrabold text-white">{r.score.toLocaleString("en-US")}</strong>
        </li>
      ))}
    </ol>
  );
}

export function SoloPlay({ quizId }: { quizId: number }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [token, setToken] = useState<string | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [phase, setPhase] = useState<"ready" | "answer" | "sent">("ready");
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [lastGain, setLastGain] = useState(0);
  const [result, setResult] = useState<Answered | null>(null);
  const [left, setLeft] = useState(0);
  const opens = useRef<() => number>(() => 0);
  const clock = useRef<() => number>(() => 0);
  const sending = useRef(false);

  useEffect(() => {
    (async () => {
      const got = await api<Info>(`/api/quizzes/${quizId}/solo`);
      if (!got.ok) return setLoadError(got.error);
      setInfo(got);
      setNickname(storage.get("quizotab-nickname") ?? "");
    })();
  }, [quizId]);

  function ask(q: Question, lead = q.opens_in_ms) {
    opens.current = serverClock(lead);
    clock.current = serverClock(lead + q.time * 1000);
    setQuestion(q);
    setPhase("ready");
    setPicked(null);
    setResult(null);
  }

  async function start(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError("");
    setBusy(true);
    const got = await api<{ token: string; question: Question }>(`/api/quizzes/${quizId}/solo`, { body: { nickname } });
    setBusy(false);
    if (!got.ok) return setError(got.error);
    storage.set("quizotab-nickname", nickname);
    setToken(got.token);
    setScore(0);
    setLastGain(0);
    ask(got.question);
  }

  // The clock: "Get ready" ends, the bar shrinks, and when time runs out the question is sent unanswered
  useEffect(() => {
    if (!question || phase === "sent") return;
    const timer = window.setInterval(() => {
      setLeft(clock.current());
      if (phase === "ready" && opens.current() <= 0) setPhase("answer");
      if (phase === "answer" && clock.current() <= 0) send(-1);
    }, 120);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, phase]);

  async function send(choice: number) {
    if (!token || !question || sending.current) return;
    sending.current = true;
    setPhase("sent");
    if (choice >= 0) {
      setPicked(choice);
      navigator.vibrate?.(30);
    }
    const got = await api<Answered>("/api/solo/answer", { body: { token, index: question.index, choice } });
    sending.current = false;
    if (!got.ok) {
      setError(got.error);
      setResult(null);
      return;
    }
    // The next question's clocks started when the server sent it, before the result screen
    const next = got.question;
    const nextOpens = next ? serverClock(next.opens_in_ms) : null;
    setLastGain(got.points);
    setScore(got.score);
    setResult(got);
    if (got.correct) navigator.vibrate?.([40, 60, 40]);
    window.setTimeout(() => {
      if (got.finished || !next || !nextOpens) return;
      ask(next, nextOpens());
    }, RESULT_MS);
  }

  /* ---------- Screens ---------- */

  if (loadError) {
    return (
      <PhoneFrame>
        <Message title="Quiz not found" text={loadError}>
          <ButtonLink href="/quiz/explore" className="mt-6">
            Find another quiz
          </ButtonLink>
        </Message>
      </PhoneFrame>
    );
  }
  if (!info) {
    return (
      <PhoneFrame>
        <p className="text-center text-muted">Loading the quiz…</p>
      </PhoneFrame>
    );
  }

  const me = token ? (
    <MeBadge name={nickname}>
      <Score key={question?.index ?? -1} score={score} gained={lastGain} />
    </MeBadge>
  ) : undefined;

  // Before the first question, or playing again after the end
  if (!token || (result?.finished && phase === "sent" && !question)) {
    return (
      <PhoneFrame>
        <form onSubmit={start} className="border border-line bg-panel p-6">
          <p className="text-sm font-medium text-live">{info.categoryLabel}</p>
          <h1 className="mt-1 text-3xl leading-tight font-extrabold text-white">{info.title}</h1>
          {info.description && <p className="mt-2 text-muted">{info.description}</p>}
          <p className="mt-2 text-sm text-muted">
            {plural(info.count, "question")}, played {plural(info.plays, "time")}. By {info.author}.
          </p>
          <label className="mt-5 block">
            <span className="mb-1.5 block text-sm font-medium">Your nickname</span>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={24} autoComplete="nickname" required autoFocus={!nickname} className="h-12 w-full border border-line bg-white/5 px-3 text-base text-text focus:border-live focus:outline-none" />
          </label>
          {error && (
            <p role="alert" className="mt-3 text-sm text-bad">
              {error}
            </p>
          )}
          <Button type="submit" className="mt-5 w-full" disabled={busy}>
            Start the quiz
          </Button>
          <p className="mt-7 mb-3 text-sm font-semibold text-white">Top scores</p>
          <BoardList board={info.board} />
        </form>
      </PhoneFrame>
    );
  }

  if (result?.finished) {
    const r = result;
    const rank = r.rank ?? 0;
    const place = rank <= 3 ? ["Top score!", "Second best ever!", "Third best ever!"][rank - 1] : `You placed ${ordinal(rank)}`;
    return (
      <PhoneFrame me={me}>
        <div>
          <p className="text-center text-sm text-muted">{info.title}</p>
          <p className="mt-2 text-center text-4xl font-extrabold text-white">{place}</p>
          <p className="mt-4 text-center text-muted">
            <strong className="text-white">{r.score.toLocaleString("en-US")}</strong> points, {r.correctCount} of {r.total} right. {ordinal(rank)} of {plural(r.players ?? 0, "player")}.
          </p>
          <p className="mt-7 mb-3 text-sm font-semibold text-white">Top scores</p>
          <BoardList board={r.board ?? []} highlight={r.runId} />
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button
              onClick={() => {
                setToken(null);
                setQuestion(null);
                setResult(null);
              }}
            >
              Play again
            </Button>
            <ButtonLink href="/quiz/explore" variant="line">
              More quizzes
            </ButtonLink>
          </div>
        </div>
      </PhoneFrame>
    );
  }

  if (result && question) {
    const right = question.answers[result.rightAnswer];
    return (
      <PhoneFrame me={me}>
        <div>
          {result.correct ? (
            <div className="bg-good px-6 py-10 text-center text-studio">
              <p className="text-4xl font-extrabold">Correct!</p>
              <p className="wide mt-2 font-display text-3xl font-extrabold">+{result.points.toLocaleString("en-US")}</p>
            </div>
          ) : (
            <div className="bg-bad px-6 py-10 text-center text-white">
              <p className="text-4xl font-extrabold">{result.timedOut ? "Time's up" : "Not this time"}</p>
              <p className="mt-2">
                The answer was <strong>{right}</strong>.
              </p>
            </div>
          )}
          <p className="mt-5 text-center text-muted">
            Total{" "}
            <strong className="text-white">
              <Score key={question.index} score={result.score} gained={result.points} showGain={question.index > 0} />
            </strong>{" "}
            points
          </p>
        </div>
      </PhoneFrame>
    );
  }

  if (error && phase === "sent") {
    return (
      <PhoneFrame me={me}>
        <Message title="Something went wrong" text={error}>
          <Button className="mt-6" onClick={() => start()}>
            Play again
          </Button>
        </Message>
      </PhoneFrame>
    );
  }

  if (!question) return <PhoneFrame me={me}>{null}</PhoneFrame>;

  if (phase === "ready") {
    return (
      <PhoneFrame me={me}>
        <div className="text-center">
          <p className="text-sm text-muted">
            Question {question.index + 1} of {question.total}
            {question.points === 2 ? ", double points" : ""}
          </p>
          <p className="mt-3 text-4xl font-extrabold text-white">Get ready</p>
          <p className="mt-3 text-muted">{question.text}</p>
        </div>
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame me={me}>
      <div>
        <p className="text-sm text-muted">
          Question {question.index + 1} of {question.total}
        </p>
        <p className="mt-2 text-xl leading-snug font-bold text-white">{question.text}</p>
        <MediaView media={question.media} className="mt-3" autoPlay />
        <TimeBar fraction={left / (question.time * 1000)} />
        <AnswerButtons answers={question.answers} picked={picked} locked={phase !== "answer"} onPick={send} />
      </div>
    </PhoneFrame>
  );
}
