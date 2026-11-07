import webpush from "web-push";

import { getBossScreen } from "@/lib/boss-db";
import { connectToDatabase } from "@/lib/db/connect";
import { Profile, PushDevice } from "@/lib/db/models";
import { dayKey, isSunday, safeTimeZone } from "@/lib/game";
import {
  hoursUntilMidnight,
  reminderMessage,
  TEST_MESSAGE,
  type ReminderMessage,
} from "@/lib/reminders";
import { getPlayerStats } from "@/lib/stats";
import { getWordOfTheDay } from "@/lib/word-of-the-day-db";

/** A push subscription as the browser hands it over (`subscription.toJSON()`). */
export interface DeviceSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Sends one notification. Swapped for a fake in tests. */
export type Sender = (device: DeviceSubscription, message: ReminderMessage) => Promise<void>;

/**
 * The VAPID keys that sign every push, or null when they are not set. Without
 * them nothing can be sent, and the app says so instead of failing quietly.
 */
export function vapidKeys(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const contact = process.env.VAPID_SUBJECT?.trim() || process.env.AUTH_USER_EMAIL?.trim();
  const subject = contact
    ? contact.startsWith("mailto:") || contact.startsWith("https:")
      ? contact
      : `mailto:${contact}`
    : "mailto:owner@example.com";
  return { publicKey, privateKey, subject };
}

/** The real sender: Web Push, through whichever push service the browser uses. */
export const webPushSender: Sender = async (device, message) => {
  const keys = vapidKeys();
  if (!keys) throw new Error("VAPID keys are not set.");
  await webpush.sendNotification(device, JSON.stringify(message), {
    vapidDetails: keys,
    // Worth nothing after midnight, so there is no point delivering it later.
    TTL: 4 * 60 * 60,
    urgency: "high",
  });
};

/** A push service saying this subscription is gone for good. */
function isGone(error: unknown): boolean {
  const status = (error as { statusCode?: number }).statusCode;
  return status === 404 || status === 410;
}

export function isDeviceSubscription(value: unknown): value is DeviceSubscription {
  const sub = value as DeviceSubscription | null;
  return (
    typeof sub?.endpoint === "string" &&
    sub.endpoint.startsWith("https://") &&
    sub.endpoint.length < 2048 &&
    typeof sub.keys?.p256dh === "string" &&
    typeof sub.keys?.auth === "string"
  );
}

export async function saveDevice(device: DeviceSubscription, timeZone: string): Promise<void> {
  await connectToDatabase();
  await PushDevice.updateOne(
    { endpoint: device.endpoint },
    { $set: { keys: device.keys, timeZone: safeTimeZone(timeZone) } },
    { upsert: true },
  );
}

export async function removeDevice(endpoint: string): Promise<void> {
  await connectToDatabase();
  await PushDevice.deleteOne({ endpoint });
}

/** Send `message` to these devices, dropping any the push service says are gone. */
async function deliver(
  devices: ReadonlyArray<{ endpoint: string; keys?: { p256dh: string; auth: string } | null }>,
  message: ReminderMessage,
  send: Sender,
): Promise<{ sent: number; removed: number; failed: number }> {
  let sent = 0;
  let removed = 0;
  let failed = 0;
  await Promise.all(
    devices.map(async (device) => {
      if (!device.keys) {
        // Unusable without its keys; the schema requires them, so this is a broken row.
        removed += 1;
        await PushDevice.deleteOne({ endpoint: device.endpoint });
        return;
      }
      const subscription = { endpoint: device.endpoint, keys: device.keys };
      try {
        await send(subscription, message);
        sent += 1;
        await PushDevice.updateOne({ endpoint: device.endpoint }, { $set: { lastSentAt: new Date() } });
      } catch (error) {
        if (isGone(error)) {
          removed += 1;
          await PushDevice.deleteOne({ endpoint: device.endpoint });
        } else {
          failed += 1;
        }
      }
    }),
  );
  return { sent, removed, failed };
}

export interface ReminderRun {
  sent: number;
  removed: number;
  failed: number;
  /** Why nothing went out, when nothing did. */
  skipped?: "no devices" | "already sent today" | "today is done";
  message?: ReminderMessage;
}

/**
 * The evening job: if today still needs something, tell every device, once.
 *
 * The day is cut on the time zone the most recent device reported, since the
 * job itself runs on a server with no idea where you are.
 */
export async function runReminders(now: Date = new Date(), send: Sender = webPushSender): Promise<ReminderRun> {
  await connectToDatabase();
  const devices = await PushDevice.find().sort({ updatedAt: -1 }).lean();
  if (devices.length === 0) return { sent: 0, removed: 0, failed: 0, skipped: "no devices" };

  const timeZone = safeTimeZone(devices[0].timeZone);
  const today = dayKey(now, timeZone);
  const profile = await Profile.findOne({ key: "owner" }).lean();
  if (profile?.lastReminderDay === today) {
    return { sent: 0, removed: 0, failed: 0, skipped: "already sent today" };
  }

  const [player, word, boss] = await Promise.all([
    getPlayerStats(timeZone, now),
    getWordOfTheDay(timeZone, now),
    getBossScreen(timeZone, now),
  ]);
  const fight = boss.boss?.status;
  const message = reminderMessage(
    {
      streak: player.streak,
      freezes: player.freezes,
      today: player.today,
      goal: player.goal,
      todayDone: player.todayDone,
      wordWaiting: word.today !== null && word.today.result === null,
      bossWaiting: fight !== undefined && fight.canFight && fight.winnable,
      recapReady: isSunday(today),
    },
    hoursUntilMidnight(now, timeZone),
  );
  if (!message) return { sent: 0, removed: 0, failed: 0, skipped: "today is done" };

  const result = await deliver(devices, message, send);
  if (result.sent > 0) {
    await Profile.updateOne(
      { key: "owner" },
      { $set: { lastReminderDay: today }, $setOnInsert: { key: "owner" } },
      { upsert: true },
    );
  }
  return { ...result, message };
}

/** A test notification to one device, whatever the day looks like. */
export async function sendTestReminder(endpoint: string, send: Sender = webPushSender): Promise<boolean> {
  await connectToDatabase();
  const device = await PushDevice.findOne({ endpoint }).lean();
  if (!device) return false;
  const result = await deliver([device], TEST_MESSAGE, send);
  return result.sent === 1;
}
