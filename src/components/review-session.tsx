"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { deleteCardAndContinue, gradeCard, refreshQueue, undoLastGrade } from "@/app/actions";
import { Confetti, Floats, buzz, type FloatText } from "@/components/game/effects";
import { ARROW_KEYS, MOVES, moveFor, type GradeMove } from "@/components/game/grades";
import { GoalRing, LevelBar, MultiplierPill, StreakPill } from "@/components/game/hud";
import { ReviewCard } from "@/components/game/review-card";
import { play, useArmSound } from "@/components/game/sound";
import type { Direction, SwipeFrame } from "@/components/game/use-swipe";
import {
  ArrowIcon,
  BoltIcon,
  FlameIcon,
  HomeIcon,
  SkipIcon,
  SwapIcon,
  TrophyIcon,
  UndoIcon,
} from "@/components/icons";
import { iconButton, panel, primaryButton, secondaryButton } from "@/components/ui";
import { TIER_LABEL } from "@/lib/collection";
import { COMBO_PAUSE_MS, multiplierFor, nextCombo, xpFor } from "@/lib/game";
import type { NextCardResult } from "@/lib/decks";
import { reachedNewTier } from "@/lib/sound";
import type { PlayerStats, SessionResult } from "@/lib/stats";

/** How long the card takes to fly off; the next one waits for it. */
const FLY_MS = 240;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface SessionTally {
  answered: number;
  xp: number;
  bestCombo: number;
}

interface Toast {
  id: number;
  title: string;
  detail: string;
}

/**
 * A review round played as a game.
 *
 * Grading is exactly what it was: each swipe is one `gradeCard` call with the
 * grade it stands for, so the schedule cannot tell a swipe from a button. The
 * game parts (XP, combo, confetti) ride on top and never change when a card
 * comes back. Every answer earns the same XP whatever the grade, so being
 * honest with "Again" costs nothing.
 */
export function ReviewSession({
  deckId,
  deckName,
  initial,
  initialPlayer,
  canBlitz,
  aiVoice,
}: {
  deckId: string;
  deckName: string;
  initial: NextCardResult;
  initialPlayer: PlayerStats;
  canBlitz: boolean;
  /** Read words aloud with the AI voice, falling back to the device's. */
  aiVoice: boolean;
}) {
  const [queue, setQueue] = useState(initial);
  const [player, setPlayer] = useState(initialPlayer);
  const [flipped, setFlipped] = useState(false);
  const [leaving, setLeaving] = useState<Direction | null>(null);
  /** Bumped for every new card, so the same card coming back still remounts. */
  const [turn, setTurn] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Cards put aside for this session only; the server filters them out. */
  const [skipped, setSkipped] = useState<string[]>([]);
  const [aim, setAim] = useState<Direction | null>(null);
  const [combo, setCombo] = useState(0);
  const [tally, setTally] = useState<SessionTally>({ answered: 0, xp: 0, bestCombo: 0 });
  const [floats, setFloats] = useState<FloatText[]>([]);
  const [confetti, setConfetti] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);

  /** When the current card went on screen, for the answer-time log. */
  const shownAt = useRef<number | null>(null);
  const lastAnswerAt = useRef<number | null>(null);
  const comboTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** XP of each answer this session, newest last, so undo can take it back. */
  const earned = useRef<number[]>([]);
  const aimRef = useRef<Direction | null>(null);
  const backdrops = useRef<Partial<Record<Direction, HTMLDivElement | null>>>({});
  const nextId = useRef(1);

  const { card, counts } = queue;
  const remaining = counts.newCards + counts.learning + counts.review;

  useEffect(() => {
    shownAt.current = Date.now();
  }, [card?.id, turn]);

  useEffect(
    () => () => {
      if (comboTimer.current) clearTimeout(comboTimer.current);
    },
    [],
  );

  const paintBackdrop = useCallback((direction: Direction | null, progress: number) => {
    for (const move of MOVES) {
      const layer = backdrops.current[move.direction];
      if (layer) layer.style.opacity = move.direction === direction ? String(progress) : "0";
    }
  }, []);

  const armSound = useArmSound();

  const onFrame = useCallback(
    (frame: SwipeFrame) => {
      paintBackdrop(frame.direction, frame.progress);
      armSound(frame);
      const next = frame.progress > 0 ? frame.direction : null;
      if (next !== aimRef.current) {
        aimRef.current = next;
        setAim(next);
      }
    },
    [armSound, paintBackdrop],
  );

  const flip = useCallback((next: boolean) => {
    play("flip");
    setFlipped(next);
  }, []);

  const float = useCallback((text: string, color: string, top: number, size: number) => {
    const id = nextId.current++;
    setFloats((items) => [...items, { id, text, color, top, size }]);
    setTimeout(() => setFloats((items) => items.filter((item) => item.id !== id)), 1050);
  }, []);

  const showToast = useCallback((title: string, detail: string) => {
    const id = nextId.current++;
    setToast({ id, title, detail });
    setTimeout(() => setToast((current) => (current?.id === id ? null : current)), 2600);
  }, []);

  /** Put a fresh result on screen: new card face down, colours cleared. */
  const apply = useCallback(
    (next: SessionResult) => {
      setQueue(next);
      setPlayer(next.player);
      setFlipped(false);
      setLeaving(null);
      setTurn((value) => value + 1);
      aimRef.current = null;
      setAim(null);
      paintBackdrop(null, 0);
    },
    [paintBackdrop],
  );

  /** Every server round trip except grading: one at a time, errors shown. */
  const run = useCallback(
    async (work: () => Promise<SessionResult>) => {
      if (pending) return;
      setPending(true);
      setError(null);
      try {
        apply(await work());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Something went wrong.");
      } finally {
        setPending(false);
      }
    },
    [apply, pending],
  );

  const answer = useCallback(
    async (move: GradeMove) => {
      if (!card || pending || !flipped) return;
      const now = Date.now();
      const nowCombo = nextCombo(combo, lastAnswerAt.current, now);
      const gained = xpFor(nowCombo);
      const elapsedMs = shownAt.current === null ? null : now - shownAt.current;

      setPending(true);
      setError(null);
      setLeaving(move.direction);
      aimRef.current = move.direction;
      setAim(move.direction);
      paintBackdrop(move.direction, 1);
      buzz(12);
      play(move.grade, nowCombo);
      if (reachedNewTier(nowCombo)) play("combo", 1, 220);
      float(`+${gained} XP`, "#FFD24A", 120, 30);
      if (nowCombo >= 3) float(`${nowCombo} in a row`, "#FF8A3D", 170, 19);

      try {
        const [result] = await Promise.all([
          gradeCard(card.id, move.grade, elapsedMs, { exclude: skipped }, nowCombo),
          sleep(FLY_MS),
        ]);

        lastAnswerAt.current = now;
        earned.current.push(gained);
        setCombo(nowCombo);
        if (comboTimer.current) clearTimeout(comboTimer.current);
        // A long pause ends the run of answers; show that as it happens.
        comboTimer.current = setTimeout(() => setCombo(0), COMBO_PAUSE_MS);
        setTally((current) => ({
          answered: current.answered + 1,
          xp: current.xp + gained,
          bestCombo: Math.max(current.bestCombo, nowCombo),
        }));

        let celebrated = true;
        if (result.player.level > player.level) {
          setConfetti((value) => value + 1);
          buzz(40);
          play("level");
          showToast(`Level ${result.player.level}!`, `You are now a ${result.player.rank}.`);
        } else if (result.player.todayDone && !player.todayDone) {
          setConfetti((value) => value + 1);
          buzz(40);
          play("goal");
          showToast(
            "Daily goal done!",
            `${result.player.streak} ${result.player.streak === 1 ? "day" : "days"} in a row.`,
          );
        } else if (result.rankUp && result.rankUp.tier !== "bronze") {
          setConfetti((value) => value + 1);
          buzz(30);
          play("level");
          showToast(
            `${TIER_LABEL[result.rankUp.tier]} word!`,
            `“${result.rankUp.front}” moved up in your collection.`,
          );
        } else if (result.rankUp) {
          play("combo");
          showToast("New word collected", `“${result.rankUp.front}” is now Bronze.`);
        } else if (nowCombo % 10 === 0) {
          setConfetti((value) => value + 1);
          play("combo");
          showToast(`${nowCombo} in a row!`, "Keep the run going.");
        } else {
          celebrated = false;
        }
        // Last card of the round: the round-clear tune, after any fanfare above.
        if (!result.card) play("clear", 1, celebrated ? 1100 : 150);

        apply(result);
      } catch (cause) {
        setLeaving(null);
        paintBackdrop(null, 0);
        setError(cause instanceof Error ? cause.message : "Something went wrong.");
      } finally {
        setPending(false);
      }
    },
    [apply, card, combo, flipped, float, paintBackdrop, pending, player, showToast, skipped],
  );

  const onSwipe = useCallback((direction: Direction) => void answer(moveFor(direction)), [answer]);

  const undo = useCallback(() => {
    if (pending) return;
    play("undo");
    void run(async () => {
      const result = await undoLastGrade(deckId, { exclude: skipped });
      const taken = earned.current.pop();
      if (taken !== undefined) {
        setTally((current) => ({ ...current, answered: current.answered - 1, xp: current.xp - taken }));
      }
      setCombo((value) => Math.max(0, value - 1));
      return result;
    });
  }, [deckId, pending, run, skipped]);

  const skip = useCallback(() => {
    if (!card || pending) return;
    play("skip");
    const next = [...skipped, card.id];
    setSkipped(next);
    void run(() => refreshQueue(deckId, { exclude: next }));
  }, [card, deckId, pending, run, skipped]);

  const refresh = useCallback(() => {
    void run(() => refreshQueue(deckId, { exclude: skipped }));
  }, [deckId, run, skipped]);

  const unskip = useCallback(() => {
    setSkipped([]);
    void run(() => refreshQueue(deckId, { exclude: [] }));
  }, [deckId, run]);

  const removeCard = useCallback(() => {
    if (!card) return;
    if (!window.confirm("Delete this card for good? Its history goes with it.")) return;
    void run(() => deleteCardAndContinue(card.id, deckId, { exclude: skipped }));
  }, [card, deckId, run, skipped]);

  // Space or Enter flips. Once face up, the arrows answer the way a swipe
  // would (left Again, down Hard, right Good, up Easy), and so do 1-4.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!card) return;

      const key = event.key.toLowerCase();
      if (key === "u") {
        event.preventDefault();
        if (queue.reviewedToday > 0) undo();
        return;
      }
      if (key === "s") {
        event.preventDefault();
        skip();
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        // Let a focused button or link handle its own key.
        if (target?.closest("button, a")) return;
        event.preventDefault();
        if (!pending && leaving === null) flip(!flipped);
        return;
      }

      const direction = ARROW_KEYS[event.key];
      const move = direction ? moveFor(direction) : MOVES.find((entry) => entry.key === event.key);
      if (move) {
        event.preventDefault();
        if (flipped) void answer(move);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answer, card, flip, flipped, leaving, pending, queue.reviewedToday, skip, undo]);

  const progress = tally.answered / Math.max(1, tally.answered + remaining);

  return (
    <div className="relative">
      {/* The whole screen takes on the colour of the answer you lean toward. */}
      {MOVES.map((move) => (
        <div
          key={move.direction}
          ref={(element) => {
            backdrops.current[move.direction] = element;
          }}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 opacity-0 transition-opacity duration-300"
          style={{
            background: `radial-gradient(110% 70% at 50% 42%, ${move.color}55, ${move.color}12 55%, transparent 80%)`,
          }}
        />
      ))}

      <Confetti fire={confetti} />

      {/* Just under the header: centred on a phone, in the top-left corner on a wide screen. */}
      {toast && (
        <div
          key={`toast-${toast.id}`}
          role="status"
          className="anim-pop-in pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+1rem)] z-40 md:top-[calc(env(safe-area-inset-top)+4.5rem)] mx-auto w-fit max-w-[calc(100%-2rem)] origin-top rounded-2xl bg-gold px-5 py-3 text-center text-paper-ink shadow-[0_12px_30px_-8px_rgba(0,0,0,.6)] lg:right-auto lg:left-6 lg:mx-0 lg:max-w-sm lg:origin-top-left lg:text-left"
        >
          <p className="text-lg leading-tight font-extrabold">{toast.title}</p>
          <p className="text-sm font-semibold">{toast.detail}</p>
        </div>
      )}

      {!card ? (
        <RoundClear
          deckId={deckId}
          deckName={deckName}
          queue={queue}
          player={player}
          tally={tally}
          skippedCount={skipped.length}
          canBlitz={canBlitz}
          busy={pending}
          onRefresh={refresh}
          onUnskip={unskip}
          onUndo={undo}
        />
      ) : (
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
          <section className="mx-auto flex w-full max-w-md flex-col gap-4 lg:max-w-lg">
            <div className="flex items-center gap-2.5">
              <Link href="/" className={iconButton} aria-label="Back to home">
                <ArrowIcon direction="left" className="h-5 w-5" />
              </Link>
              <StreakPill streak={player.streak} lit={player.todayDone} />
              <LevelBar level={player.level} into={player.levelInto} needed={player.levelNeeded} />
              <MultiplierPill multiplier={multiplierFor(combo + 1)} pulseKey={combo} />
            </div>

            <div
              className="h-1.5 overflow-hidden rounded-full bg-surface-raised"
              role="progressbar"
              aria-label="Round progress"
              aria-valuemin={0}
              aria-valuemax={tally.answered + remaining}
              aria-valuenow={tally.answered}
            >
              <div
                className="h-full rounded-full bg-good transition-[width] duration-500"
                style={{ width: `${progress * 100}%` }}
              />
            </div>

            <div className="relative mb-3 h-[clamp(18rem,calc(100dvh-24rem),27rem)]">
              {/* The rest of the round, stacked behind the card. */}
              {remaining > 2 && (
                <div className="absolute inset-0 translate-y-10 scale-[0.9] rounded-[28px] bg-paper/20" />
              )}
              {remaining > 1 && (
                <div className="absolute inset-0 translate-y-5 scale-[0.95] rounded-[28px] bg-paper/45" />
              )}
              <ReviewCard
                key={`${card.id}-${turn}`}
                card={card}
                flipped={flipped}
                onFlip={flip}
                leaving={leaving}
                disabled={pending}
                onFrame={onFrame}
                onSwipe={onSwipe}
                position={tally.answered + 1}
                total={tally.answered + remaining}
                deckId={deckId}
                deckName={deckName}
                onDelete={removeCard}
                aiVoice={aiVoice}
              />

              <Floats items={floats} />
            </div>

            {flipped ? (
              <TimeHints previews={card.previews} aim={aim} onAnswer={(move) => void answer(move)} />
            ) : (
              <button
                type="button"
                onClick={() => flip(true)}
                disabled={pending}
                className={`${primaryButton} min-h-16 w-full text-lg`}
              >
                Show answer
                <kbd className="hidden rounded-md bg-paper-ink/15 px-1.5 py-0.5 text-xs font-bold sm:inline">
                  Space
                </kbd>
              </button>
            )}

            <div className="flex items-center gap-2 text-sm">
              <button
                type="button"
                onClick={undo}
                disabled={pending || queue.reviewedToday === 0}
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 font-bold text-ink-muted transition hover:bg-surface-raised hover:text-ink disabled:opacity-30"
                title="Undo last answer (U)"
              >
                <UndoIcon className="h-4 w-4" />
                Undo
              </button>
              <p className="min-w-0 flex-1 text-center text-xs text-ink-muted lg:hidden">
                <CountsLine counts={counts} />
                {skipped.length > 0 && (
                  <>
                    {" · "}
                    <button type="button" onClick={unskip} className="underline underline-offset-4">
                      {skipped.length} skipped
                    </button>
                  </>
                )}
              </p>
              <span className="hidden flex-1 lg:block" />
              <button
                type="button"
                onClick={skip}
                disabled={pending}
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 font-bold text-ink-muted transition hover:bg-surface-raised hover:text-ink disabled:opacity-30"
                title="Skip for now (S)"
              >
                Skip
                <SkipIcon className="h-4 w-4" />
              </button>
            </div>

            {error !== null && (
              <p
                role="alert"
                className="rounded-2xl border border-again/40 bg-again/10 px-4 py-3 text-center text-sm text-again"
              >
                {error}
              </p>
            )}
          </section>

          <SidePanel
            player={player}
            tally={tally}
            counts={counts}
            skippedCount={skipped.length}
            onUnskip={unskip}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Where each swipe sends the card, shown once it is face up. These are labels,
 * not buttons: you answer by swiping (or with the keys). The one you are
 * dragging toward lights up. Screen-reader and keyboard users still get real
 * buttons, which only show when one of them has focus.
 */
function TimeHints({
  previews,
  aim,
  onAnswer,
}: {
  previews: Record<GradeMove["grade"], string>;
  aim: Direction | null;
  onAnswer: (move: GradeMove) => void;
}) {
  return (
    <div className="anim-rise">
      <ul className="grid grid-cols-4 gap-2" aria-label="When each answer brings the card back">
        {MOVES.map((move) => {
          const on = aim === move.direction;
          return (
            <li
              key={move.grade}
              className={`flex min-w-0 flex-col items-center gap-0.5 rounded-2xl py-2.5 transition duration-150 ${
                on ? "scale-105" : ""
              }`}
              style={{
                background: on ? move.color : "#1B1830",
                color: on ? "#16122B" : move.color,
                boxShadow: on ? `0 10px 28px -8px ${move.color}` : undefined,
              }}
            >
              <span className="flex items-center gap-1 text-base leading-none font-extrabold whitespace-nowrap tabular-nums">
                <ArrowIcon direction={move.direction} className="h-3.5 w-3.5 shrink-0" />
                {previews[move.grade]}
              </span>
              <span className="text-[11px] font-bold opacity-85">{move.label}</span>
            </li>
          );
        })}
      </ul>
      <div
        className="sr-only grid-cols-4 gap-2 focus-within:not-sr-only focus-within:mt-2 focus-within:grid"
        role="group"
        aria-label="Answer"
      >
        {MOVES.map((move) => (
          <button
            key={move.grade}
            type="button"
            onClick={() => onAnswer(move)}
            className="rounded-xl border border-border-subtle bg-surface-raised px-2 py-2 text-sm font-bold"
          >
            {move.label}, back in {previews[move.grade]}
          </button>
        ))}
      </div>
    </div>
  );
}

function CountsLine({ counts }: { counts: NextCardResult["counts"] }) {
  return (
    <>
      <b className="text-easy">{counts.newCards}</b> new · <b className="text-again">{counts.learning}</b>{" "}
      learning · <b className="text-good">{counts.review}</b> review
    </>
  );
}

/** Desktop only: today's goal, this round so far, and the keys. */
function SidePanel({
  player,
  tally,
  counts,
  skippedCount,
  onUnskip,
}: {
  player: PlayerStats;
  tally: SessionTally;
  counts: NextCardResult["counts"];
  skippedCount: number;
  onUnskip: () => void;
}) {
  const keys: Array<[string, string]> = [
    ["Space", "Flip the card"],
    ["←  1", "Again"],
    ["↓  2", "Hard"],
    ["→  3", "Good"],
    ["↑  4", "Easy"],
    ["U", "Undo"],
    ["S", "Skip for now"],
  ];

  return (
    <aside className="sticky top-24 hidden flex-col gap-4 lg:flex">
      <div className={`${panel} flex items-center gap-4`}>
        <GoalRing value={player.today} goal={player.goal} size={84} stroke={10}>
          <span className="text-xl leading-none font-extrabold tabular-nums">{player.today}</span>
          <span className="text-[11px] text-ink-muted">of {player.goal}</span>
        </GoalRing>
        <div>
          <p className="font-extrabold">Today</p>
          <p className="mt-0.5 flex items-center gap-1 text-sm text-ink-muted">
            <FlameIcon className="h-4 w-4" lit={player.todayDone} />
            {player.todayDone
              ? "Goal done"
              : `${Math.max(0, player.goal - player.today)} to keep your streak`}
          </p>
        </div>
      </div>

      <div className={`${panel} space-y-3`}>
        <p className="text-sm font-extrabold">This round</p>
        <dl className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Cards" value={tally.answered} />
          <Stat label="XP" value={tally.xp} />
          <Stat label="Best run" value={tally.bestCombo} />
        </dl>
        <p className="text-center text-xs text-ink-muted">
          <CountsLine counts={counts} />
          {skippedCount > 0 && (
            <>
              {" · "}
              <button type="button" onClick={onUnskip} className="underline underline-offset-4">
                {skippedCount} skipped
              </button>
            </>
          )}
        </p>
      </div>

      <div className={`${panel} space-y-2`}>
        <p className="text-sm font-extrabold">Keys</p>
        <ul className="space-y-1.5 text-sm">
          {keys.map(([key, action]) => (
            <li key={key} className="flex items-center justify-between gap-3">
              <span className="text-ink-muted">{action}</span>
              <kbd className="rounded-lg bg-surface-high px-2 py-0.5 font-sans text-xs font-bold whitespace-pre">
                {key}
              </kbd>
            </li>
          ))}
        </ul>
        <Link href="/help" className="block pt-1 text-sm font-bold text-gold hover:underline">
          How to play
        </Link>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-surface-high px-2 py-3">
      <dd className="text-2xl leading-none font-extrabold tabular-nums">{value}</dd>
      <dt className="mt-1 text-[11px] font-semibold text-ink-muted">{label}</dt>
    </div>
  );
}

/**
 * Nothing left to answer. After a round it is a victory screen; with nothing
 * due from the start it just says so. If a learning card is a minute away,
 * count down to it and pull it in when it lands.
 */
function RoundClear({
  deckId,
  deckName,
  queue,
  player,
  tally,
  skippedCount,
  canBlitz,
  busy,
  onRefresh,
  onUnskip,
  onUndo,
}: {
  deckId: string;
  deckName: string;
  queue: NextCardResult;
  player: PlayerStats;
  tally: SessionTally;
  skippedCount: number;
  canBlitz: boolean;
  busy: boolean;
  onRefresh: () => void;
  onUnskip: () => void;
  onUndo: () => void;
}) {
  const { nextDueAtMs, reviewedToday } = queue;
  const now = useNow();
  const remainingMs = nextDueAtMs !== null && now !== null ? nextDueAtMs - now : null;
  const played = tally.answered > 0;

  // Wake up when the soonest card comes due and pull it in. Keyed on the due
  // time alone, so a refresh that changes nothing does not schedule another.
  const latestRefresh = useRef(onRefresh);
  useEffect(() => {
    latestRefresh.current = onRefresh;
  });
  useEffect(() => {
    if (nextDueAtMs === null) return;
    const timer = setTimeout(
      () => latestRefresh.current(),
      Math.max(0, nextDueAtMs - Date.now()) + 250,
    );
    return () => clearTimeout(timer);
  }, [nextDueAtMs]);

  const title = skippedCount > 0 ? "Only skipped cards left" : played ? "Round clear!" : "All caught up";

  return (
    <div className="relative mx-auto max-w-lg space-y-5 text-center">
      <Confetti fire={played ? 1 : 0} />
      <div className="anim-pop-in mx-auto flex h-24 w-24 items-center justify-center rounded-[28px] bg-gold text-paper-ink shadow-[0_18px_40px_-12px_rgba(255,210,74,.55)]">
        <TrophyIcon className="h-12 w-12" />
      </div>
      <div className="anim-rise">
        <h1 className="text-4xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-2 text-ink-muted">
          {played
            ? `${deckName}: every card due right now is done.`
            : `Nothing in ${deckName} is due right now.`}
        </p>
        {remainingMs !== null && remainingMs > 0 && (
          <p className="mt-2 text-sm text-ink-muted">
            Next card in <b className="text-ink tabular-nums">{countdown(remainingMs)}</b>
          </p>
        )}
      </div>

      {played && (
        <dl className="anim-rise grid grid-cols-3 gap-3">
          <BigStat label="Cards" value={tally.answered} color="text-good" />
          <BigStat label="XP earned" value={tally.xp} color="text-gold" />
          <BigStat label="Best run" value={tally.bestCombo} color="text-flame" />
        </dl>
      )}

      <div className={`${panel} anim-rise flex items-center gap-4 text-left`}>
        <GoalRing value={player.today} goal={player.goal} size={72} stroke={9}>
          <span className="text-lg leading-none font-extrabold tabular-nums">{player.today}</span>
        </GoalRing>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-extrabold">
            <FlameIcon className="h-5 w-5" lit={player.todayDone} />
            {player.streak} {player.streak === 1 ? "day" : "days"} in a row
          </p>
          <p className="mt-0.5 text-sm text-ink-muted">
            {player.todayDone
              ? "Today's goal is done."
              : `${Math.max(0, player.goal - player.today)} more today keeps the streak.`}
          </p>
          <div className="mt-2">
            <LevelBar level={player.level} into={player.levelInto} needed={player.levelNeeded} />
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Link href="/" className={`${primaryButton} sm:col-span-2`}>
          <HomeIcon className="h-5 w-5" />
          Home
        </Link>
        {/* Nothing is due, which is exactly when a no-stakes run is wanted. */}
        <Link href={`/decks/${deckId}/practice`} className={secondaryButton}>
          <SwapIcon className="h-5 w-5" />
          Practice anyway
        </Link>
        {canBlitz && (
          <Link href={`/decks/${deckId}/blitz`} className={secondaryButton}>
            <BoltIcon className="h-5 w-5 text-gold" />
            Blitz
          </Link>
        )}
        {skippedCount > 0 && (
          <button type="button" onClick={onUnskip} disabled={busy} className={secondaryButton}>
            Bring back {skippedCount} skipped
          </button>
        )}
        {reviewedToday > 0 && (
          <button type="button" onClick={onUndo} disabled={busy} className={secondaryButton}>
            <UndoIcon className="h-5 w-5" />
            Undo last answer
          </button>
        )}
      </div>
    </div>
  );
}

function BigStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-3xl bg-surface-raised px-2 py-4">
      <dd className={`text-3xl leading-none font-extrabold tabular-nums ${color}`}>{value}</dd>
      <dt className="mt-1.5 text-xs font-semibold text-ink-muted">{label}</dt>
    </div>
  );
}

/**
 * The current time, ticking once a second, or null on the server and during
 * hydration -- rendering a clock server-side would only mismatch.
 */
function useNow(intervalMs = 1000): number | null {
  const cached = useRef<number | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      cached.current = Date.now();
      const timer = setInterval(() => {
        cached.current = Date.now();
        onStoreChange();
      }, intervalMs);
      return () => clearInterval(timer);
    },
    [intervalMs],
  );

  return useSyncExternalStore(
    subscribe,
    () => cached.current,
    () => null,
  );
}

function countdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${String(totalSeconds % 60).padStart(2, "0")}s`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.round(hours / 24)}d`;
}
