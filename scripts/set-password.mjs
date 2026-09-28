/**
 * Sets the owner's email and password hash in .env.local.
 *
 * The password is read from the terminal with echo off and hashed immediately;
 * only the bcrypt hash is written anywhere, and the plaintext never reaches a
 * file, a log, or an argv entry that `ps` could show.
 *
 *   node scripts/set-password.mjs
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";

import { hash } from "bcryptjs";

const ENV_FILE = ".env.local";
const COST = 12;

function ask(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Same as `ask`, but nothing is echoed while typing. */
function askSecret(question) {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  return new Promise((resolve) => {
    const onData = (char) => {
      // Stop muting once the line is submitted.
      if (["\n", "\r", "\u0004"].includes(char.toString())) {
        stdin.removeListener("data", onData);
      }
    };
    stdout.write(question);
    rl.output.write = () => {};
    stdin.on("data", onData);
    rl.question("", (answer) => {
      rl.close();
      stdout.write("\n");
      resolve(answer);
    });
  });
}

/**
 * Replaces KEY=... in place, or appends it if the key is new.
 *
 * Every `$` is escaped. The loader behind `.env` files expands `$NAME` as a
 * variable reference -- in double quotes, in single quotes, and unquoted alike
 * -- and a bcrypt hash is `$2b$12$...`, so an unescaped hash is read as three
 * undefined variables and arrives as an empty string. That failure is silent:
 * the app simply reports that no account is configured.
 *
 * This applies to the file only. Vercel and other hosts put environment
 * variables straight into the process, with no expansion, so the hash goes
 * there exactly as bcrypt produced it -- backslashes would become part of it.
 */
function upsert(contents, key, value) {
  // Backslashes first, then quotes, then `$` -- reordering these would escape
  // the escapes. An unescaped `"` would end the value early and leave the rest
  // of the line as junk the next parser trips over.
  const escaped = String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$");
  const line = `${key}="${escaped}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(contents)) return contents.replace(pattern, line);
  return contents.replace(/\n*$/, "\n") + line + "\n";
}

const email = await ask("Email for the account: ");

/*
 * Anything with an @, no spaces, and a dot in the domain. This is not trying to
 * validate email addresses -- it is catching the case where a pasted shell
 * command lands in this prompt, which otherwise sails through and becomes the
 * account name both here and on the host.
 */
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(
    email === ""
      ? "An email is required."
      : `That does not look like an email address: ${JSON.stringify(email)}`,
  );
  console.error("Nothing was written. Run the command again and enter just the address.");
  process.exit(1);
}

const password = await askSecret("Password (not shown): ");
const again = await askSecret("Again: ");

if (password.length < 10) {
  console.error("Use at least 10 characters. This is the only thing between the internet and your decks.");
  process.exit(1);
}
if (password !== again) {
  console.error("Those did not match.");
  process.exit(1);
}

let contents = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";

contents = upsert(contents, "AUTH_USER_EMAIL", email);
contents = upsert(contents, "AUTH_PASSWORD_HASH", await hash(password, COST));

// Auth.js signs session cookies with this. Generate one if there isn't one yet;
// changing it later just signs everyone out.
if (!/^AUTH_SECRET=.+$/m.test(contents)) {
  contents = upsert(contents, "AUTH_SECRET", randomBytes(32).toString("base64"));
  console.log("Generated AUTH_SECRET.");
}

writeFileSync(ENV_FILE, contents, "utf8");

console.log(`Wrote AUTH_USER_EMAIL and AUTH_PASSWORD_HASH to ${ENV_FILE}.`);
console.log("Restart the dev server for it to take effect.");

/*
 * With --vercel, send the same account to the deployed app.
 *
 * The hash goes up unescaped. The backslashes above exist only to survive
 * dotenv's variable expansion when reading the file; Vercel injects the value
 * into the process verbatim, so shipping the escaped form would make the
 * backslashes part of the stored hash and every password would be wrong -- in
 * production only, which is the worst place to find out.
 */
if (process.argv.includes("--vercel")) {
  const { spawn } = await import("node:child_process");

  const push = (key, value) =>
    new Promise((resolve) => {
      /*
       * `shell: true` on Windows is required, not stylistic. The Vercel CLI is
       * installed as vercel.cmd, and Node refuses to spawn a batch file
       * directly -- it throws EINVAL -- because doing so safely needs a shell
       * to interpret it. Nothing user-supplied reaches the argument list: the
       * key is one of two literals here and the value is written to stdin, so
       * there is no string for a shell to reinterpret.
       */
      const onWindows = process.platform === "win32";
      const child = onWindows
        ? // One string, no argument array: Node deprecates combining the two
          // (DEP0190) because it concatenates without escaping. Every word here
          // is a literal, so there is nothing to escape.
          spawn(`vercel env add ${key} production --force`, {
            stdio: ["pipe", "ignore", "inherit"],
            shell: true,
          })
        : spawn("vercel", ["env", "add", key, "production", "--force"], {
            stdio: ["pipe", "ignore", "inherit"],
          });
      child.stdin.end(value);
      child.on("close", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
    });

  for (const [key, value] of [
    ["AUTH_USER_EMAIL", email],
    ["AUTH_PASSWORD_HASH", await hash(password, COST)],
  ]) {
    const ok = await push(key, value);
    console.log(`${key} -> ${ok ? "sent to Vercel production" : "FAILED (is the CLI linked?)"}`);
  }

  console.log("Redeploy for the new values to take effect: git commit --allow-empty -m redeploy && git push");
}
