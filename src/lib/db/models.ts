// mongoose ships as CommonJS: importing its values as named ESM bindings works
// under the bundler but not under plain Node, which the test runner uses.
import mongoose from "mongoose";
import type { InferSchemaType, Model } from "mongoose";

const { Schema, model, models } = mongoose;

import { DEFAULT_CONFIG, GRADES } from "@/lib/srs/types";

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
  },
  { timestamps: true },
);

const cardSchema = new Schema(
  {
    deckId: { type: Schema.Types.ObjectId, ref: "Deck", required: true, index: true },
    front: { type: String, required: true, trim: true },
    back: { type: String, required: true, trim: true },

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
});

reviewLogSchema.index({ deckId: 1, reviewedAt: -1 });

export type DeckDocument = InferSchemaType<typeof deckSchema>;
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
