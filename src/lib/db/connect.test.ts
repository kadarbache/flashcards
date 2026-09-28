/**
 * The connection cache is the one piece of state that outlives a request, so
 * what it does on failure matters more than what it does when everything works.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/connect";

/** Unroutable address: the connection attempt fails without waiting on DNS. */
const DEAD_URI = "mongodb://127.0.0.1:1/flashcards_nope";

let savedUri: string | undefined;

beforeEach(async () => {
  savedUri = process.env.MONGODB_URI;
  await mongoose.disconnect().catch(() => {});
  globalThis.mongooseCache = undefined;
});

afterEach(async () => {
  await mongoose.disconnect().catch(() => {});
  globalThis.mongooseCache = undefined;
  if (savedUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = savedUri;
});

describe("connectToDatabase", () => {
  it("explains itself when the URI is missing", async () => {
    delete process.env.MONGODB_URI;
    await assert.rejects(() => connectToDatabase(), /MONGODB_URI is not set/);
  });

  it(
    "leaves nothing behind when a connection attempt fails",
    { timeout: 60_000 },
    async () => {
      process.env.MONGODB_URI = DEAD_URI;

      await assert.rejects(() => connectToDatabase());

      // 0 === disconnected. A half-open connection here is what used to rot the
      // process: each retry stacked another pool on top of the last.
      assert.equal(
        mongoose.connection.readyState,
        0,
        "the failed attempt should have been torn down",
      );
    },
  );

  it(
    "does not accumulate connections across repeated failures",
    { timeout: 120_000 },
    async () => {
      process.env.MONGODB_URI = DEAD_URI;

      for (let attempt = 0; attempt < 5; attempt++) {
        await assert.rejects(() => connectToDatabase());
      }

      assert.equal(mongoose.connection.readyState, 0);
      assert.equal(
        mongoose.connections.filter((c) => c.readyState !== 0).length,
        0,
        "no connection should still be open after five failed attempts",
      );
    },
  );

  it(
    "recovers by itself once the database comes back",
    { timeout: 300_000 },
    async () => {
      // The behaviour the user actually hit: an outage, then recovery, with no
      // restart in between. Before the teardown fix the process stayed broken.
      process.env.MONGODB_URI = DEAD_URI;
      for (let attempt = 0; attempt < 3; attempt++) {
        await assert.rejects(() => connectToDatabase());
      }

      const mongo = await MongoMemoryServer.create();
      try {
        process.env.MONGODB_URI = mongo.getUri();
        const connection = await connectToDatabase();

        // 1 === connected.
        assert.equal(connection.connection.readyState, 1);
        await connection.connection.db!.admin().ping();
      } finally {
        await mongoose.disconnect().catch(() => {});
        await mongo.stop();
      }
    },
  );
});
