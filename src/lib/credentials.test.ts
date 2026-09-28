/**
 * The credential check is the whole of the authentication decision, so these
 * tests care most about the ways it could wrongly say yes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hash } from "bcryptjs";

import { ownerFromEnv, verifyOwner, type OwnerCredentials } from "@/lib/credentials";

const PASSWORD = "correct horse battery staple";

/** Cost 4 keeps the suite quick; production hashes are written at 12. */
const owner: OwnerCredentials = {
  email: "owner@example.com",
  passwordHash: await hash(PASSWORD, 4),
};

describe("verifyOwner", () => {
  it("accepts the right email and password", async () => {
    assert.equal(await verifyOwner(owner.email, PASSWORD, owner), true);
  });

  it("rejects the right email with the wrong password", async () => {
    assert.equal(await verifyOwner(owner.email, "hunter2", owner), false);
  });

  it("rejects the wrong email with the right password", async () => {
    assert.equal(await verifyOwner("someone@else.test", PASSWORD, owner), false);
  });

  it("rejects an empty password even though bcrypt will hash one", async () => {
    assert.equal(await verifyOwner(owner.email, "", owner), false);
  });

  it("ignores case and surrounding space in the email", async () => {
    assert.equal(await verifyOwner("  OWNER@Example.COM ", PASSWORD, owner), true);
  });

  it("does not ignore case or space in the password", async () => {
    assert.equal(await verifyOwner(owner.email, PASSWORD.toUpperCase(), owner), false);
    assert.equal(await verifyOwner(owner.email, ` ${PASSWORD}`, owner), false);
  });

  it("refuses everyone when no account is configured", async () => {
    // The failure that matters: an unconfigured deploy must lock people out,
    // never let them in.
    assert.equal(await verifyOwner(owner.email, PASSWORD, null), false);
    assert.equal(await verifyOwner("", "", null), false);
  });

  it("rejects non-string input instead of throwing", async () => {
    assert.equal(await verifyOwner(undefined, undefined, owner), false);
    assert.equal(await verifyOwner({}, [], owner), false);
    assert.equal(await verifyOwner(null, PASSWORD, owner), false);
  });

  it("takes a similar amount of time whether or not the email is known", async () => {
    // A fast "no" for unknown addresses and a slow one for the real address
    // would leak which address owns the account. Both paths must hash.
    const time = async (email: string) => {
      const started = process.hrtime.bigint();
      await verifyOwner(email, PASSWORD, owner);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    const known = await time(owner.email);
    const unknown = await time("nobody@example.test");

    // Generous: this is asserting "same order of magnitude", not a stopwatch.
    // Skipping the hash entirely would make `unknown` hundreds of times faster.
    assert.ok(
      unknown > known / 10,
      `unknown-email path returned far too quickly (${unknown}ms vs ${known}ms)`,
    );
  });
});

describe("ownerFromEnv", () => {
  it("reads both halves", () => {
    const result = ownerFromEnv({
      AUTH_USER_EMAIL: "a@b.test",
      AUTH_PASSWORD_HASH: "$2b$12$whatever",
    });

    assert.deepEqual(result, { email: "a@b.test", passwordHash: "$2b$12$whatever" });
  });

  it("trims stray whitespace from pasted values", () => {
    const result = ownerFromEnv({
      AUTH_USER_EMAIL: "  a@b.test  ",
      AUTH_PASSWORD_HASH: " $2b$12$whatever ",
    });

    assert.deepEqual(result, { email: "a@b.test", passwordHash: "$2b$12$whatever" });
  });

  it("returns null when either half is missing or blank", () => {
    assert.equal(ownerFromEnv({}), null);
    assert.equal(
      ownerFromEnv({ AUTH_USER_EMAIL: "a@b.test" }),
      null,
    );
    assert.equal(
      ownerFromEnv({ AUTH_PASSWORD_HASH: "$2b$12$x" }),
      null,
    );
    assert.equal(
      ownerFromEnv({
        AUTH_USER_EMAIL: "   ",
        AUTH_PASSWORD_HASH: "$2b$12$x",
      }),
      null,
    );
  });
});
