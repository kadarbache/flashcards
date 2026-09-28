import mongoose from "mongoose";

/**
 * A single shared connection, cached on `globalThis`.
 *
 * Dev servers hot-reload this module on every edit and serverless functions
 * reuse the same process across invocations. Without the cache each reload
 * would open another connection and Atlas would eventually refuse them.
 */
declare global {
  var mongooseCache:
    | {
        connection: typeof mongoose | null;
        promise: Promise<typeof mongoose> | null;
        listening: boolean;
      }
    | undefined;
}

const cache = (globalThis.mongooseCache ??= {
  connection: null,
  promise: null,
  listening: false,
});

/**
 * The driver keeps retrying in the background after a failed connection and
 * emits `error` on the connection each time. With no listener attached those
 * become unhandled exceptions that surface *outside* any request's try/catch --
 * during React's streaming render, which kills the response instead of showing
 * the setup screen. Swallowing them here is the point: the failure is already
 * reported to whoever awaited `connectToDatabase`.
 */
function listenOnce(): void {
  if (cache.listening) return;
  cache.listening = true;
  mongoose.connection.on("error", () => {});
}

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.connection) return cache.connection;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Copy .env.example to .env.local and paste your MongoDB Atlas connection string.",
    );
  }

  listenOnce();

  cache.promise ??= mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB || "flashcards",
    // Fail fast with a readable error instead of hanging the request when the
    // URI is wrong, the IP is not allow-listed, or the cluster is paused.
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    // Reject queries straight away rather than parking them in a buffer while
    // the driver retries. A queued query would outlive the request that made it.
    bufferCommands: false,
    // One page render issues a handful of queries; there is no reason for a
    // single process to hold a pool anywhere near the driver's default of 100.
    maxPoolSize: 10,
  });

  try {
    cache.connection = await cache.promise;
  } catch (error) {
    cache.promise = null;
    // Tear the failed attempt down before anyone retries.
    //
    // Without this, every request during an outage left its half-built client
    // and connection pool behind, and the next request built another on top.
    // After a spell of downtime the process stayed slow *even once the database
    // came back* -- queries went from ~150ms to ~30s -- and only a restart
    // cleared it. Failing is fine; failing and leaving debris is not.
    try {
      await mongoose.disconnect();
    } catch {
      // Nothing useful to do if even the teardown fails.
    }
    throw error;
  }

  return cache.connection;
}
