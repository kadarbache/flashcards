"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { saveBlitzScore } from "@/app/actions";
import { Confetti, Floats, buzz, type FloatText } from "@/components/game/effects";
import { play } from "@/components/game/sound";
import { ArrowIcon, BoltIcon, HeartIcon, HomeIcon, PlayIcon, SwapIcon, TrophyIcon } from "@/components/icons";
import { iconButton, panel, primaryButton, secondaryButton } from "@/components/ui";
import {
  BLITZ_HEARTS,
  BLITZ_SECONDS,
  MIN_BLITZ_CARDS,
  blitzPoints,
  buildQuestion,
  type BlitzCard,
  type BlitzQuestion,
} from "@/lib/blitz";
import { shuffled } from "@/lib/shuffle";
import { countdownTick } from "@/lib/sound";

type Phase = "ready" | "playing" | "over";

interface Round {
  score: number;
  right: number;
  wrong: number;
  streak: number;
  bestStreak: number;
  hearts: number;
}

const FRESH: Round = { score: 0, right: 0, wrong: 0, streak: 0, bestStreak: 0, hearts: BLITZ_HEARTS };
const TOTAL_MS = BLITZ_SECONDS * 1000;

/**
 * Blitz: a minute of multiple choice against the clock, built from the deck's
 * own cards. Like practice it never writes to a card, so it can be played as
 * often as you like. Only the best score is saved.
 */
export function BlitzSession({
  deckId,
  deckName,
  cards,
  initialBest,
}: {
  deckId: string;
  deckName: string;
  cards: BlitzCard[];
  initialBest: number;
}) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [question, setQuestion] = useState<BlitzQuestion | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [round, setRound] = useState<Round>(FRESH);
  const [timeLeft, setTimeLeft] = useState(TOTAL_MS);
  const [best, setBest] = useState(initialBest);
  const [bestBefore, setBestBefore] = useState(initialBest);
  const [endedBy, setEndedBy] = useState<"time" | "hearts">("time");
  const [floats, setFloats] = useState<FloatText[]>([]);
  const [confetti, setConfetti] = useState(0);
  const [shake, setShake] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Counts questions, so each new one remounts and animates in. */
  const [asked, setAsked] = useState(0);

  const order = useRef<BlitzCard[]>([]);
  const position = useRef(0);
  const startedAt = useRef(0);
  const roundRef = useRef<Round>(FRESH);
  const phaseRef = useRef<Phase>("ready");
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(1);
  /** The last countdown second that ticked, so each one ticks once. */
  const lastTick = useRef<number | null>(null);

  const enough = cards.length >= MIN_BLITZ_CARDS;

  const updateRound = useCallback((next: Round) => {
    roundRef.current = next;
    setRound(next);
  }, []);

  const finish = useCallback(
    (reason: "time" | "hearts") => {
      if (phaseRef.current !== "playing") return;
      phaseRef.current = "over";
      if (pending.current) clearTimeout(pending.current);
      setPhase("over");
      setEndedBy(reason);
      setPicked(null);
      const { score } = roundRef.current;
      play("over");
      if (score > best) {
        setConfetti((value) => value + 1);
        play("best", 1, 800);
      }
      setSaveError(null);
      saveBlitzScore(deckId, score)
        .then(setBest)
        .catch(() => setSaveError("Your score could not be saved."));
    },
    [best, deckId],
  );

  const ask = useCallback(() => {
    // Through the deck in a shuffled order, then again in a new one.
    if (position.current >= order.current.length) {
      const last = order.current[order.current.length - 1];
      let next = shuffled(cards);
      if (next.length > 1 && next[0].id === last?.id) next = [...next.slice(1), next[0]];
      order.current = next;
      position.current = 0;
    }
    setQuestion(buildQuestion(order.current, position.current));
    position.current += 1;
    setAsked((value) => value + 1);
    setPicked(null);
  }, [cards]);

  const start = useCallback(() => {
    if (!enough) return;
    order.current = shuffled(cards);
    position.current = 0;
    startedAt.current = Date.now();
    lastTick.current = null;
    phaseRef.current = "playing";
    play("tap");
    setBestBefore(best);
    updateRound(FRESH);
    setTimeLeft(TOTAL_MS);
    setPhase("playing");
    ask();
  }, [ask, best, cards, enough, updateRound]);

  // The clock. State is set from the interval callback, never in the effect body.
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = setInterval(() => {
      const left = Math.max(0, TOTAL_MS - (Date.now() - startedAt.current));
      setTimeLeft(left);
      const second = countdownTick(left, lastTick.current);
      if (second !== null) {
        lastTick.current = second;
        play("clock");
      }
      if (left === 0) finish("time");
    }, 100);
    return () => clearInterval(timer);
  }, [finish, phase]);

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  const pick = useCallback(
    (choice: number) => {
      if (phaseRef.current !== "playing" || !question || picked !== null) return;
      if (choice < 0 || choice >= question.options.length) return;
      setPicked(choice);
      const current = roundRef.current;

      if (choice === question.correct) {
        const streak = current.streak + 1;
        const points = blitzPoints(streak);
        updateRound({
          ...current,
          score: current.score + points,
          right: current.right + 1,
          streak,
          bestStreak: Math.max(current.bestStreak, streak),
        });
        const id = nextId.current++;
        setFloats((items) => [
          ...items,
          { id, text: `+${points}`, color: streak >= 3 ? "#FFD24A" : "#3EE0A1", top: 40, size: 34 },
        ]);
        setTimeout(() => setFloats((items) => items.filter((item) => item.id !== id)), 1050);
        buzz(10);
        play("right", streak);
        pending.current = setTimeout(ask, 380);
        return;
      }

      const hearts = current.hearts - 1;
      updateRound({ ...current, wrong: current.wrong + 1, streak: 0, hearts });
      setShake((value) => value + 1);
      buzz(60);
      play("wrong");
      pending.current = setTimeout(() => (hearts <= 0 ? finish("hearts") : ask()), 950);
    },
    [ask, finish, picked, question, updateRound],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a")) {
        // Buttons handle Space and Enter themselves; digits still answer.
        if (!/^[1-4]$/.test(event.key)) return;
      }
      if (phaseRef.current === "playing") {
        if (/^[1-4]$/.test(event.key)) {
          event.preventDefault();
          pick(Number(event.key) - 1);
        }
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        start();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pick, start]);

  if (!enough) {
    return (
      <div className="mx-auto max-w-lg space-y-5 text-center">
        <div className={`${panel} px-6 py-12`}>
          <BoltIcon className="mx-auto h-12 w-12 text-gold" />
          <h1 className="mt-3 text-2xl font-extrabold">Blitz needs {MIN_BLITZ_CARDS} cards</h1>
          <p className="mt-2 text-ink-muted">
            Each question shows four answers from this deck, so add a few more cards first.
          </p>
        </div>
        <Link href={`/decks/${deckId}`} className={primaryButton}>
          Open {deckName}
        </Link>
      </div>
    );
  }

  if (phase === "ready") {
    return (
      <div className="mx-auto max-w-lg space-y-5 text-center">
        <div className="flex items-center gap-2.5 text-left">
          <Link href="/" className={iconButton} aria-label="Back to home">
            <ArrowIcon direction="left" className="h-5 w-5" />
          </Link>
          <p className="truncate font-extrabold">{deckName}</p>
        </div>
        <div className="anim-pop-in mx-auto flex h-24 w-24 items-center justify-center rounded-[28px] bg-gold text-paper-ink shadow-[0_18px_40px_-12px_rgba(255,210,74,.55)]">
          <BoltIcon className="h-12 w-12" />
        </div>
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight">Blitz</h1>
          <p className="mt-2 text-ink-muted">
            {BLITZ_SECONDS} seconds. {BLITZ_HEARTS} hearts. Pick the meaning that matches the word.
          </p>
        </div>
        <ul className={`${panel} space-y-3 text-left text-sm`}>
          <li className="flex gap-3">
            <span className="font-extrabold text-good">+100</span>
            for a right answer. 3 in a row makes it 200, 6 in a row 300.
          </li>
          <li className="flex gap-3">
            <HeartIcon className="h-5 w-5 shrink-0 text-again" />A wrong answer costs a heart.
          </li>
          <li className="flex gap-3">
            <SwapIcon className="h-5 w-5 shrink-0 text-easy" />
            Just for fun: nothing here changes when your cards come back.
          </li>
        </ul>
        {best > 0 && (
          <p className="flex items-center justify-center gap-2 font-bold text-gold">
            <TrophyIcon className="h-5 w-5" />
            Best: {best.toLocaleString("en-US")}
          </p>
        )}
        <button type="button" onClick={start} className={`${primaryButton} min-h-16 w-full text-lg`}>
          <PlayIcon className="h-5 w-5" />
          Start
          <kbd className="hidden rounded-md bg-paper-ink/15 px-1.5 py-0.5 text-xs font-bold sm:inline">
            Space
          </kbd>
        </button>
      </div>
    );
  }

  if (phase === "over") {
    const answered = round.right + round.wrong;
    const record = round.score > bestBefore && round.score > 0;
    return (
      <div className="relative mx-auto max-w-lg space-y-5 text-center">
        <Confetti fire={confetti} />
        <div className="anim-pop-in mx-auto flex h-24 w-24 items-center justify-center rounded-[28px] bg-gold text-paper-ink">
          <TrophyIcon className="h-12 w-12" />
        </div>
        <div>
          <p className="text-sm font-bold text-ink-muted">
            {endedBy === "time" ? "Time's up!" : "Out of hearts"}
          </p>
          <h1 className="text-6xl font-extrabold tracking-tight text-gold tabular-nums">
            {round.score.toLocaleString("en-US")}
          </h1>
          <p className="mt-1 font-bold">
            {record ? "New best score!" : `Best: ${best.toLocaleString("en-US")}`}
          </p>
          {saveError && <p className="mt-1 text-sm text-again">{saveError}</p>}
        </div>
        <dl className="grid grid-cols-3 gap-3">
          <Stat label="Right" value={String(round.right)} color="text-good" />
          <Stat label="Best run" value={String(round.bestStreak)} color="text-flame" />
          <Stat
            label="Accuracy"
            value={answered === 0 ? "-" : `${Math.round((round.right / answered) * 100)}%`}
            color="text-easy"
          />
        </dl>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={start} className={`${primaryButton} sm:col-span-2`}>
            <PlayIcon className="h-5 w-5" />
            Play again
          </button>
          <Link href={`/decks/${deckId}/practice`} className={secondaryButton}>
            <SwapIcon className="h-5 w-5" />
            Practice
          </Link>
          <Link href="/" className={secondaryButton}>
            <HomeIcon className="h-5 w-5" />
            Home
          </Link>
        </div>
      </div>
    );
  }

  const fraction = timeLeft / TOTAL_MS;
  const low = timeLeft < 10_000;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex gap-1" aria-label={`${round.hearts} hearts left`} role="img">
          {Array.from({ length: BLITZ_HEARTS }, (_, i) => (
            <HeartIcon
              key={i}
              full={i < round.hearts}
              className={`h-7 w-7 ${i < round.hearts ? "text-again" : "text-border-subtle"}`}
            />
          ))}
        </div>
        <span
          className={`ml-auto text-2xl font-extrabold tabular-nums ${low ? "text-again" : ""}`}
          aria-live="off"
        >
          {Math.ceil(timeLeft / 1000)}s
        </span>
        <span className="rounded-full bg-gold px-3.5 py-1.5 text-lg font-extrabold text-paper-ink tabular-nums">
          {round.score.toLocaleString("en-US")}
        </span>
      </div>

      <div className="h-2.5 overflow-hidden rounded-full bg-surface-raised" aria-hidden="true">
        <div
          className={`h-full rounded-full transition-[width] duration-100 ease-linear ${low ? "bg-again" : "bg-gold"}`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>

      <div key={`shake-${shake}`} className={`relative ${shake > 0 ? "anim-shake" : ""}`}>
        <div className="anim-card-in rounded-[28px] bg-paper px-5 py-9 text-center text-paper-ink sm:py-12">
          <p className="text-xs font-extrabold tracking-wide text-paper-muted uppercase">
            {round.streak >= 3 ? `${round.streak} in a row · ×${blitzPoints(round.streak + 1) / 100}` : "What does it mean?"}
          </p>
          <p className="mt-2 text-[clamp(1.9rem,7vw,3rem)] leading-tight font-extrabold tracking-tight break-words">
            {question?.prompt}
          </p>
        </div>
        <Floats items={floats} />
      </div>

      {question && (
        <ul className="grid gap-2.5 sm:grid-cols-2" key={`question-${asked}`}>
          {question.options.map((option, i) => {
            const isRight = i === question.correct;
            const chosen = picked === i;
            const reveal = picked !== null;
            let tone = "bg-surface-raised text-ink hover:bg-surface-high";
            if (reveal && isRight) tone = "bg-good text-paper-ink";
            else if (reveal && chosen) tone = "bg-again text-paper-ink";
            else if (reveal) tone = "bg-surface-raised text-ink opacity-50";
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => pick(i)}
                  disabled={reveal}
                  className={`anim-rise flex min-h-16 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left font-bold transition active:scale-[0.98] ${tone}`}
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-black/15 text-sm font-extrabold">
                    {i + 1}
                  </span>
                  <span className="line-clamp-3 min-w-0">{option}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-3xl bg-surface-raised px-2 py-4">
      <dd className={`text-3xl leading-none font-extrabold tabular-nums ${color}`}>{value}</dd>
      <dt className="mt-1.5 text-xs font-semibold text-ink-muted">{label}</dt>
    </div>
  );
}
