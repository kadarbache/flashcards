import Link from "next/link";

import {
  ArrowIcon,
  BoltIcon,
  BossIcon,
  CheckIcon,
  ChevronIcon,
  FlameIcon,
  HomeIcon,
  MedalIcon,
  StarIcon,
  SunIcon,
  TrophyIcon,
  VideoIcon,
} from "@/components/icons";
import { ShareRecap } from "@/components/share-recap";
import { iconButton, panel, primaryButton } from "@/components/ui";
import { isQuietWeek, type Recap } from "@/lib/recap";
import type { RecapPage } from "@/lib/recap-db";

/** The weekly recap: one week of play, Monday to Sunday, with a picture to share. */
export function RecapView({ page }: { page: RecapPage }) {
  const { recap, previous, next } = page;
  const quiet = isQuietWeek(recap);

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="flex items-center gap-2.5">
        <Link href="/" className={iconButton} aria-label="Back to home">
          <ArrowIcon direction="left" className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl leading-tight font-extrabold tracking-tight">Your week</h1>
          <p className="truncate text-sm text-ink-muted">
            {recap.range}
            {recap.current ? " · so far" : ""}
          </p>
        </div>
        <WeekLink week={previous} label="The week before" direction="left" />
        <WeekLink week={next} label="The week after" direction="right" />
      </div>

      {quiet ? (
        <section className={`${panel} px-6 py-10 text-center`}>
          <SunIcon className="mx-auto h-12 w-12 text-gold" />
          <h2 className="mt-3 text-2xl font-extrabold">A quiet week</h2>
          <p className="mt-2 text-ink-muted">
            {recap.current
              ? "Nothing yet this week. A few cards today and this page starts filling up."
              : "No cards were answered this week."}
          </p>
          <Link href="/" className={`${primaryButton} mt-5`}>
            <HomeIcon className="h-5 w-5" />
            Go to your decks
          </Link>
        </section>
      ) : (
        <>
          <Hero recap={recap} />
          <Stats recap={recap} />
          <Highlights recap={recap} />
          <section className={`${panel} space-y-3`}>
            <h2 className="text-lg font-extrabold">Share your week</h2>
            <ShareRecap monday={recap.monday} range={recap.range} />
          </section>
        </>
      )}
    </div>
  );
}

function WeekLink({ week, label, direction }: { week: string | null; label: string; direction: "left" | "right" }) {
  const icon = <ChevronIcon direction={direction} className="h-5 w-5" />;
  if (!week) {
    return (
      <span className={`${iconButton} opacity-35`} aria-hidden="true">
        {icon}
      </span>
    );
  }
  return (
    <Link href={`/recap?week=${week}`} className={iconButton} aria-label={label}>
      {icon}
    </Link>
  );
}

function Hero({ recap }: { recap: Recap }) {
  return (
    <section className="anim-rise space-y-5 rounded-3xl border border-[#4a2c18] bg-[linear-gradient(160deg,#2a2150_0%,#1b1830_45%,#2a1a12_100%)] p-5 sm:p-6">
      <div>
        <p className="text-xs font-extrabold tracking-wide text-gold uppercase">Cards answered</p>
        <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
          <p className="text-6xl leading-none font-extrabold tracking-tight tabular-nums">
            {recap.answers.toLocaleString("en-US")}
          </p>
          {recap.change !== null && (
            <p
              className={`mb-1 rounded-full px-2.5 py-1 text-sm font-extrabold tabular-nums ${
                recap.change >= 0 ? "bg-[#0f2a20] text-good" : "bg-surface-high text-ink-muted"
              }`}
            >
              {recap.change >= 0 ? "▲" : "▼"} {Math.abs(recap.change)}%{" "}
              {recap.current ? "on this time last week" : "on the week before"}
            </p>
          )}
        </div>
      </div>

      <ol className="grid grid-cols-7 gap-1.5 text-center" aria-label="Days on goal">
        {recap.days.map((day) => (
          <li key={day.day} className="flex flex-col items-center gap-1.5">
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-full ${
                day.met
                  ? "bg-flame text-[#2a1a12]"
                  : day.future || day.isToday
                    ? "border-[3px] border-dashed border-[#5c3a24]"
                    : "bg-[#3d2618]"
              }`}
              title={`${day.count} ${day.count === 1 ? "card" : "cards"}`}
            >
              {day.met && <CheckIcon className="h-4 w-4" />}
            </span>
            <span className={`text-xs ${day.isToday ? "font-extrabold text-white" : "text-[#f2c9a8]"}`}>
              {day.letter}
            </span>
          </li>
        ))}
      </ol>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#f2c9a8]">
        <span>
          <b className="text-white">{recap.daysMet}</b> of 7 days on goal ({recap.goal} cards a day)
        </span>
        {recap.streak > 0 && (
          <span className="flex items-center gap-1 font-bold text-flame">
            <FlameIcon className="h-4 w-4" />
            {recap.streak}-day streak
          </span>
        )}
      </p>
    </section>
  );
}

function Stats({ recap }: { recap: Recap }) {
  return (
    <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      <Stat label="XP earned" value={recap.xp.toLocaleString("en-US")} icon={<StarIcon className="h-4 w-4 text-gold" />} />
      <Stat label="Words learned" value={recap.learned} icon={<MedalIcon tier="bronze" className="h-4 w-4" />} />
      <Stat label="Best combo" value={recap.bestCombo} icon={<BoltIcon className="h-4 w-4 text-easy" />} />
      <Stat label="Words added" value={recap.added} />
      <Stat label="Minutes on cards" value={recap.minutes} />
      <Stat label="Videos watched" value={recap.videos} icon={<VideoIcon className="h-4 w-4 text-again" />} />
    </dl>
  );
}

function Stat({ label, value, icon }: { label: string; value: number | string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface-raised px-4 py-3.5">
      <dd className="text-3xl leading-none font-extrabold tabular-nums">{value}</dd>
      <dt className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
        {icon}
        {label}
      </dt>
    </div>
  );
}

function Highlights({ recap }: { recap: Recap }) {
  const rows: { key: string; icon: React.ReactNode; title: string; detail: string }[] = [];

  for (const boss of recap.bosses) {
    rows.push({
      key: `boss-${boss}`,
      icon: <TrophyIcon className="h-5 w-5 text-gold" />,
      title: `Beat the boss “${boss}”`,
      detail: "Three days in a row. It is in your trophy case.",
    });
  }
  if (recap.toughest && !recap.bosses.includes(recap.toughest.front)) {
    rows.push({
      key: "toughest",
      icon: <BossIcon className="h-5 w-5 text-again" />,
      title: `Got “${recap.toughest.front}” right`,
      detail: `The hardest word you answered this week: forgotten ${recap.toughest.lapses} ${
        recap.toughest.lapses === 1 ? "time" : "times"
      } before.`,
    });
  }
  if (recap.silver > 0 || recap.gold > 0) {
    const parts = [
      recap.gold > 0 ? `${recap.gold} gold` : null,
      recap.silver > 0 ? `${recap.silver} silver` : null,
    ].filter(Boolean);
    rows.push({
      key: "medals",
      icon: <MedalIcon tier={recap.gold > 0 ? "gold" : "silver"} className="h-5 w-5" />,
      title: `New medals: ${parts.join(" and ")}`,
      detail: "Words that now stay with you for weeks at a time.",
    });
  }
  if (recap.word.answered > 0) {
    rows.push({
      key: "word",
      icon: <SunIcon className="h-5 w-5 text-gold" />,
      title: `Word of the Day: knew ${recap.word.knew} of ${recap.word.answered}`,
      detail: recap.word.knew === recap.word.answered ? "Every one. Nice." : "Missed ones come back around.",
    });
  }
  if (recap.topDeck) {
    rows.push({
      key: "deck",
      icon: <CheckIcon className="h-5 w-5 text-good" />,
      title: `Most played: ${recap.topDeck.name}`,
      detail: `${recap.topDeck.answers} ${recap.topDeck.answers === 1 ? "card" : "cards"} answered.`,
    });
  }

  if (rows.length === 0) return null;
  return (
    <section className={`${panel} space-y-3`}>
      <h2 className="text-lg font-extrabold">Highlights</h2>
      <ul className="divide-y divide-border-subtle">
        {rows.map((row) => (
          <li key={row.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-high">
              {row.icon}
            </span>
            <div className="min-w-0">
              <p className="font-extrabold break-words">{row.title}</p>
              <p className="text-sm text-ink-muted">{row.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
