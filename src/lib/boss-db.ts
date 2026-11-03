import { connectToDatabase } from "@/lib/db/connect";
import { Boss, Card, Deck } from "@/lib/db/models";
import {
  BOSS_DAYS,
  BOSS_HEARTS,
  BOSS_MIN_LAPSES,
  BOSS_XP,
  bossStatus,
  hitsInARow,
  pickBoss,
  type BossAnswer,
  type BossRow,
  type BossStatus,
} from "@/lib/boss";
import { addDays, dayKey, previousDay, safeTimeZone } from "@/lib/game";
import { isDayKey, isWordResult } from "@/lib/word-of-the-day";

/** The boss as the screen shows it. */
export interface BossView {
  startDay: string;
  endDay: string;
  front: string;
  back: string;
  deckName: string;
  lapses: number;
  status: BossStatus;
}

/** A beaten boss, in the trophy case. */
export interface Trophy {
  startDay: string;
  front: string;
  back: string;
  deckName: string;
  lapses: number;
  defeatedOn: string;
}

export interface BossScreen {
  today: string;
  /** Null when no word has slipped often enough to be a boss. */
  boss: BossView | null;
  /** With no boss: the word closest to becoming one. */
  closest: { front: string; lapses: number } | null;
  /** Newest first. */
  trophies: Trophy[];
  /** Bosses that got away. */
  escaped: number;
}

type StoredBoss = {
  _id: unknown;
  startDay: string;
  endDay: string;
  front: string;
  back: string;
  deckName?: string | null;
  lapses: number;
  answers?: ReadonlyArray<{ day: string; result: string }> | null;
  defeatedOn?: string | null;
};

function answersOf(boss: StoredBoss): BossAnswer[] {
  return (boss.answers ?? []).flatMap((answer) =>
    isWordResult(answer.result) ? [{ day: answer.day, result: answer.result }] : [],
  );
}

function rowOf(boss: StoredBoss): BossRow {
  return {
    startDay: boss.startDay,
    endDay: boss.endDay,
    answers: answersOf(boss),
    defeatedOn: boss.defeatedOn ?? null,
  };
}

function toView(boss: StoredBoss, today: string): BossView {
  return {
    startDay: boss.startDay,
    endDay: boss.endDay,
    front: boss.front,
    back: boss.back,
    deckName: boss.deckName ?? "",
    lapses: boss.lapses,
    status: bossStatus(rowOf(boss), today),
  };
}

/**
 * The boss staying on `today`, choosing a new one when the last one's week is
 * over. Two requests racing to choose both land on one row: the insert only
 * happens if the day has no boss yet, and both read that row back.
 */
async function bossFor(today: string): Promise<StoredBoss | null> {
  const latest = await Boss.findOne().sort({ startDay: -1 }).lean<StoredBoss>();
  if (latest && latest.endDay >= today) return latest;

  const [candidates, past] = await Promise.all([
    Card.find({ lapses: { $gte: BOSS_MIN_LAPSES } }).select({ lapses: 1 }).lean(),
    Boss.find().sort({ startDay: -1 }).select({ cardId: 1, lapses: 1, defeatedOn: 1 }).lean(),
  ]);
  const id = pickBoss(
    candidates.map((card) => ({ id: String(card._id), lapses: card.lapses })),
    past.map((boss) => ({ cardId: String(boss.cardId), lapses: boss.lapses, defeated: boss.defeatedOn != null })),
  );
  if (!id) return null;

  const card = await Card.findById(id).select({ deckId: 1, front: 1, back: 1, lapses: 1 }).lean();
  if (!card) return null;
  const deck = await Deck.findById(card.deckId).select({ name: 1 }).lean();

  try {
    await Boss.updateOne(
      { startDay: today },
      {
        $setOnInsert: {
          startDay: today,
          endDay: addDays(today, BOSS_DAYS - 1),
          cardId: card._id,
          deckId: card.deckId,
          deckName: deck?.name ?? "",
          front: card.front,
          back: card.back,
          lapses: card.lapses,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // Another request inserted the day first: its pick stands.
    if ((error as { code?: number }).code !== 11000) throw error;
  }
  return Boss.findOne({ startDay: today }).lean<StoredBoss>();
}

/** This week's boss, the trophy case, and how close the next boss is, on the player's calendar. */
export async function getBossScreen(timeZoneRaw: string, now: Date = new Date()): Promise<BossScreen> {
  await connectToDatabase();
  const today = dayKey(now, safeTimeZone(timeZoneRaw));

  const boss = await bossFor(today);
  const [trophies, escaped, closest] = await Promise.all([
    Boss.find({ defeatedOn: { $ne: null } })
      .sort({ defeatedOn: -1 })
      .select({ startDay: 1, front: 1, back: 1, deckName: 1, lapses: 1, defeatedOn: 1 })
      .lean(),
    Boss.countDocuments({ defeatedOn: null, endDay: { $lt: today } }),
    boss
      ? null
      : Card.findOne({ lapses: { $gt: 0 } }).sort({ lapses: -1 }).select({ front: 1, lapses: 1 }).lean(),
  ]);

  return {
    today,
    boss: boss ? toView(boss, today) : null,
    closest: closest ? { front: closest.front, lapses: closest.lapses } : null,
    trophies: trophies.map((trophy) => ({
      startDay: trophy.startDay,
      front: trophy.front,
      back: trophy.back,
      deckName: trophy.deckName ?? "",
      lapses: trophy.lapses,
      defeatedOn: trophy.defeatedOn ?? "",
    })),
    escaped,
  };
}

export type BossOutcome =
  | { ok: true; status: BossStatus; defeated: boolean; xp: number }
  | { ok: false; message: string };

/**
 * One fight: say whether you knew the boss's word on `day`. A day takes one
 * fight. Yesterday is still accepted, so a card opened just before midnight
 * can be answered just after it. The third day in a row known beats it.
 */
export async function fightBoss(
  startDay: unknown,
  day: unknown,
  result: unknown,
  timeZoneRaw: string,
  now: Date = new Date(),
): Promise<BossOutcome> {
  if (!isDayKey(startDay) || !isDayKey(day) || !isWordResult(result)) {
    return { ok: false, message: "That answer could not be read." };
  }

  const today = dayKey(now, safeTimeZone(timeZoneRaw));
  if (day !== today && day !== previousDay(today)) {
    return { ok: false, message: "That fight's day is over." };
  }

  await connectToDatabase();
  const boss = await Boss.findOne({ startDay }).lean<StoredBoss>();
  if (!boss) return { ok: false, message: "That boss could not be found." };
  if (boss.defeatedOn) return { ok: false, message: "That boss is already beaten." };
  if (day < boss.startDay || day > boss.endDay) return { ok: false, message: "That boss has gone." };

  // One fight a day, in order: nothing on this day or after it yet.
  const pushed = await Boss.updateOne(
    { _id: boss._id, defeatedOn: null, "answers.day": { $not: { $gte: day } } },
    { $push: { answers: { day, result } } },
  );
  if (pushed.modifiedCount === 0) {
    return { ok: false, message: "You already fought it today." };
  }

  const answers = [...answersOf(boss), { day, result }];
  let defeated = false;
  if (result === "knew" && hitsInARow(answers, today) >= BOSS_HEARTS) {
    const won = await Boss.updateOne(
      { _id: boss._id, defeatedOn: null },
      { $set: { defeatedOn: day, xp: BOSS_XP } },
    );
    defeated = won.modifiedCount === 1;
  }

  const saved = await Boss.findById(boss._id).lean<StoredBoss>();
  return {
    ok: true,
    status: bossStatus(rowOf(saved ?? boss), today),
    defeated,
    xp: defeated ? BOSS_XP : 0,
  };
}

/** XP from beaten bosses, all time. Part of the player's XP. */
export async function bossXp(): Promise<number> {
  await connectToDatabase();
  const [row] = await Boss.aggregate<{ xp: number }>([
    { $group: { _id: null, xp: { $sum: { $ifNull: ["$xp", 0] } } } },
  ]);
  return row?.xp ?? 0;
}
