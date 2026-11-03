"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { answerDailyWord } from "@/app/actions";
import { buzz, Confetti } from "@/components/game/effects";
import { JudgeButtons, JudgeCard } from "@/components/game/judge-card";
import { play } from "@/components/game/sound";
import {
  ArrowIcon,
  CheckIcon,
  CloseIcon,
  FlameIcon,
  FlipIcon,
  HomeIcon,
  SunIcon,
} from "@/components/icons";
import { iconButton, panel, primaryButton, secondaryButton } from "@/components/ui";
import { optionText } from "@/lib/blitz";
import { formatDay } from "@/lib/game";
import type { WordRecord, WordResult } from "@/lib/word-of-the-day";
import type { DailyWordView, WordOfTheDay } from "@/lib/word-of-the-day-db";

/** The pill on the card's corner. */
const BADGE = (
  <span className="flex items-center gap-1.5 rounded-full bg-[#fff1c2] px-2.5 py-1 text-[#8a5a00]">
    <SunIcon className="h-3.5 w-3.5" />
    Word of the Day
  </span>
);

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
          <JudgeCard
            label="Word of the day"
            front={word.front}
            back={word.back}
            deckName={word.deckName}
            badge={BADGE}
            question="Do you know this word?"
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
            <JudgeButtons
              prompt="Did you know it? Be honest."
              disabled={saving}
              onAnswer={(choice) => void answer(choice)}
            />
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
