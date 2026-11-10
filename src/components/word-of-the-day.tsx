"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { answerDailyWord, restoreDailyWord } from "@/app/actions";
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
  PlayIcon,
  RestoreIcon,
  SunIcon,
} from "@/components/icons";
import { Sheet } from "@/components/sheet";
import { iconButton, panel, primaryButton, secondaryButton } from "@/components/ui";
import { optionText } from "@/lib/blitz";
import { daysBetween, formatDay } from "@/lib/game";
import {
  cannotRestore,
  type CalendarDay,
  type RestoreCards,
  type WordRecord,
  type WordResult,
} from "@/lib/word-of-the-day";
import type { DailyWordView, WordOfTheDay } from "@/lib/word-of-the-day-db";

/** The pill on the card's corner. */
const BADGE = (
  <span className="flex items-center gap-1.5 rounded-full bg-[#fff1c2] px-2.5 py-1 text-[#8a5a00]">
    <SunIcon className="h-3.5 w-3.5" />
    Word of the Day
  </span>
);

/** The pill on a card a restore card brought back, naming the day it belonged to. */
function restoredBadge(day: string) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-[#ece3ff] px-2.5 py-1 text-[#4b2a99]">
      <RestoreIcon className="h-3.5 w-3.5" />
      Restored · {formatDay(day)}
    </span>
  );
}

/**
 * Word of the Day: one learned word, once a day. Read the word, try to recall
 * it, flip, and say honestly whether you knew it. One answer per day; the
 * record below counts the days you knew it and the days you did not.
 *
 * A missed day can be brought back with a restore card: it costs XP, and the
 * day's word takes the card's place to be answered late. Late answers keep a
 * mark of their own on the calendar and in the list, so they never pass for
 * on-time ones.
 *
 * Nothing here touches a card's schedule.
 */
export function WordOfTheDaySession({
  data,
  dateLabel,
  aiVoice,
  xpToSpend,
}: {
  data: WordOfTheDay;
  dateLabel: string;
  /** Read the word aloud with the AI voice, falling back to the device's. */
  aiVoice: boolean;
  /** XP left to spend, which restore cards are paid from. */
  xpToSpend: number;
}) {
  /** The word on the card: today's, or a missed day's brought back. */
  const [active, setActive] = useState<DailyWordView | null>(data.today);
  /** Answers given on this visit, shown before the server confirms them. */
  const [answers, setAnswers] = useState<Record<string, WordResult>>({});
  const [record, setRecord] = useState<WordRecord>(data.record);
  const [restores, setRestores] = useState<RestoreCards>(data.restores);
  const [xp, setXp] = useState(xpToSpend);
  const [flipped, setFlipped] = useState(data.today?.result != null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confetti, setConfetti] = useState(0);
  const [justAnswered, setJustAnswered] = useState(false);
  /** The missed day the restore sheet is asking about. */
  const [asking, setAsking] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const days = useMemo(() => new Map(record.calendar.map((day) => [day.day, day])), [record]);

  const resultOf = useCallback(
    (word: DailyWordView): WordResult | null =>
      answers[word.day] ?? days.get(word.day)?.result ?? word.result,
    [answers, days],
  );

  const result = active ? resultOf(active) : null;
  const late = active?.restored ?? false;

  const show = useCallback(
    (word: DailyWordView) => {
      setActive(word);
      setFlipped(resultOf(word) !== null);
      setJustAnswered(false);
      setError(null);
    },
    [resultOf],
  );

  const flip = useCallback(() => {
    if (!active || result) return;
    setFlipped((was) => !was);
    play("flip");
  }, [active, result]);

  const answer = useCallback(
    async (choice: WordResult) => {
      if (!active || result || saving || !flipped) return;
      const day = active.day;
      setSaving(true);
      setError(null);
      setAnswers((current) => ({ ...current, [day]: choice }));
      setJustAnswered(true);
      if (choice === "knew") {
        play("good");
        buzz(10);
        setConfetti((value) => value + 1);
      } else {
        play("again");
        buzz(40);
      }

      const takeBack = (message: string) => {
        setAnswers((current) => {
          const next = { ...current };
          delete next[day];
          return next;
        });
        setJustAnswered(false);
        setError(message);
      };
      try {
        const outcome = await answerDailyWord(day, choice);
        if (outcome.ok) setRecord(outcome.record);
        else takeBack(outcome.message);
      } catch {
        takeBack("Your answer could not be saved. Try again.");
      } finally {
        setSaving(false);
      }
    },
    [active, flipped, result, saving],
  );

  /** Restore `day`, or reopen it when it was paid for already. Returns why not, or null. */
  async function bringBack(day: string): Promise<string | null> {
    const leftBefore = restores.left;
    try {
      const outcome = await restoreDailyWord(day);
      if (!outcome.ok) return outcome.message;
      setRecord(outcome.record);
      setRestores(outcome.restores);
      if (outcome.restores.left < leftBefore) setXp((value) => value - outcome.restores.cost);
      show(outcome.word);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return null;
    } catch {
      return "That didn't go through. Try again.";
    }
  }

  /** A missed day tapped on the calendar or in the list. */
  async function pick(day: string) {
    const entry = days.get(day);
    if (!entry || entry.result !== null || answers[day]) return;
    if (entry.restored) {
      // Paid for on an earlier visit: straight back to its word.
      setError(null);
      const message = await bringBack(day);
      if (message) setError(message);
      return;
    }
    if (!entry.canRestore) return;
    play("tap");
    setRestoreError(null);
    setAsking(day);
  }

  async function confirmRestore() {
    if (!asking || restoring) return;
    setRestoring(true);
    setRestoreError(null);
    const message = await bringBack(asking);
    setRestoring(false);
    if (message) {
      setRestoreError(message);
      play("wrong");
    } else {
      setAsking(null);
      play("level");
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (asking) return;
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
  }, [answer, asking, flip]);

  const today = data.today;
  const backToToday = today && active && active.day !== today.day ? () => show(today) : null;

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

      {active && late && (
        <div className="flex items-center gap-3 rounded-2xl border border-[#4a3a7a] bg-[#1f1838] px-4 py-3">
          <RestoreIcon className="h-5 w-5 shrink-0 text-restore" />
          <p className="min-w-0 flex-1 text-sm font-bold text-restore">
            Answering {formatDay(active.day, "long")} late
          </p>
          {backToToday && (
            <button
              type="button"
              onClick={backToToday}
              className="shrink-0 text-sm font-extrabold text-ink underline-offset-4 hover:underline"
            >
              Today&apos;s word
            </button>
          )}
        </div>
      )}

      {active ? (
        <>
          <JudgeCard
            key={active.day}
            label={late ? `Word for ${formatDay(active.day, "long")}` : "Word of the day"}
            front={active.front}
            back={active.back}
            deckName={active.deckName}
            badge={late ? restoredBadge(active.day) : BADGE}
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

          {result &&
            (late ? (
              <RestoredBanner
                result={result}
                day={active.day}
                streak={record.streak}
                fresh={justAnswered}
                onBack={backToToday}
              />
            ) : (
              <ResultBanner result={result} streak={record.streak} fresh={justAnswered} />
            ))}
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

      <RecordPanel record={record} restores={restores} onPick={(day) => void pick(day)} />

      {data.history.length > 0 && (
        <History
          words={data.history}
          days={days}
          answers={answers}
          today={record.calendar.at(-1)?.day ?? ""}
          onPick={(day) => void pick(day)}
        />
      )}

      <Sheet open={asking !== null} onClose={() => setAsking(null)} label="Restore a missed day">
        {asking && (
          <RestoreSheet
            day={asking}
            restores={restores}
            xp={xp}
            pending={restoring}
            error={restoreError}
            onConfirm={() => void confirmRestore()}
            onCancel={() => setAsking(null)}
          />
        )}
      </Sheet>
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

/** The answer to a day brought back late. */
function RestoredBanner({
  result,
  day,
  streak,
  fresh,
  onBack,
}: {
  result: WordResult;
  day: string;
  streak: number;
  fresh: boolean;
  onBack: (() => void) | null;
}) {
  const knew = result === "knew";
  const name = formatDay(day, "long");
  return (
    <div
      className={`${fresh ? "anim-pop-in" : ""} space-y-4 rounded-3xl border p-5 text-center ${
        knew ? "border-[#1f6b4f] bg-[#0f2a20]" : "border-[#6b1f30] bg-[#2a0f16]"
      }`}
    >
      <div>
        <p className={`text-2xl font-extrabold ${knew ? "text-good" : "text-again"}`}>
          {knew ? "Day restored!" : "Still a miss"}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          {knew
            ? `${name} counts again${streak > 1 ? `, and you are on ${streak} days in a row` : ""}. It keeps its restored mark.`
            : `${name} stays a miss. Read the word once more before you go.`}
        </p>
      </div>
      {onBack && (
        <button type="button" onClick={onBack} className={`${secondaryButton} w-full`}>
          <SunIcon className="h-5 w-5 text-gold" />
          Back to today&apos;s word
        </button>
      )}
    </div>
  );
}

function RecordPanel({
  record,
  restores,
  onPick,
}: {
  record: WordRecord;
  restores: RestoreCards;
  onPick: (day: string) => void;
}) {
  const today = record.calendar.at(-1)?.day ?? restores.renewsOn;
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
          {record.calendar.map((day) => (
            <DayCell key={day.day} day={day} onPick={onPick} />
          ))}
        </ol>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-good" /> Knew it
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-again" /> Missed it
          </span>
          <span className="flex items-center gap-1.5">
            <RestoreMark /> Restored late
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-surface-high" /> Not played
          </span>
        </p>
      </div>
      <RestoreShelf restores={restores} today={today} />
    </section>
  );
}

/** The little badge a restored day wears. */
function RestoreMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`flex h-4 w-4 items-center justify-center rounded-full bg-restore text-restore-ink ${className}`}
      aria-hidden="true"
    >
      <RestoreIcon className="h-2.5 w-2.5" />
    </span>
  );
}

function DayCell({ day, onPick }: { day: CalendarDay; onPick: (day: string) => void }) {
  const waiting = day.restored && day.result === null;
  let tone = "bg-surface-high text-ink-muted";
  if (day.result === "knew") {
    tone = day.restored ? "border-2 border-good bg-good/15 text-good" : "bg-good text-paper-ink";
  } else if (day.result === "missed") {
    tone = day.restored ? "border-2 border-again bg-again/15 text-again" : "bg-again text-paper-ink";
  } else if (waiting) {
    tone = "border-2 border-dashed border-restore bg-restore/10 text-restore";
  } else if (day.canRestore) {
    tone = "border border-dashed border-restore/45 bg-surface-high text-ink-muted";
  } else if (day.isToday) {
    tone = "border-2 border-dashed border-gold text-gold";
  }

  let status = "not played";
  if (day.result) status = `${day.result === "knew" ? "knew it" : "missed it"}${day.restored ? ", restored late" : ""}`;
  else if (waiting) status = "restored, answer still to come";
  else if (day.canRestore) status = "missed, tap to restore";

  const cell = `relative flex aspect-square w-full flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-extrabold tabular-nums ${tone}`;
  const label = `${formatDay(day.day)}: ${status}`;

  if (day.canRestore || waiting) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onPick(day.day)}
          className={`${cell} transition hover:ring-2 hover:ring-restore active:scale-95`}
          title={label}
          aria-label={label}
        >
          {day.date}
          {day.canRestore && <RestoreIcon className="h-2.5 w-2.5 text-restore/80" />}
          {waiting && <RestoreMark className="absolute -top-1.5 -right-1.5" />}
        </button>
      </li>
    );
  }
  return (
    <li className={cell} title={label}>
      {day.date}
      {day.restored && <RestoreMark className="absolute -top-1.5 -right-1.5" />}
    </li>
  );
}

/** Where each card in the hand sits: tilted out to the sides, the middle one raised. */
const FAN = ["-rotate-12 -mr-2.5", "-translate-y-1 -mr-2.5", "rotate-12"];

/** The month's restore cards, fanned out like a hand. A used card leaves an empty outline. */
function RestoreShelf({ restores, today }: { restores: RestoreCards; today: string }) {
  const days = daysBetween(today, restores.renewsOn);
  const refill = days === 1 ? "refills tomorrow" : `refills in ${days} days`;
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-surface-high px-4 py-3">
      <div className="flex shrink-0 pt-1.5 pr-1 pb-0.5 pl-1.5" aria-hidden="true">
        {Array.from({ length: restores.perMonth }, (_, slot) => (
          <span
            key={slot}
            className={`relative flex h-[52px] w-[38px] items-center justify-center rounded-[9px] border-2 transition-colors ${
              FAN[slot % FAN.length]
            } ${
              slot < restores.left
                ? "border-surface-high bg-restore text-restore-ink shadow-[0_0_16px_-4px_var(--color-restore)]"
                : "border-dashed border-[#3a3458] bg-surface-high text-[#3a3458]"
            }`}
          >
            <RestoreIcon className="h-5 w-5" />
          </span>
        ))}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink-muted">Restore cards</p>
        <p className="leading-tight font-extrabold tabular-nums">
          <span className="text-[1.65rem]">{restores.left}</span>{" "}
          <span className="text-sm font-bold text-ink-muted">of {restores.perMonth} left</span>
        </p>
        <p className="text-xs text-ink-muted">
          {restores.cost.toLocaleString("en-US")} XP each
          <span className="hidden sm:inline"> · </span>
          {/* Its own line on a phone, capitalised there; `::first-letter` skips the inline case. */}
          <span className="block first-letter:uppercase sm:inline">{refill}</span>
        </p>
      </div>
    </div>
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

/** The round badge at the start of a history row. A late answer wears the clock badge on its corner. */
function ResultDot({ result, restored }: { result: WordResult | null; restored: boolean }) {
  let tone = "bg-surface-high text-ink-muted";
  if (result === "knew") tone = "bg-good text-paper-ink";
  else if (result === "missed") tone = "bg-again text-paper-ink";
  else if (restored) tone = "border-2 border-dashed border-restore text-restore";

  let label = result === "knew" ? "Knew it" : result === "missed" ? "Missed it" : "Not played";
  if (restored) label += result ? ", restored late" : ", restored";

  return (
    <span
      className={`relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone}`}
      aria-label={label}
    >
      {restored && result && <RestoreMark className="absolute -top-1.5 -right-1.5 ring-2 ring-surface-raised" />}
      {result === "knew" ? (
        <CheckIcon className="h-4 w-4" />
      ) : result === "missed" ? (
        <CloseIcon className="h-4 w-4" />
      ) : restored ? (
        <RestoreIcon className="h-4 w-4" />
      ) : (
        <span className="text-xs font-extrabold">–</span>
      )}
    </span>
  );
}

function History({
  words,
  days,
  answers,
  today,
  onPick,
}: {
  words: DailyWordView[];
  days: ReadonlyMap<string, CalendarDay>;
  answers: Record<string, WordResult>;
  /** YYYY-MM-DD on the player's calendar. */
  today: string;
  onPick: (day: string) => void;
}) {
  return (
    <section className={`${panel} space-y-3`}>
      <h2 className="text-lg font-extrabold">Earlier words</h2>
      <ul className="divide-y divide-border-subtle">
        {words.map((word) => {
          const day = days.get(word.day);
          const result = answers[word.day] ?? day?.result ?? word.result;
          const restored = day?.restored ?? word.restored;
          const waiting = restored && result === null;
          const canRestore = !result && (day?.canRestore ?? false);
          return (
            <li key={word.day} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <ResultDot result={result} restored={restored} />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-extrabold">{word.front}</span>
                  <span className="shrink-0 text-xs text-ink-muted">{formatDay(word.day)}</span>
                </p>
                {restored && result && (
                  // A restore made on this visit may not be on `word` yet: it happened today.
                  <p className="text-xs font-bold text-restore">
                    Restored on {formatDay(word.restoredOn ?? today)}
                  </p>
                )}
                {result ? (
                  <p className="line-clamp-2 text-sm text-ink-muted">{optionText(word.back)}</p>
                ) : (
                  // The meaning stays hidden until the day is answered, so a
                  // restore is still a real test.
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <p className="text-sm text-ink-muted">
                      {waiting
                        ? "Paid for. Your answer is still to come."
                        : canRestore
                          ? "Missed. Restore it to answer."
                          : "Not played."}
                    </p>
                    {(waiting || canRestore) && (
                      <button
                        type="button"
                        onClick={() => onPick(word.day)}
                        aria-label={`${waiting ? "Answer" : "Restore"} ${formatDay(word.day, "long")}`}
                        title={waiting ? "Answer it" : "Restore"}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-restore text-restore-ink transition hover:brightness-110 active:scale-90"
                      >
                        {waiting ? <PlayIcon className="h-4 w-4" /> : <RestoreIcon className="h-5 w-5" />}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Link href="/" className={`${secondaryButton} w-full`}>
        <HomeIcon className="h-5 w-5" />
        Home
      </Link>
    </section>
  );
}

/** Asks before spending a restore card: it is a lot of XP to lose to a stray tap. */
function RestoreSheet({
  day,
  restores,
  xp,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  day: string;
  restores: RestoreCards;
  xp: number;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const refusal = cannotRestore(restores.perMonth - restores.left, xp);
  const price = `${restores.cost.toLocaleString("en-US")} XP`;
  const problem = error ?? refusal;

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-restore text-restore-ink">
          <RestoreIcon className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <h2 className="text-xl leading-tight font-extrabold">Restore {formatDay(day, "long")}?</h2>
          <p className="text-sm text-ink-muted">You never answered this day&apos;s word.</p>
        </div>
      </div>

      <p className="text-ink-muted">
        The word comes back for you to answer now. If you knew it, the day goes back into your streak.
        Either way the day keeps a restored mark, so it never looks like an on-time answer.
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl bg-surface-high px-3 py-3">
          <p className="text-xs font-semibold text-ink-muted">Restore cards</p>
          <p className="mt-1 text-lg font-extrabold text-restore tabular-nums">
            {restores.left} of {restores.perMonth} left
          </p>
          <p className="text-[11px] text-ink-muted">New ones on {formatDay(restores.renewsOn)}</p>
        </div>
        <div className="rounded-2xl bg-surface-high px-3 py-3">
          <p className="text-xs font-semibold text-ink-muted">Costs</p>
          <p className="mt-1 text-lg font-extrabold text-gold tabular-nums">{price}</p>
          <p className="text-[11px] text-ink-muted tabular-nums">You have {xp.toLocaleString("en-US")}</p>
        </div>
      </div>

      {problem && (
        <p role="alert" className="text-sm font-bold text-again">
          {problem}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={refusal !== null || pending}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-restore px-5 text-base font-extrabold text-restore-ink transition active:scale-[0.97] disabled:opacity-50"
        >
          <RestoreIcon className="h-5 w-5" />
          {pending ? "Restoring…" : `Restore · ${price}`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          data-autofocus
          className={`${secondaryButton} flex-none`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
