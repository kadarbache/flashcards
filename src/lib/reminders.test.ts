/**
 * Evening reminders: the wording, the timing, the schedule in vercel.json, and
 * the job itself against an in-process MongoDB with a fake push sender.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/connect";
import { Card, DailyWord, Deck, Profile, PushDevice, ReviewLog } from "@/lib/db/models";
import {
  hoursUntilMidnight,
  localReminderTime,
  REMINDER_UTC_HOUR,
  reminderMessage,
  type ReminderMessage,
} from "@/lib/reminders";
import {
  isDeviceSubscription,
  runReminders,
  saveDevice,
  sendTestReminder,
  type DeviceSubscription,
  type Sender,
} from "@/lib/reminders-db";

const base = { streak: 0, today: 0, goal: 20, todayDone: false, wordWaiting: false };

describe("reminderMessage", () => {
  it("warns about a streak about to break", () => {
    const message = reminderMessage({ ...base, streak: 12, today: 8 }, 3);
    assert.equal(message?.title, "Your 12-day streak ends in 3 hours");
    assert.equal(message?.body, "12 more cards keeps it alive.");
    assert.equal(message?.url, "/");
  });

  it("invites a fresh start without a streak, and mentions the word", () => {
    const message = reminderMessage({ ...base, today: 19, wordWaiting: true }, 0);
    assert.equal(message?.title, "Start a streak tonight");
    assert.equal(message?.body, "1 more card is all it takes. Today's word is waiting too.");
  });

  it("points at the word when only the word is left", () => {
    const message = reminderMessage({ ...base, todayDone: true, today: 20, wordWaiting: true }, 3);
    assert.equal(message?.url, "/word");
  });

  it("stays quiet on a day that is done", () => {
    assert.equal(reminderMessage({ ...base, todayDone: true, today: 25 }, 3), null);
  });

  it("says the time left in plain words", () => {
    assert.match(reminderMessage({ ...base, streak: 2 }, 1)?.title ?? "", /about an hour$/);
  });
});

describe("timing", () => {
  it("counts whole hours to the player's midnight", () => {
    const at = new Date("2026-11-01T17:20:00Z");
    assert.equal(hoursUntilMidnight(at, "Africa/Nairobi"), 3); // 20:20 there
    assert.equal(hoursUntilMidnight(at, "UTC"), 6);
  });

  it("shows the reminder hour on the player's clock", () => {
    assert.equal(localReminderTime("Africa/Nairobi"), "8 pm");
  });

  it("matches the schedule in vercel.json", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const job = config.crons.find((cron) => cron.path === "/api/cron/reminders");
    assert.equal(job?.schedule, `0 ${REMINDER_UTC_HOUR} * * *`);
  });
});

describe("isDeviceSubscription", () => {
  it("accepts a browser subscription and rejects anything else", () => {
    assert.equal(
      isDeviceSubscription({ endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } }),
      true,
    );
    assert.equal(isDeviceSubscription({ endpoint: "http://push.example/abc", keys: { p256dh: "k", auth: "a" } }), false);
    assert.equal(isDeviceSubscription({ endpoint: "https://push.example/abc" }), false);
    assert.equal(isDeviceSubscription(null), false);
  });
});

describe("the reminder job", () => {
  let mongo: MongoMemoryServer;
  // 20:00 in Nairobi on 1 November.
  const evening = new Date("2026-11-01T17:00:00Z");
  const phone: DeviceSubscription = { endpoint: "https://push.example/phone", keys: { p256dh: "p", auth: "a" } };
  const laptop: DeviceSubscription = { endpoint: "https://push.example/laptop", keys: { p256dh: "p", auth: "a" } };

  function recorder() {
    const sent: { endpoint: string; message: ReminderMessage }[] = [];
    const send: Sender = async (device, message) => {
      sent.push({ endpoint: device.endpoint, message });
    };
    return { sent, send };
  }

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
    process.env.MONGODB_DB = "flashcards_reminders_test";
    await connectToDatabase();
    await PushDevice.init();
  }, { timeout: 300_000 });

  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Card.deleteMany({}),
      Deck.deleteMany({}),
      ReviewLog.deleteMany({}),
      Profile.deleteMany({}),
      PushDevice.deleteMany({}),
      DailyWord.deleteMany({}),
    ]);
  });

  /** `count` answers at `at`, enough to fill or not fill the goal. */
  async function answered(count: number, at: Date) {
    const deck = await Deck.create({ name: "Vocab" });
    const card = await Card.create({ deckId: deck._id, front: "w", back: "b" });
    const before = {
      state: "new", step: 0, intervalDays: 0, ease: 2.5, due: at, lapses: 0, reps: 0,
    };
    await ReviewLog.insertMany(
      Array.from({ length: count }, () => ({
        cardId: card._id,
        deckId: deck._id,
        grade: "good",
        before,
        intervalDaysAfter: 1,
        easeAfter: 2.5,
        reviewedAt: at,
      })),
    );
  }

  it("does nothing without a device", async () => {
    const { sent, send } = recorder();
    const run = await runReminders(evening, send);
    assert.equal(run.skipped, "no devices");
    assert.equal(sent.length, 0);
  });

  it("reminds every device once a day while the goal is open", async () => {
    await saveDevice(phone, "Africa/Nairobi");
    await saveDevice(laptop, "Africa/Nairobi");
    const { sent, send } = recorder();

    const first = await runReminders(evening, send);
    assert.equal(first.sent, 2);
    assert.equal(sent[0].message.title, "Start a streak tonight");

    const second = await runReminders(new Date("2026-11-01T18:00:00Z"), send);
    assert.equal(second.skipped, "already sent today");
    assert.equal(sent.length, 2);

    // The next evening is a new day.
    const nextDay = await runReminders(new Date("2026-11-02T17:00:00Z"), send);
    assert.equal(nextDay.sent, 2);
  });

  it("stays quiet when the goal is done", async () => {
    await saveDevice(phone, "Africa/Nairobi");
    await answered(20, new Date("2026-11-01T09:00:00Z"));
    const { sent, send } = recorder();
    const run = await runReminders(evening, send);
    assert.equal(run.skipped, "today is done");
    assert.equal(sent.length, 0);
  });

  it("drops a device the push service says is gone", async () => {
    await saveDevice(phone, "Africa/Nairobi");
    await saveDevice(laptop, "Africa/Nairobi");
    const send: Sender = async (device) => {
      if (device.endpoint === laptop.endpoint) {
        throw Object.assign(new Error("Gone"), { statusCode: 410 });
      }
    };
    const run = await runReminders(evening, send);
    assert.equal(run.sent, 1);
    assert.equal(run.removed, 1);
    assert.deepEqual(
      (await PushDevice.find().lean()).map((device) => device.endpoint),
      [phone.endpoint],
    );
  });

  it("sends a test to one device on request", async () => {
    await saveDevice(phone, "UTC");
    const { sent, send } = recorder();
    assert.equal(await sendTestReminder(phone.endpoint, send), true);
    assert.equal(await sendTestReminder("https://push.example/unknown", send), false);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].message.title, "Reminders are on");
  });
});
