// mongoose ships as CommonJS: importing its values as named ESM bindings works
// under the bundler but not under plain Node, which the test runner uses.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

import { DEFAULT_DAILY_GOAL, MAX_DAILY_GOAL, MIN_DAILY_GOAL, XP_PER_ANSWER } from "@/lib/game";
import { DEFAULT_CONFIG, GRADES } from "@/lib/srs/types";
import { WORD_RESULTS } from "@/lib/word-of-the-day";

/**
 * Deck settings that feed the scheduler. Only the knobs worth exposing per
 * deck live here; the rest come from DEFAULT_CONFIG.
 *
 * There is deliberately no daily cap on new cards: this app reviews words that
 * were already learned elsewhere, so holding them back would just keep known
 * words out of rotation.
 */
const deckSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: "", trim: true, maxlength: 500 },
    learningStepsMinutes: {
      type: [Number],
      default: () => [...DEFAULT_CONFIG.learningStepsMinutes],
    },
    relearningStepsMinutes: {
      type: [Number],
      default: () => [...DEFAULT_CONFIG.relearningStepsMinutes],
    },
    /** Highest Blitz score on this deck. Blitz never touches scheduling. */
    blitzBest: { type: Number, default: 0 },
  },
  { timestamps: true },
);

/**
 * Settings for the one person using the app. A single document, keyed so an
 * upsert always lands on the same row.
 */
const profileSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "owner" },
    dailyGoal: {
      type: Number,
      default: DEFAULT_DAILY_GOAL,
      min: MIN_DAILY_GOAL,
      max: MAX_DAILY_GOAL,
    },
    /** The day (YYYY-MM-DD) the last evening reminder went out, so it goes once a day. */
    lastReminderDay: { type: String, default: null },
  },
  { timestamps: true },
);

/**
 * A streak freeze, bought with XP. It waits until a day ends without the goal,
 * then covers that day so the streak survives it.
 */
const streakFreezeSchema = new Schema(
  {
    /** The day it was bought, YYYY-MM-DD on the player's calendar. It covers that day or a later one. */
    boughtDay: { type: String, required: true },
    /** The XP it cost, kept per freeze so a later price change leaves past ones alone. */
    cost: { type: Number, required: true, min: 0 },
    /** The missed day it covered, or null while it is still held. */
    usedOn: { type: String, default: null },
  },
  { timestamps: true },
);

// One freeze per missed day, even when two requests spend freezes at once.
streakFreezeSchema.index(
  { usedOn: 1 },
  { unique: true, partialFilterExpression: { usedOn: { $type: "string" } } },
);

const cardSchema = new Schema(
  {
    deckId: { type: Schema.Types.ObjectId, ref: "Deck", required: true, index: true },
    front: { type: String, required: true, trim: true },
    back: { type: String, required: true, trim: true },
    /** A sentence using the word, e.g. the line of a video it was picked from. Optional. */
    example: { type: String, default: "", trim: true },

    // --- scheduling state, mirroring ReviewState in src/lib/srs/types.ts ---
    state: {
      type: String,
      enum: ["new", "learning", "review", "relearning"],
      default: "new",
    },
    step: { type: Number, default: 0 },
    intervalDays: { type: Number, default: 0 },
    ease: { type: Number, default: DEFAULT_CONFIG.startingEase },
    due: { type: Date, default: () => new Date() },
    lapses: { type: Number, default: 0 },
    reps: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// The queue query: "cards in this deck that are due, soonest first".
cardSchema.index({ deckId: 1, due: 1 });
// Counting and drawing new cards.
cardSchema.index({ deckId: 1, state: 1 });

/**
 * One row per answer. Drives undo and the "answered today" count, shows review
 * history, and the record you would retune the scheduler against later.
 */
const reviewLogSchema = new Schema({
  cardId: { type: Schema.Types.ObjectId, ref: "Card", required: true, index: true },
  deckId: { type: Schema.Types.ObjectId, ref: "Deck", required: true },
  grade: { type: String, enum: [...GRADES], required: true },
  /**
   * The card's complete scheduling state before this answer. Undo restores it
   * verbatim, which is only possible because the whole of it is kept -- a
   * partial record would quietly lose the ease or the step.
   */
  before: {
    state: {
      type: String,
      enum: ["new", "learning", "review", "relearning"],
      required: true,
    },
    step: { type: Number, required: true },
    intervalDays: { type: Number, required: true },
    ease: { type: Number, required: true },
    due: { type: Date, required: true },
    lapses: { type: Number, required: true },
    reps: { type: Number, required: true },
  },
  intervalDaysAfter: { type: Number, required: true },
  easeAfter: { type: Number, required: true },
  reviewedAt: { type: Date, default: () => new Date() },
  /** How long the card was on screen, when the client reports it. */
  elapsedMs: { type: Number, default: null },
  /**
   * XP this answer earned. Kept on the row so undo takes the XP back with it.
   * Rows written before XP existed count as the base amount.
   */
  xp: { type: Number, default: XP_PER_ANSWER },
});

reviewLogSchema.index({ deckId: 1, reviewedAt: -1 });
// Daily counts for the streak, across every deck.
reviewLogSchema.index({ reviewedAt: -1 });

/**
 * One row per day of Word of the Day. The word is copied onto the row when it
 * is picked, so the history still reads right after the card is edited or
 * deleted, and the pick for a day never changes once made.
 */
const dailyWordSchema = new Schema(
  {
    /** YYYY-MM-DD on the player's calendar. */
    day: { type: String, required: true, unique: true },
    cardId: { type: Schema.Types.ObjectId, ref: "Card", required: true },
    deckId: { type: Schema.Types.ObjectId, ref: "Deck", required: true },
    deckName: { type: String, default: "" },
    front: { type: String, required: true },
    back: { type: String, required: true },
    /** Null until answered. */
    result: { type: String, enum: [...WORD_RESULTS], default: null },
    answeredAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/**
 * A boss: a word you keep forgetting, back for a week to be beaten. One row
 * per boss. Like the daily word, the word is copied onto the row, so the
 * trophy case still reads right after the card is edited or deleted.
 */
const bossSchema = new Schema(
  {
    /** The first and last day of its stay, YYYY-MM-DD on the player's calendar. */
    startDay: { type: String, required: true, unique: true },
    endDay: { type: String, required: true },
    cardId: { type: Schema.Types.ObjectId, ref: "Card", required: true },
    deckId: { type: Schema.Types.ObjectId, ref: "Deck", required: true },
    deckName: { type: String, default: "" },
    front: { type: String, required: true },
    back: { type: String, required: true },
    /** How many times the card had lapsed when it became a boss. */
    lapses: { type: Number, required: true },
    /** One fight a day, oldest first. */
    answers: {
      type: [
        {
          _id: false,
          day: { type: String, required: true },
          result: { type: String, enum: [...WORD_RESULTS], required: true },
        },
      ],
      default: [],
    },
    /** The day it was beaten, or null. */
    defeatedOn: { type: String, default: null },
    /** XP the win earned. It counts towards the player's XP like an answer's. */
    xp: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// The trophy case and the weekly recap: bosses by the day they were beaten.
bossSchema.index({ defeatedOn: -1 });

/**
 * A phone or browser that turned reminders on. One row per push subscription:
 * the endpoint is the address the browser's push service gave it, and the
 * keys encrypt what is sent there.
 */
const pushDeviceSchema = new Schema(
  {
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    /** The device's time zone when it subscribed, so the job knows whose evening it is. */
    timeZone: { type: String, default: "UTC" },
    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/**
 * A video's transcript, saved the first time it is opened so YouTube is asked
 * once per video, not on every visit. A video has one row for YouTube's
 * captions and, if someone uploads their own, a second under the language
 * "custom".
 */
const transcriptSchema = new Schema(
  {
    videoId: { type: String, required: true },
    lang: { type: String, required: true },
    languageName: { type: String, default: "" },
    /** YouTube's auto-generated captions, rather than ones a person wrote. */
    auto: { type: Boolean, default: false },
    title: { type: String, default: "" },
    source: { type: String, enum: ["youtube", "supadata", "upload"], required: true },
    /** False for pasted plain text, which has no times to follow the video by. */
    timed: { type: Boolean, default: true },
    lines: {
      type: [{ _id: false, start: { type: Number, required: true }, text: { type: String, required: true } }],
      default: [],
    },
  },
  { timestamps: true },
);

transcriptSchema.index({ videoId: 1, lang: 1 }, { unique: true });
// The "recently watched" list.
transcriptSchema.index({ updatedAt: -1 });

export type DeckDocument = InferSchemaType<typeof deckSchema>;
export type TranscriptDocument = InferSchemaType<typeof transcriptSchema>;
export type DailyWordDocument = InferSchemaType<typeof dailyWordSchema>;
export type BossDocument = InferSchemaType<typeof bossSchema>;
export type PushDeviceDocument = InferSchemaType<typeof pushDeviceSchema>;
export type ProfileDocument = InferSchemaType<typeof profileSchema>;
export type StreakFreezeDocument = InferSchemaType<typeof streakFreezeSchema>;
export type CardDocument = InferSchemaType<typeof cardSchema>;
export type ReviewLogDocument = InferSchemaType<typeof reviewLogSchema>;

/**
 * Compiling a model twice is an error in Mongoose, so a registered model is
 * normally reused. In development that reuse is a trap: a hot reload keeps the
 * *old* schema registered, so edits to a schema appear to do nothing and writes
 * fail validation against a schema no longer in the source. Outside production
 * the stale registration is therefore dropped first.
 *
 * Deliberately not a generic helper -- taking a `Schema` as a parameter makes
 * TypeScript instantiate Mongoose's schema types far enough to exhaust the
 * compiler's heap.
 */
function dropStaleModel(name: string): void {
  if (models[name] && process.env.NODE_ENV !== "production") {
    mongoose.deleteModel(name);
  }
}

dropStaleModel("Deck");
export const Deck: Model<DeckDocument> =
  (models.Deck as Model<DeckDocument>) || model("Deck", deckSchema);

dropStaleModel("Card");
export const Card: Model<CardDocument> =
  (models.Card as Model<CardDocument>) || model("Card", cardSchema);

dropStaleModel("ReviewLog");
export const ReviewLog: Model<ReviewLogDocument> =
  (models.ReviewLog as Model<ReviewLogDocument>) ||
  model("ReviewLog", reviewLogSchema);

dropStaleModel("Profile");
export const Profile: Model<ProfileDocument> =
  (models.Profile as Model<ProfileDocument>) || model("Profile", profileSchema);

dropStaleModel("StreakFreeze");
export const StreakFreeze: Model<StreakFreezeDocument> =
  (models.StreakFreeze as Model<StreakFreezeDocument>) || model("StreakFreeze", streakFreezeSchema);

dropStaleModel("DailyWord");
export const DailyWord: Model<DailyWordDocument> =
  (models.DailyWord as Model<DailyWordDocument>) || model("DailyWord", dailyWordSchema);

dropStaleModel("Boss");
export const Boss: Model<BossDocument> =
  (models.Boss as Model<BossDocument>) || model("Boss", bossSchema);

dropStaleModel("PushDevice");
export const PushDevice: Model<PushDeviceDocument> =
  (models.PushDevice as Model<PushDeviceDocument>) || model("PushDevice", pushDeviceSchema);

dropStaleModel("Transcript");
export const Transcript: Model<TranscriptDocument> =
  (models.Transcript as Model<TranscriptDocument>) || model("Transcript", transcriptSchema);
