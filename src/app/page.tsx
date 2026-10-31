import Link from "next/link";

import { DeckForm } from "@/components/deck-form";
import { GoalRing, LevelBar } from "@/components/game/hud";
import { GoalStepper } from "@/components/goal-stepper";
import {
  BoltIcon,
  CheckIcon,
  FlameIcon,
  GearIcon,
  HelpIcon,
  PlayIcon,
  StarIcon,
  SwapIcon,
} from "@/components/icons";
import { SetupNotice } from "@/components/setup-notice";
import { panel } from "@/components/ui";
import { MIN_BLITZ_CARDS } from "@/lib/blitz";
import { listDecks, type DeckSummary } from "@/lib/decks";
import { requestTimeZone } from "@/lib/request-time-zone";
import { getPlayerStats, type PlayerStats } from "@/lib/stats";

/**
 * The deck list is live data: due counts change as cards come due, with no
 * request touching this page. Without this the route is prerendered at build
 * time, which would freeze the counts -- and bake in the setup screen if the
 * database happened to be unreachable during the build.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const timeZone = await requestTimeZone();

  let decks: DeckSummary[];
  let player: PlayerStats;
  try {
    [decks, player] = await Promise.all([listDecks(), getPlayerStats(timeZone)]);
  } catch (error) {
    // Most likely no MONGODB_URI, a bad password, or an Atlas IP allow-list
    // miss. Say so instead of throwing a stack trace at the user.
    return <SetupNotice error={error} />;
  }

  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(new Date());

  const left = Math.max(0, player.goal - player.today);
  const headline = player.todayDone
    ? "Goal done. Nice work."
    : player.streak > 0
      ? "Keep it burning"
      : "Start a streak today";

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="anim-rise flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-muted">{dateLabel}</p>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{headline}</h1>
        </div>
        <span className="flex items-center gap-2 rounded-full bg-surface-raised px-4 py-2 text-sm font-extrabold text-gold tabular-nums">
          <StarIcon className="h-4 w-4" />
          {player.xp.toLocaleString("en-US")} XP
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[1.25fr_1fr_1fr]">
        <section className="anim-rise flex flex-col gap-4 rounded-3xl border border-[#4a2c18] bg-[#2a1a12] p-5 md:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-4">
            <FlameIcon className="anim-flicker h-14 w-14 shrink-0" lit={player.streak > 0} />
            <div>
              <p className="text-4xl leading-none font-extrabold tracking-tight">
                {player.streak} {player.streak === 1 ? "day" : "days"}
              </p>
              <p className="mt-1 text-sm text-[#f2c9a8]">
                {player.todayDone
                  ? "Today counts. Come back tomorrow to keep it going."
                  : `${left} more ${left === 1 ? "card" : "cards"} today keeps your streak`}
              </p>
            </div>
          </div>
          <ol className="grid grid-cols-7 gap-1.5 text-center" aria-label="This week">
            {player.week.map((day) => (
              <li key={day.day} className="flex flex-col items-center gap-1.5">
                <span
                  className={`text-xs ${day.isToday ? "font-extrabold text-white" : "text-[#f2c9a8]"}`}
                >
                  {day.letter}
                </span>
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full ${
                    day.met
                      ? "bg-flame text-[#2a1a12]"
                      : day.isToday
                        ? "border-[3px] border-dashed border-flame"
                        : "bg-[#3d2618]"
                  }`}
                  title={`${day.count} ${day.count === 1 ? "card" : "cards"}`}
                >
                  {day.met && <CheckIcon className="h-4 w-4" />}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-[#d9b394]">Best streak: {player.bestStreak} days</p>
        </section>

        <section className={`${panel} anim-rise flex flex-col items-center gap-3 text-center`}>
          <GoalRing value={player.today} goal={player.goal} size={104} stroke={12}>
            <span className="text-2xl leading-none font-extrabold tabular-nums">{player.today}</span>
            <span className="text-xs text-ink-muted">of {player.goal}</span>
          </GoalRing>
          <h2 className="text-base font-extrabold">Daily goal</h2>
          <GoalStepper goal={player.goal} />
        </section>

        <section className={`${panel} anim-rise flex flex-col justify-between gap-4`}>
          <div className="flex items-center justify-between">
            <span className="rounded-lg bg-gold px-2.5 py-1 text-sm font-extrabold text-paper-ink">
              Level {player.level}
            </span>
            <span className="text-sm font-semibold text-ink-muted">{player.rank}</span>
          </div>
          <div>
            <p className="text-3xl leading-none font-extrabold tabular-nums">
              {player.levelNeeded - player.levelInto} XP
            </p>
            <p className="mt-1 text-sm text-ink-muted">to level {player.level + 1}</p>
          </div>
          <LevelBar level={player.level} into={player.levelInto} needed={player.levelNeeded} />
        </section>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-extrabold tracking-tight">Your decks</h2>
          <Link
            href="/help"
            className="inline-flex items-center gap-1.5 text-sm font-bold text-gold hover:underline"
          >
            <HelpIcon className="h-4 w-4" />
            How to play
          </Link>
        </div>

        {decks.length === 0 ? (
          <div className={`${panel} text-center`}>
            <p className="font-bold">No decks yet.</p>
            <p className="mt-1 text-sm text-ink-muted">
              Create one below, then add or import some cards.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {decks.map((deck, index) => (
              <DeckTile key={deck.id} deck={deck} delay={index} />
            ))}
          </ul>
        )}
      </section>

      <section className={`${panel} space-y-4`}>
        <h2 className="text-lg font-extrabold">New deck</h2>
        <DeckForm />
      </section>
    </div>
  );
}

function DeckTile({ deck, delay }: { deck: DeckSummary; delay: number }) {
  const due = deck.dueNew + deck.dueLearning + deck.dueReview;
  const mastered = deck.dueReview + deck.scheduled;
  const total = Math.max(1, deck.totalCards);
  const small =
    "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#efeafe] px-3 text-sm font-bold text-[#3c3660] transition hover:bg-[#e4dcfd] active:scale-[0.97]";

  return (
    <li
      className="anim-rise flex min-w-0 flex-col gap-4 rounded-3xl bg-paper p-5 text-paper-ink"
      style={{ animationDelay: `${Math.min(delay, 6) * 60}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/decks/${deck.id}`}
            className="text-xl font-extrabold tracking-tight underline-offset-4 hover:underline"
          >
            {deck.name}
          </Link>
          <p className="mt-0.5 truncate text-sm text-paper-muted">
            {deck.description || `${deck.totalCards} ${deck.totalCards === 1 ? "card" : "cards"}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {due > 0 && (
            <span className="rounded-full bg-[#ffe0e5] px-2.5 py-1 text-xs font-extrabold text-[#a8203a]">
              {due} due
            </span>
          )}
          <Link
            href={`/decks/${deck.id}`}
            aria-label={`Manage ${deck.name}`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-paper-muted transition hover:bg-[#efeafe] hover:text-paper-ink"
          >
            <GearIcon className="h-5 w-5" />
          </Link>
        </div>
      </div>

      {deck.totalCards > 0 && (
        <div className="space-y-1.5">
          <div className="flex h-2.5 gap-[3px] overflow-hidden rounded-full" aria-hidden="true">
            <div className="bg-[#0b8a5a]" style={{ flex: mastered / total }} />
            <div className="bg-[#d42f4f]" style={{ flex: deck.dueLearning / total }} />
            <div className="bg-[#2463d6]" style={{ flex: deck.dueNew / total }} />
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-paper-muted">
            <span>
              <b className="text-[#0b6a45]">{mastered}</b> learned
            </span>
            <span>
              <b className="text-[#a8203a]">{deck.dueLearning}</b> learning
            </span>
            <span>
              <b className="text-[#1f4fb0]">{deck.dueNew}</b> new
            </span>
          </p>
        </div>
      )}

      {due > 0 ? (
        <Link
          href={`/decks/${deck.id}/review`}
          className="inline-flex min-h-14 items-center justify-center gap-2.5 rounded-2xl bg-paper-ink text-lg font-extrabold text-gold transition active:scale-[0.98]"
        >
          <PlayIcon className="h-5 w-5" />
          Play {due} {due === 1 ? "card" : "cards"}
        </Link>
      ) : (
        <p className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-[#d5f7e8] text-base font-extrabold text-[#0b6a45]">
          <CheckIcon className="h-5 w-5" />
          {deck.totalCards === 0 ? "Add cards to start" : "All caught up"}
        </p>
      )}

      {deck.totalCards > 0 && (
        <div className="flex gap-2">
          <Link href={`/decks/${deck.id}/practice`} className={small}>
            <SwapIcon className="h-4 w-4" />
            Practice
          </Link>
          {deck.totalCards >= MIN_BLITZ_CARDS && (
            <Link href={`/decks/${deck.id}/blitz`} className={small}>
              <BoltIcon className="h-4 w-4 text-[#c27a00]" />
              Blitz
              {deck.blitzBest > 0 && (
                <span className="font-semibold text-paper-muted">
                  {deck.blitzBest.toLocaleString("en-US")}
                </span>
              )}
            </Link>
          )}
        </div>
      )}
    </li>
  );
}
