import type { Metadata } from "next";
import Link from "next/link";

import {
  ArrowIcon,
  BellIcon,
  BoltIcon,
  BossIcon,
  ChartIcon,
  DownloadIcon,
  FlameIcon,
  FlipIcon,
  HeartIcon,
  MedalIcon,
  RestoreIcon,
  SnowflakeIcon,
  SoundIcon,
  StarIcon,
  SunIcon,
  SwapIcon,
} from "@/components/icons";
import { panel, primaryButton } from "@/components/ui";
import { BOSS_DAYS, BOSS_HEARTS, BOSS_MIN_LAPSES, BOSS_XP } from "@/lib/boss";
import { COMBO_PAUSE_MS, DEFAULT_DAILY_GOAL, XP_PER_ANSWER } from "@/lib/game";
import { FREEZE_COST, MAX_FREEZES } from "@/lib/streak-freeze";
import { RESTORE_COST, RESTORES_PER_MONTH } from "@/lib/word-of-the-day";

export const metadata: Metadata = { title: "How to play · Flashcards" };

const SWIPES = [
  {
    direction: "left" as const,
    name: "Again",
    color: "#FF6B81",
    says: "I forgot it.",
    happens: "It comes back in a minute or so, and you practise it until it sticks.",
    example: "1m",
  },
  {
    direction: "down" as const,
    name: "Hard",
    color: "#FFB547",
    says: "I got it, but it was a fight.",
    happens: "It comes back a bit sooner than usual.",
    example: "6m",
  },
  {
    direction: "right" as const,
    name: "Good",
    color: "#3EE0A1",
    says: "I knew it.",
    happens: "The normal wait. Most of your swipes should be this one.",
    example: "10m",
  },
  {
    direction: "up" as const,
    name: "Easy",
    color: "#6EA8FF",
    says: "Too easy, I didn't even think.",
    happens: "It waits much longer before it comes back.",
    example: "4d",
  },
];

const KEYS: Array<[string, string]> = [
  ["Space or Enter", "Flip the card"],
  ["← or 1", "Again"],
  ["↓ or 2", "Hard"],
  ["→ or 3", "Good"],
  ["↑ or 4", "Easy"],
  ["U", "Undo the last answer"],
  ["S", "Skip a card for now"],
];

/**
 * How to play, explained like you're five. Public content, but it sits behind
 * the sign-in like the rest of the app.
 */
export default function HelpPage() {
  const comboSeconds = COMBO_PAUSE_MS / 1000;

  return (
    <div className="mx-auto max-w-5xl space-y-6 sm:space-y-8">
      <header className="anim-rise space-y-2">
        <p className="text-sm font-bold text-gold">How to play</p>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">
          Your words are little plants.
        </h1>
        <p className="max-w-2xl text-lg text-ink-muted">
          Water a plant just before it wilts and it needs water less often. Cards work the same
          way: the app brings each one back right when you are about to forget it. You don&apos;t
          have to remember when. Your only job is to show up and swipe.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <section className={`${panel} space-y-4`}>
          <h2 className="text-xl font-extrabold">One card, three steps</h2>
          <ol className="space-y-3">
            <Step n={1} title="Look at the word">
              Say the meaning in your head. No peeking.
            </Step>
            <Step n={2} title="Tap to flip">
              <span className="inline-flex items-center gap-1">
                <FlipIcon className="h-4 w-4" /> Tap the card, or press Space.
              </span>
            </Step>
            <Step n={3} title="Swipe">
              Tell the app how it went by throwing the card one of four ways.
            </Step>
          </ol>
        </section>

        <section className={`${panel} space-y-4`}>
          <h2 className="text-xl font-extrabold">Where you see the times</h2>
          <p className="text-ink-muted">
            Each swipe sends the card away for a different time. You see that time twice:
          </p>
          <ul className="space-y-3">
            <li className="flex gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-surface-high text-sm font-extrabold">
                1
              </span>
              <span>
                <b>Under the card.</b> After you flip, four tiles show where each swipe sends
                it, like <b className="text-good">→ 10m</b>. The one you drag toward lights up.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-surface-high text-sm font-extrabold">
                2
              </span>
              <span>
                <b>On the card.</b> While you drag, a stamp appears, like{" "}
                <b className="text-good">GOOD, back in 10m</b>. Let go to answer, or drag back
                to the middle to change your mind.
              </span>
            </li>
          </ul>
        </section>
      </div>

      <section className={`${panel} space-y-5`}>
        <h2 className="text-xl font-extrabold">The four swipes</h2>
        <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
          <SwipeTile swipe={SWIPES[0]} />
          <div className="order-first mx-auto grid grid-cols-3 grid-rows-3 place-items-center gap-1 md:order-none">
            <span />
            <ArrowIcon direction="up" className="h-7 w-7 text-easy" />
            <span />
            <ArrowIcon direction="left" className="h-7 w-7 text-again" />
            <div className="flex h-28 w-20 items-center justify-center rounded-2xl bg-paper text-sm font-extrabold text-paper-ink shadow-lg">
              card
            </div>
            <ArrowIcon direction="right" className="h-7 w-7 text-good" />
            <span />
            <ArrowIcon direction="down" className="h-7 w-7 text-hard" />
            <span />
          </div>
          <SwipeTile swipe={SWIPES[2]} />
          <SwipeTile swipe={SWIPES[1]} />
          <span className="hidden md:block" />
          <SwipeTile swipe={SWIPES[3]} />
        </div>
        <p className="text-sm text-ink-muted">
          The times above are only examples. Real ones depend on the card and grow every time you
          remember it.
        </p>
      </section>

      <section className="rounded-3xl border border-[#1f6b4f] bg-[#0f2a20] p-5 sm:p-6">
        <h2 className="text-xl font-extrabold">Be honest, it costs nothing</h2>
        <p className="mt-2 text-[#c7f0dd]">
          Every answer gets the same {XP_PER_ANSWER} XP, Again included. So never swipe Good on a
          card you forgot just to look good: the app would wait too long, and you would forget it
          for real. Again is not losing. It is how a card gets learned.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
        <section className={`${panel} space-y-3`}>
          <FlameIcon className="h-9 w-9" />
          <h2 className="text-lg font-extrabold">Streak and daily goal</h2>
          <p className="text-ink-muted">
            Answer your daily goal ({DEFAULT_DAILY_GOAL} cards to start) and today counts. Days in a
            row make your streak. Change the goal on the home screen with − and +.
          </p>
          <p className="flex gap-2 text-ink-muted">
            <SnowflakeIcon className="mt-1 h-4 w-4 shrink-0 text-ice" />
            <span>
              A streak freeze covers a day you miss. When a streak breaks, the home screen offers
              one for {FREEZE_COST.toLocaleString("en-US")} XP, and you can hold up to{" "}
              {MAX_FREEZES}. It is used by itself when a day ends without your goal, and only when
              it saves the streak. A frozen day keeps the streak going without adding to it, and a
              freeze never covers a day missed before you bought it. Your level stays where it is:
              it counts all the XP you ever earned.
            </span>
          </p>
        </section>
        <section className={`${panel} space-y-3`}>
          <StarIcon className="h-9 w-9 text-gold" />
          <h2 className="text-lg font-extrabold">XP and levels</h2>
          <p className="text-ink-muted">
            Each answer is {XP_PER_ANSWER} XP. Fill the bar to level up and climb the ranks, from
            Rookie to Sage.
          </p>
        </section>
        <section className={`${panel} space-y-3`}>
          <BoltIcon className="h-9 w-9 text-gold" />
          <h2 className="text-lg font-extrabold">Combo</h2>
          <p className="text-ink-muted">
            Keep answering without stopping for more than {comboSeconds} seconds. 3 in a row gives
            ×1.5 XP, 6 in a row gives ×2. A long pause starts the count again.
          </p>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <section className={`${panel} space-y-3`}>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <SwapIcon className="h-6 w-6 text-easy" />
            Practice
          </h2>
          <p className="text-ink-muted">
            Flip through the whole deck any time. Swipe left for the next card, right to go back.
            Every card has its own colour. Nothing is graded, so your schedule stays where it was.
          </p>
        </section>
        <section className={`${panel} space-y-3`}>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <BoltIcon className="h-6 w-6 text-gold" />
            Blitz
          </h2>
          <p className="flex flex-wrap items-center gap-1 text-ink-muted">
            One minute, three
            <HeartIcon className="inline h-4 w-4 text-again" />. Pick the right meaning out of four.
            Right answers in a row score more. Also just for fun: it never changes your schedule.
          </p>
        </section>
      </div>

      <section className={`${panel} space-y-3`}>
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <SunIcon className="h-6 w-6 text-gold" />
          Word of the Day
        </h2>
        <p className="text-ink-muted">
          Each day one word you have already learned comes back as a single card. Say it in your
          head, flip, then tap Knew it or Missed it (or swipe right or left). You get one answer a
          day. The days you knew it and the days you missed it are counted, with a streak for days
          in a row. Like Practice and Blitz, it never changes your schedule.
        </p>
        <p className="flex gap-2 text-ink-muted">
          <RestoreIcon className="mt-1 h-4 w-4 shrink-0 text-restore" />
          <span>
            Missed a day? Tap it on the calendar to restore it. You get {RESTORES_PER_MONTH} restore
            cards each month, and each one costs {RESTORE_COST.toLocaleString("en-US")} XP. The
            day&apos;s word comes back for you to answer. If you knew it, the day counts in your streak
            again. Restored days keep a mark of their own, outlined instead of filled, so you can
            always tell them from days you answered on time. The meaning of a missed word stays
            hidden until you answer it.
          </span>
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <section className={`${panel} space-y-3`}>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <BossIcon className="h-6 w-6 text-again" />
            Boss fight
          </h2>
          <p className="text-ink-muted">
            A word you have forgotten in review {BOSS_MIN_LAPSES} times comes back as a boss for{" "}
            {BOSS_DAYS} days. Fight it once a day: flip it and say honestly whether you knew it. Know it{" "}
            {BOSS_HEARTS} days in a row to beat it, for {BOSS_XP} XP and a place in your trophy case. A
            miss, or a day you skip, heals it. Fights never change your schedule.
          </p>
        </section>
        <section className={`${panel} space-y-3`}>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <ChartIcon className="h-6 w-6 text-easy" />
            Your week
          </h2>
          <p className="text-ink-muted">
            Every Sunday your week, Monday to Sunday, is added up: cards answered, XP, days on goal,
            words learned, your best combo, bosses beaten. Make a picture of it to share or save. The
            rest of the week it shows the week before, and the arrows go back further.
          </p>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <section className={`${panel} space-y-3`}>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <MedalIcon tier="gold" className="h-6 w-6" />
            Collection
          </h2>
          <p className="text-ink-muted">
            Every word has a slot in your album and earns a medal as it sticks. Bronze once you
            learn it, Silver when it holds for 21 days, Gold when it holds for 90. Answering Good
            moves words up on their own; forgetting one drops it back to Bronze. A new medal pops up
            right in the review.
          </p>
        </section>
        <section className={`${panel} space-y-3`}>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <BellIcon className="h-6 w-6 text-good" />
            Evening reminder
          </h2>
          <p className="text-ink-muted">
            Turn it on from the home screen, on each phone or computer you use. Once a day in the
            evening, if your goal is not done, today&apos;s word is still waiting or the boss has
            not been fought, you get one notification. On a Sunday that is done, it brings your
            week instead. Otherwise nothing comes. On iPhone, add the app to your Home Screen
            first.
          </p>
        </section>
      </div>

      <section className={`${panel} space-y-3`}>
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <SoundIcon className="h-6 w-6 text-gold" />
          Sound
        </h2>
        <p className="text-ink-muted">
          Every flip and swipe makes a little sound, and answers in a row climb higher and higher.
          Tap the speaker at the top to pick Arcade, Bubbly or Crisp, or to turn sound off. Each
          phone or computer remembers its own choice. On an iPhone, the silent switch mutes it.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <section className={`${panel} space-y-3`}>
          <h2 className="text-lg font-extrabold">On a computer</h2>
          <p className="text-ink-muted">Drag the card with the mouse, or use the keys.</p>
          <ul className="space-y-1.5 text-sm">
            {KEYS.map(([key, action]) => (
              <li key={key} className="flex items-center justify-between gap-3">
                <span className="text-ink-muted">{action}</span>
                <kbd className="rounded-lg bg-surface-high px-2 py-0.5 font-sans text-xs font-bold">
                  {key}
                </kbd>
              </li>
            ))}
          </ul>
        </section>
        <section className={`${panel} space-y-3`}>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <DownloadIcon className="h-6 w-6 text-easy" />
            Put it on your phone
          </h2>
          <ul className="space-y-2 text-ink-muted">
            <li>
              <b className="text-ink">Android (Chrome):</b> open the menu ⋮ and tap{" "}
              <b className="text-ink">Install app</b>, or use the install card on the home screen.
            </li>
            <li>
              <b className="text-ink">iPhone (Safari):</b> tap Share, then{" "}
              <b className="text-ink">Add to Home Screen</b>.
            </li>
            <li>
              <b className="text-ink">Computer (Chrome or Edge):</b> click the install icon at the
              right of the address bar.
            </li>
          </ul>
          <p className="text-sm text-ink-muted">
            It then opens full screen from its own icon, like any other app.
          </p>
        </section>
      </div>

      <div className="flex justify-center pb-4">
        <Link href="/" className={primaryButton}>
          Start playing
        </Link>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold text-base font-extrabold text-paper-ink">
        {n}
      </span>
      <div>
        <p className="font-extrabold">{title}</p>
        <p className="text-ink-muted">{children}</p>
      </div>
    </li>
  );
}

function SwipeTile({ swipe }: { swipe: (typeof SWIPES)[number] }) {
  return (
    <div
      className="flex gap-3 rounded-2xl border-2 p-4"
      style={{ borderColor: `${swipe.color}55`, background: `${swipe.color}12` }}
    >
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-paper-ink"
        style={{ background: swipe.color }}
      >
        <ArrowIcon direction={swipe.direction} className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 font-extrabold" style={{ color: swipe.color }}>
          {swipe.name}
          <span className="text-xs font-bold text-ink-muted">e.g. back in {swipe.example}</span>
        </p>
        <p className="font-bold">&ldquo;{swipe.says}&rdquo;</p>
        <p className="text-sm text-ink-muted">{swipe.happens}</p>
      </div>
    </div>
  );
}
