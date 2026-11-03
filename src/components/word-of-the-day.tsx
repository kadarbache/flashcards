"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { answerDailyWord } from "@/app/actions";
import { buzz, Confetti } from "@/components/game/effects";
import { play } from "@/components/game/sound";
import { SWIPE_SURFACE, useSwipe, type Direction, type SwipeFrame } from "@/components/game/use-swipe";
import {
  ArrowIcon,
  CheckIcon,
  CloseIcon,
  FlameIcon,
  FlipIcon,
  HomeIcon,
  SunIcon,
} from "@/components/icons";
import { cardSpeaker, SpeakerButton } from "@/components/speaker";
import { iconButton, panel, primaryButton, secondaryButton } from "@/components/ui";
import { optionText, splitLabel } from "@/lib/blitz";
import type { WordRecord, WordResult } from "@/lib/word-of-the-day";
import type { DailyWordView, WordOfTheDay } from "@/lib/word-of-the-day-db";

const SWIPE_THRESHOLD = 100;

/** Swipe right if you knew it, left if you did not -- the same sides as Good and Again. */
const STAMPS: { direction: Direction; result: WordResult; label: string; color: string; place: string }[] = [
  { direction: "right", result: "knew", label: "Knew it", color: "#0B8A5A", place: "top-14 left-5 -rotate-12" },
  { direction: "left", result: "missed", label: "Missed", color: "#D42F4F", place: "top-14 right-5 rotate-12" },
];

/**
 * Word of the Day: one learned word, once a day. Read the word, try to recall
 * it, flip, and say honestly whether you knew it. One answer per day; the
 * record below counts the days you knew it and the days you did not.
 *
 * Nothing here touches a card's schedule.
 */
export function WordOfTheDaySession({
  data,
  dateLabel,
  aiVoice,
}: {
  data: WordOfTheDay;
  dateLabel: string;
  /** Read the word aloud with the AI voice, falling back to the device's. */
  aiVoice: boolean;
}) {
  const word = data.today;
  const [result, setResult] = useState<WordResult | null>(word?.result ?? null);
  const [flipped, setFlipped] = useState(word?.result != null);
  const [record, setRecord] = useState<WordRecord>(data.record);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confetti, setConfetti] = useState(0);
  const [justAnswered, setJustAnswered] = useState(false);

  const flip = useCallback(() => {
    if (!word || result) return;
    setFlipped((was) => !was);
    play("flip");
  }, [result, word]);

  const answer = useCallback(
    async (choice: WordResult) => {
      if (!word || result || saving || !flipped) return;
      setSaving(true);
      setError(null);
      setResult(choice);
      setJustAnswered(true);
      if (choice === "knew") {
        play("good");
        buzz(10);
        setConfetti((value) => value + 1);
      } else {
        play("again");
        buzz(40);
      }
      try {
        const outcome = await answerDailyWord(word.day, choice);
        if (outcome.ok) {
          setRecord(outcome.record);
        } else {
          setResult(null);
          setJustAnswered(false);
          setError(outcome.message);
        }
      } catch {
        setResult(null);
        setJustAnswered(false);
        setError("Your answer could not be saved. Try again.");
      } finally {
        setSaving(false);
      }
    },
    [flipped, result, saving, word],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a")) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        flip();
      } else if (event.key === "ArrowRight" || event.key === "2") {
        event.preventDefault();
        void answer("knew");
      } else if (event.key === "ArrowLeft" || event.key === "1") {
        event.preventDefault();
        void answer("missed");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answer, flip]);

  return (
    <div className="relative mx-auto max-w-lg space-y-5">
      <Confetti fire={confetti} />

      <div className="flex items-center gap-2.5">
        <Link href="/" className={iconButton} aria-label="Back to home">
          <ArrowIcon direction="left" className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl leading-tight font-extrabold tracking-tight">Word of the Day</h1>
          <p className="truncate text-sm text-ink-muted">{dateLabel}</p>
        </div>
        {record.streak > 0 && (
          <span
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-[#2a1a12] px-3 py-1.5 text-sm font-extrabold text-flame tabular-nums"
            title="Days in a row you knew the word"
          >
            <FlameIcon className="h-4 w-4" />
            {record.streak}
          </span>
        )}
      </div>

      {word ? (
        <>
          <WordCard
            word={word}
            flipped={flipped}
            result={result}
            onFlip={flip}
            onAnswer={(choice) => void answer(choice)}
            aiVoice={aiVoice}
          />

          {!result && !flipped && (
            <button type="button" onClick={flip} className={`${primaryButton} min-h-16 w-full text-lg`}>
              <FlipIcon className="h-5 w-5" />
              Show the meaning
              <kbd className="hidden rounded-md bg-paper-ink/15 px-1.5 py-0.5 text-xs font-bold sm:inline">
                Space
              </kbd>
            </button>
          )}

          {!result && flipped && (
            <div className="space-y-2">
              <p className="text-center text-sm font-bold text-ink-muted">Did you know it? Be honest.</p>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => void answer("missed")}
                  disabled={saving}
                  className="inline-flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-again text-lg font-extrabold text-paper-ink transition active:scale-[0.97] disabled:opacity-50"
                >
                  <CloseIcon className="h-5 w-5" />
                  Missed it
                </button>
                <button
                  type="button"
                  onClick={() => void answer("knew")}
                  disabled={saving}
                  className="inline-flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-good text-lg font-extrabold text-paper-ink transition active:scale-[0.97] disabled:opacity-50"
                >
                  <CheckIcon className="h-5 w-5" />
                  Knew it
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-center text-sm font-bold text-again">{error}</p>}

          {result && (
            <ResultBanner result={result} streak={record.streak} fresh={justAnswered} />
          )}
        </>
      ) : (
        <div className={`${panel} px-6 py-12 text-center`}>
          <SunIcon className="mx-auto h-12 w-12 text-gold" />
          <h2 className="mt-3 text-2xl font-extrabold">No learned words yet</h2>
          <p className="mt-2 text-ink-muted">
            Words come from cards you have already learned. Review a deck until some cards
            graduate, and your first word will be here.
          </p>
          <Link href="/" className={`${primaryButton} mt-5`}>
            <HomeIcon className="h-5 w-5" />
            Go to your decks
          </Link>
        </div>
      )}

      <RecordPanel record={record} />

      {data.history.length > 0 && <History words={data.history} />}
    </div>
  );
}

function WordCard({
  word,
  flipped,
  result,
  onFlip,
  onAnswer,
  aiVoice,
}: {
  word: DailyWordView;
  flipped: boolean;
  result: WordResult | null;
  onFlip: () => void;
  onAnswer: (result: WordResult) => void;
  aiVoice: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const stamps = useRef<Partial<Record<Direction, HTMLDivElement | null>>>({});

  function paintStamps(frame: SwipeFrame) {
    for (const stamp of STAMPS) {
      const node = stamps.current[stamp.direction];
      if (!node) continue;
      const on = stamp.direction === frame.direction;
      node.style.opacity = on ? String(Math.min(1, frame.progress * 1.4)) : "0";
    }
  }

  const canAnswer = flipped && result === null;
  const { handlers, springBack } = useSwipe(element, {
    axis: "x",
    threshold: SWIPE_THRESHOLD,
    canSwipe: canAnswer,
    locked: result !== null,
    onTap: onFlip,
    onFrame: paintStamps,
    onSwipe: (direction) => {
      // The card is the only one today, so it comes home after the answer.
      paintStamps({ dx: 0, dy: 0, direction: null, progress: 0 });
      springBack();
      const stamp = STAMPS.find((entry) => entry.direction === direction);
      if (stamp) onAnswer(stamp.result);
    },
  });

  const back = splitLabel(word.back);
  const ring =
    result === "knew"
      ? "ring-4 ring-good"
      : result === "missed"
        ? "ring-4 ring-again"
        : "";

  return (
    <div className="relative h-[clamp(17rem,calc(100dvh-26rem),24rem)]">
      <div
        ref={element}
        {...handlers}
        className={`anim-card-in absolute inset-0 ${result ? "" : "cursor-grab active:cursor-grabbing"} ${SWIPE_SURFACE}`}
        role="group"
        aria-roledescription="flashcard"
        aria-label={flipped ? `Answer: ${word.back}` : `Word of the day: ${word.front}`}
      >
        <div className="h-full [perspective:1400px]">
          <div
            className={`relative h-full transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:duration-0 ${
              flipped ? "[transform:rotateY(180deg)]" : ""
            }`}
          >
            <Face hidden={flipped}>
              <CardTop deckName={word.deckName} />
              <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-2 py-4 text-center">
                <p className="text-sm font-extrabold tracking-wide text-paper-muted uppercase">
                  Do you know this word?
                </p>
                <p className="text-[clamp(2rem,8vw,3rem)] leading-tight font-extrabold tracking-tight break-words">
                  {word.front}
                </p>
              </div>
              <p className="flex items-center justify-center gap-1.5 text-sm font-bold text-paper-muted">
                <FlipIcon className="h-4 w-4" />
                Say it in your head, then tap to flip
              </p>
            </Face>

            <Face back hidden={!flipped} ring={ring}>
              <CardTop deckName={word.deckName} />
              <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-2 py-4 text-center">
                <div className="flex max-w-full items-center justify-center gap-2">
                  <p className="min-w-0 text-lg font-extrabold break-words">{word.front}</p>
                  <SpeakerButton text={word.front} aiVoice={aiVoice} className={cardSpeaker} />
                </div>
                <span className="h-1 w-10 rounded-full bg-[#e4dcfd]" aria-hidden="true" />
                {back.label && (
                  <span className="rounded-full bg-[#efeafe] px-2.5 py-0.5 text-xs font-extrabold text-[#5b4bb0]">
                    {back.label}
                  </span>
                )}
                <p
                  className={`leading-snug font-bold break-words whitespace-pre-wrap ${
                    back.text.length > 160 ? "text-base" : back.text.length > 80 ? "text-lg" : "text-2xl"
                  }`}
                >
                  {back.text}
                </p>
              </div>
              {result === null && (
                <p className="flex items-center justify-center gap-2 text-sm font-bold text-paper-muted">
                  <ArrowIcon direction="left" className="h-4 w-4" />
                  Missed · Knew it
                  <ArrowIcon direction="right" className="h-4 w-4" />
                </p>
              )}
            </Face>
          </div>
        </div>

        {STAMPS.map((stamp) => (
          <div
            key={stamp.direction}
            ref={(node) => {
              stamps.current[stamp.direction] = node;
            }}
            aria-hidden="true"
            className={`pointer-events-none absolute z-10 rounded-2xl border-[5px] bg-paper/90 px-3.5 py-1.5 opacity-0 ${stamp.place}`}
            style={{ borderColor: stamp.color, color: stamp.color }}
          >
            <p className="text-[1.6rem] leading-none font-black tracking-wide uppercase">{stamp.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One side of the card. The side facing away is `hidden`: inert, so its buttons cannot be reached. */
function Face({
  back = false,
  hidden = false,
  ring = "",
  children,
}: {
  back?: boolean;
  hidden?: boolean;
  ring?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      inert={hidden}
      className={`absolute inset-0 flex flex-col rounded-[28px] bg-paper p-5 text-paper-ink shadow-[0_28px_60px_-24px_rgba(0,0,0,.75)] [backface-visibility:hidden] sm:p-6 ${ring} ${
        back ? "[transform:rotateY(180deg)]" : ""
      }`}
    >
      {children}
    </div>
  );
}

function CardTop({ deckName }: { deckName: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-extrabold">
      <span className="flex items-center gap-1.5 rounded-full bg-[#fff1c2] px-2.5 py-1 text-[#8a5a00]">
        <SunIcon className="h-3.5 w-3.5" />
        Word of the Day
      </span>
      {deckName && <span className="ml-auto truncate text-paper-muted">{deckName}</span>}
    </div>
  );
}

function ResultBanner({ result, streak, fresh }: { result: WordResult; streak: number; fresh: boolean }) {
  const knew = result === "knew";
  return (
    <div
      className={`${fresh ? "anim-pop-in" : ""} rounded-3xl border p-5 text-center ${
        knew ? "border-[#1f6b4f] bg-[#0f2a20]" : "border-[#6b1f30] bg-[#2a0f16]"
      }`}
    >
      <p className={`text-2xl font-extrabold ${knew ? "text-good" : "text-again"}`}>
        {knew ? "You knew it!" : "Missed this one"}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {knew
          ? streak > 1
            ? `${streak} days in a row. Come back tomorrow for a new word.`
            : "Come back tomorrow for a new word."
          : "No harm done. Read it once more, and come back tomorrow for a new word."}
      </p>
    </div>
  );
}

function RecordPanel({ record }: { record: WordRecord }) {
  return (
    <section className={`${panel} space-y-4`}>
      <h2 className="text-lg font-extrabold">Your record</h2>
      <dl className="grid grid-cols-3 gap-2.5">
        <Stat label="Days you knew it" value={record.knew} color="text-good" />
        <Stat label="Days you missed" value={record.missed} color="text-again" />
        <Stat label="In a row" value={record.streak} color="text-flame" hint={`Best ${record.bestStreak}`} />
      </dl>
      <div>
        <ol className="grid grid-cols-7 gap-1.5" aria-label={`The last ${record.calendar.length} days`}>
          {record.calendar.map((day) => {
            let tone = "bg-surface-high text-ink-muted";
            if (day.result === "knew") tone = "bg-good text-paper-ink";
            else if (day.result === "missed") tone = "bg-again text-paper-ink";
            else if (day.isToday) tone = "border-2 border-dashed border-gold text-gold";
            const status =
              day.result === "knew" ? "knew it" : day.result === "missed" ? "missed it" : "no answer";
            return (
              <li
                key={day.day}
                className={`flex aspect-square items-center justify-center rounded-xl text-xs font-extrabold tabular-nums ${tone}`}
                title={`${formatDay(day.day)}: ${status}`}
              >
                {day.date}
              </li>
            );
          })}
        </ol>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-good" /> Knew it
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-again" /> Missed it
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-surface-high" /> Not played
          </span>
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value, color, hint }: { label: string; value: number; color: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-surface-high px-2 py-3.5 text-center">
      <dd className={`text-3xl leading-none font-extrabold tabular-nums ${color}`}>{value}</dd>
      <dt className="mt-1.5 text-xs leading-tight font-semibold text-ink-muted">{label}</dt>
      {hint && <p className="mt-0.5 text-[11px] text-ink-muted/80">{hint}</p>}
    </div>
  );
}

function History({ words }: { words: DailyWordView[] }) {
  return (
    <section className={`${panel} space-y-3`}>
      <h2 className="text-lg font-extrabold">Earlier words</h2>
      <ul className="divide-y divide-border-subtle">
        {words.map((word) => (
          <li key={word.day} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                word.result === "knew"
                  ? "bg-good text-paper-ink"
                  : word.result === "missed"
                    ? "bg-again text-paper-ink"
                    : "bg-surface-high text-ink-muted"
              }`}
              aria-label={word.result === "knew" ? "Knew it" : word.result === "missed" ? "Missed it" : "Not played"}
            >
              {word.result === "knew" ? (
                <CheckIcon className="h-4 w-4" />
              ) : word.result === "missed" ? (
                <CloseIcon className="h-4 w-4" />
              ) : (
                <span className="text-xs font-extrabold">–</span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline justify-between gap-2">
                <span className="truncate font-extrabold">{word.front}</span>
                <span className="shrink-0 text-xs text-ink-muted">{formatDay(word.day)}</span>
              </p>
              <p className="line-clamp-2 text-sm text-ink-muted">{optionText(word.back)}</p>
            </div>
          </li>
        ))}
      </ul>
      <Link href="/" className={`${secondaryButton} w-full`}>
        <HomeIcon className="h-5 w-5" />
        Home
      </Link>
    </section>
  );
}

/** "2026-10-31" -> "Sat 31 Oct". The key is already a calendar day, so read it as UTC. */
function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}
