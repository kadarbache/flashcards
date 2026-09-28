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
  const line = `${key}="${String(value).replace(/\$/g, "\\$")}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(contents)) return contents.replace(pattern, line);
  return contents.replace(/\n*$/, "\n") + line + "\n";
}

const email = await ask("Email for the account: ");
if (email === "") {
  console.error("An email is required.");
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
      const child = spawn(
        process.platform === "win32" ? "vercel.cmd" : "vercel",
        ["env", "add", key, "production", "--force"],
        { stdio: ["pipe", "ignore", "inherit"] },
      );
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
