"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { answerBossFight } from "@/app/actions";
import { buzz, Confetti } from "@/components/game/effects";
import { JudgeButtons, JudgeCard } from "@/components/game/judge-card";
import { play } from "@/components/game/sound";
import { ArrowIcon, BossIcon, FlipIcon, HeartIcon, StarIcon, TrophyIcon } from "@/components/icons";
import { iconButton, panel, primaryButton } from "@/components/ui";
import { optionText } from "@/lib/blitz";
import { BOSS_DAYS, BOSS_HEARTS, BOSS_MIN_LAPSES, BOSS_XP, type BossStatus } from "@/lib/boss";
import type { BossScreen, BossView, Trophy } from "@/lib/boss-db";
import { daysBetween, formatDay } from "@/lib/game";
import type { WordResult } from "@/lib/word-of-the-day";

const BADGE = (
  <span className="flex items-center gap-1.5 rounded-full bg-[#ffe0e5] px-2.5 py-1 text-[#a8203a]">
    <BossIcon className="h-3.5 w-3.5" />
    Boss
  </span>
);

/**
 * The boss fight: a word you keep forgetting, back for a week. Once a day,
 * read it, flip, and say honestly whether you knew it. Three days in a row
 * beats it. Nothing here touches the card's schedule.
 */
export function BossFight({ data, aiVoice }: { data: BossScreen; aiVoice: boolean }) {
  const { boss, today } = data;
  const [status, setStatus] = useState<BossStatus | null>(boss?.status ?? null);
  const [flipped, setFlipped] = useState(boss?.status.today != null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confetti, setConfetti] = useState(0);
  const [justAnswered, setJustAnswered] = useState(false);
  const [wonNow, setWonNow] = useState(false);

  const result = status?.today ?? null;
  const fighting = boss !== null && status?.phase === "fighting";

  const flip = useCallback(() => {
    if (!fighting || !status?.canFight) return;
    setFlipped((was) => !was);
    play("flip");
  }, [fighting, status]);

  const answer = useCallback(
    async (choice: WordResult) => {
      if (!boss || !status?.canFight || saving || !flipped) return;
      const before = status;
      setSaving(true);
      setError(null);
      setJustAnswered(true);
      setStatus({ ...status, today: choice, canFight: false });
      if (choice === "knew") {
        play("good");
        buzz(10);
      } else {
        play("again");
        buzz(40);
      }
      try {
        const outcome = await answerBossFight(boss.startDay, today, choice);
        if (outcome.ok) {
          setStatus(outcome.status);
          if (outcome.defeated) {
            setWonNow(true);
            setConfetti((value) => value + 1);
            play("level", 1, 250);
            buzz(60);
          }
        } else {
          setStatus(before);
          setJustAnswered(false);
          setError(outcome.message);
        }
      } catch {
        setStatus(before);
        setJustAnswered(false);
        setError("Your answer could not be saved. Try again.");
      } finally {
        setSaving(false);
      }
    },
    [boss, flipped, saving, status, today],
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

  // A boss beaten on an earlier day: show the win, not the card.
  const beatenBefore = boss !== null && status?.phase === "defeated" && result === null;
  const trophies =
    wonNow && boss
      ? [
          {
            startDay: boss.startDay,
            front: boss.front,
            back: boss.back,
            deckName: boss.deckName,
            lapses: boss.lapses,
            defeatedOn: today,
          },
          ...data.trophies.filter((trophy) => trophy.startDay !== boss.startDay),
        ]
      : data.trophies;

  return (
    <div className="relative mx-auto max-w-lg space-y-5">
      <Confetti fire={confetti} />

      <div className="flex items-center gap-2.5">
        <Link href="/" className={iconButton} aria-label="Back to home">
          <ArrowIcon direction="left" className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl leading-tight font-extrabold tracking-tight">Boss fight</h1>
          <p className="truncate text-sm text-ink-muted">{subtitle(boss, status, today)}</p>
        </div>
      </div>

      {boss && status ? (
        beatenBefore ? (
          <BeatenPanel boss={boss} nextBossDay={status.nextBossDay} />
        ) : (
          <>
            <HealthBar status={status} />

            <JudgeCard
              label="Boss"
              front={boss.front}
              back={boss.back}
              deckName={boss.deckName}
              badge={BADGE}
              question={`Forgotten ${boss.lapses} times`}
              flipped={flipped}
              result={result}
              onFlip={flip}
              onAnswer={(choice) => void answer(choice)}
              aiVoice={aiVoice}
            />

            {status.canFight && !flipped && (
              <button type="button" onClick={flip} className={`${primaryButton} min-h-16 w-full text-lg`}>
                <FlipIcon className="h-5 w-5" />
                Show the meaning
                <kbd className="hidden rounded-md bg-paper-ink/15 px-1.5 py-0.5 text-xs font-bold sm:inline">
                  Space
                </kbd>
              </button>
            )}

            {status.canFight && flipped && (
              <JudgeButtons
                prompt="Did you know it? Only an honest hit counts."
                disabled={saving}
                onAnswer={(choice) => void answer(choice)}
              />
            )}

            {error && <p className="text-center text-sm font-bold text-again">{error}</p>}

            {result && <FightBanner status={status} result={result} fresh={justAnswered} front={boss.front} />}
          </>
        )
      ) : (
        <NoBoss closest={data.closest} />
      )}

      <Rules />

      <TrophyCase trophies={trophies} escaped={data.escaped} />
    </div>
  );
}

function subtitle(boss: BossView | null, status: BossStatus | null, today: string): string {
  if (!boss || !status) return "Words you keep forgetting, back to be beaten";
  if (status.phase === "defeated") return `Beaten. The next boss comes ${formatDay(status.nextBossDay, "long")}`;
  if (status.daysLeft <= 1) return "It gets away tonight";
  return `It gets away after ${formatDay(boss.endDay, "long")} · day ${daysBetween(boss.startDay, today) + 1} of ${BOSS_DAYS}`;
}

/** The boss's hearts, and how many days in a row are still needed. */
function HealthBar({ status }: { status: BossStatus }) {
  const hits = BOSS_HEARTS - status.hearts;
  return (
    <section className="flex items-center gap-4 rounded-3xl border border-[#6b1f30] bg-[#2a0f16] p-4">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#3d1420] text-again">
        <BossIcon className="h-9 w-9" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-extrabold tracking-wide text-[#ffb3c0] uppercase">Boss health</p>
        <p className="mt-1 flex gap-1" aria-label={`${status.hearts} of ${BOSS_HEARTS} hearts left`}>
          {Array.from({ length: BOSS_HEARTS }, (_, index) => (
            <HeartIcon key={index} full={index < status.hearts} className="h-7 w-7" />
          ))}
        </p>
      </div>
      <p className="shrink-0 text-right text-sm text-[#f2c0c9]">
        <b className="block text-2xl leading-none font-extrabold text-white tabular-nums">
          {hits}/{BOSS_HEARTS}
        </b>
        days in a row
      </p>
    </section>
  );
}

function FightBanner({
  status,
  result,
  fresh,
  front,
}: {
  status: BossStatus;
  result: WordResult;
  fresh: boolean;
  front: string;
}) {
  const pop = fresh ? "anim-pop-in" : "";
  if (status.phase === "defeated") {
    return (
      <div className={`${pop} rounded-3xl border border-[#5c4a14] bg-[#272010] p-5 text-center`}>
        <TrophyIcon className="mx-auto h-10 w-10 text-gold" />
        <p className="mt-2 text-2xl font-extrabold text-gold">Boss beaten!</p>
        <p className="mt-1 flex items-center justify-center gap-1.5 font-extrabold text-gold">
          <StarIcon className="h-4 w-4" />+{BOSS_XP} XP
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          “{front}” is in your trophy case. The next boss comes {formatDay(status.nextBossDay, "long")}.
        </p>
      </div>
    );
  }

  const knew = result === "knew";
  const tomorrow = status.winnable
    ? "Come back tomorrow. Skip a day and it heals."
    : "Not enough days left to beat it this time. It will be back.";
  return (
    <div
      className={`${pop} rounded-3xl border p-5 text-center ${
        knew ? "border-[#1f6b4f] bg-[#0f2a20]" : "border-[#6b1f30] bg-[#2a0f16]"
      }`}
    >
      <p className={`text-2xl font-extrabold ${knew ? "text-good" : "text-again"}`}>
        {knew ? `Hit! ${status.hearts} ${status.hearts === 1 ? "heart" : "hearts"} left` : "It healed back to full"}
      </p>
      <p className="mt-1 text-sm text-ink-muted">{tomorrow}</p>
    </div>
  );
}

function BeatenPanel({ boss, nextBossDay }: { boss: BossView; nextBossDay: string }) {
  return (
    <section className="rounded-3xl border border-[#5c4a14] bg-[#272010] px-6 py-10 text-center">
      <TrophyIcon className="mx-auto h-12 w-12 text-gold" />
      <h2 className="mt-3 text-2xl font-extrabold">You beat “{boss.front}”</h2>
      <p className="mt-2 text-ink-muted">
        It is in your trophy case. The next boss comes {formatDay(nextBossDay, "long")}.
      </p>
    </section>
  );
}

function NoBoss({ closest }: { closest: BossScreen["closest"] }) {
  const more = closest ? BOSS_MIN_LAPSES - closest.lapses : BOSS_MIN_LAPSES;
  return (
    <section className={`${panel} px-6 py-10 text-center`}>
      <BossIcon className="mx-auto h-12 w-12 text-ink-muted" />
      <h2 className="mt-3 text-2xl font-extrabold">No boss right now</h2>
      <p className="mt-2 text-ink-muted">
        {closest
          ? `“${closest.front}” has slipped ${closest.lapses} ${closest.lapses === 1 ? "time" : "times"} in review. ${more} more and it becomes a boss.`
          : `A word you forget ${BOSS_MIN_LAPSES} times in review becomes a boss. None has yet. Nice.`}
      </p>
    </section>
  );
}

function Rules() {
  return (
    <section className={`${panel} space-y-2`}>
      <h2 className="text-lg font-extrabold">How it works</h2>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-muted">
        <li>
          A word you have forgotten in review {BOSS_MIN_LAPSES} times or more comes back as a boss for {BOSS_DAYS}{" "}
          days.
        </li>
        <li>Fight it once a day: flip the card and say honestly whether you knew it.</li>
        <li>
          Know it {BOSS_HEARTS} days in a row to beat it, for <b className="text-gold">{BOSS_XP} XP</b>.
        </li>
        <li>A miss, or a day without a fight, heals it back to full.</li>
        <li>Fights never change when the card comes up in review.</li>
      </ul>
    </section>
  );
}

function TrophyCase({ trophies, escaped }: { trophies: Trophy[]; escaped: number }) {
  return (
    <section className={`${panel} space-y-3`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-extrabold">Trophy case</h2>
        <span className="text-sm text-ink-muted tabular-nums">
          {trophies.length} beaten{escaped > 0 ? ` · ${escaped} got away` : ""}
        </span>
      </div>
      {trophies.length === 0 ? (
        <p className="text-sm text-ink-muted">Beaten bosses go here.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {trophies.map((trophy) => (
            <li key={trophy.startDay} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#3a2e0c] text-gold">
                <TrophyIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-extrabold">{trophy.front}</span>
                  <span className="shrink-0 text-xs text-ink-muted">{formatDay(trophy.defeatedOn)}</span>
                </p>
                <p className="line-clamp-2 text-sm text-ink-muted">{optionText(trophy.back)}</p>
                <p className="mt-0.5 text-xs text-ink-muted/80">
                  Forgotten {trophy.lapses} times{trophy.deckName ? ` · ${trophy.deckName}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
