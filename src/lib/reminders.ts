/**
 * Phone reminders: once a day, in the evening, a notification if today still
 * needs something -- the daily goal that keeps the streak, today's Word of the
 * Day, or a fight with the boss -- and on Sundays, the week's recap. Nothing
 * is sent on a day that is already done.
 *
 * This file is the wording and the timing, with no database or network, so it
 * can be tested on its own. Sending lives in `reminders-db.ts`.
 */

/**
 * The hour, in UTC, the reminder job runs. It must match the schedule in
 * `vercel.json` (a test checks). On Vercel's free plan a job may run once a
 * day and starts at some point within that hour.
 *
 * 17:00 UTC is 20:00 in East Africa (UTC+3), which leaves the evening to
 * catch up.
 */
export const REMINDER_UTC_HOUR = 17;

export interface ReminderState {
  /** Days in a row the goal was met, not counting today unless already met. */
  streak: number;
  /** Answers so far today. */
  today: number;
  goal: number;
  todayDone: boolean;
  /** Today's Word of the Day exists and has not been answered. */
  wordWaiting: boolean;
  /** A boss can still be beaten and has not been fought today. */
  bossWaiting: boolean;
  /** It is Sunday, so the week's recap is ready. */
  recapReady: boolean;
}

export interface ReminderMessage {
  title: string;
  body: string;
  /** Where tapping the notification opens. */
  url: string;
}

/** Whole hours from `now` to midnight on the calendar of `timeZone`. */
export function hoursUntilMidnight(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return Math.floor((24 * 60 - (hour * 60 + minute)) / 60);
}

function timeLeft(hours: number): string {
  if (hours >= 2) return `${hours} hours`;
  if (hours === 1) return "about an hour";
  return "under an hour";
}

/**
 * What to say tonight, or null when there is nothing left to do. The goal
 * comes first, then today's word, then the boss; on a Sunday with all of
 * that done, the week's recap.
 */
export function reminderMessage(state: ReminderState, hoursLeft: number): ReminderMessage | null {
  const left = Math.max(0, state.goal - state.today);
  const word = state.wordWaiting
    ? " Today's word is waiting too."
    : state.bossWaiting
      ? " The boss is waiting too."
      : "";

  if (!state.todayDone) {
    const cards = `${left} more ${left === 1 ? "card" : "cards"}`;
    if (state.streak > 0) {
      return {
        title: `Your ${state.streak}-day streak ends in ${timeLeft(hoursLeft)}`,
        body: `${cards} keeps it alive.${word}`,
        url: "/",
      };
    }
    return {
      title: "Start a streak tonight",
      body: `${cards} is all it takes.${word}`,
      url: "/",
    };
  }

  if (state.wordWaiting) {
    return {
      title: "Today's word is waiting",
      body: "Goal done. One more card: do you still know it?",
      url: "/word",
    };
  }

  if (state.bossWaiting) {
    return {
      title: "The boss is waiting",
      body: "Goal done. Fight it before midnight, or it heals.",
      url: "/boss",
    };
  }

  if (state.recapReady) {
    return {
      title: "Your week in words is ready",
      body: "Goal done. See what this week added up to.",
      url: "/recap",
    };
  }

  return null;
}

/** The test notification, so you can see reminders work on this device. */
export const TEST_MESSAGE: ReminderMessage = {
  title: "Reminders are on",
  body: "You'll get a nudge in the evening when your streak needs you.",
  url: "/",
};

/** The reminder hour on the player's own clock, e.g. "8 pm". */
export function localReminderTime(timeZone: string, now: Date = new Date()): string {
  const at = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), REMINDER_UTC_HOUR),
  );
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric" })
    .format(at)
    .toLowerCase()
    .replace(/\s/g, " ");
}
