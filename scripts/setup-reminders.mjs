/**
 * Sets up evening reminders: the VAPID key pair that signs every notification,
 * and the CRON_SECRET that only Vercel Cron knows, written to .env.local.
 *
 *   npm run setup-reminders              write .env.local
 *   npm run setup-reminders -- --vercel  ...and send the same values to Vercel
 *
 * Existing keys are kept. A new key pair would cut off every device that has
 * already turned reminders on, so pass --new-keys only if you mean that.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import webpush from "web-push";

const ENV_FILE = ".env.local";

/** These values are base64url: nothing in them needs escaping for dotenv. */
function upsert(contents, key, value) {
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(contents)) return contents.replace(pattern, line);
  return contents.replace(/\n*$/, "\n") + line + "\n";
}

function read(contents, key) {
  return new RegExp(`^${key}="?([^"\\n]*)"?$`, "m").exec(contents)?.[1] || null;
}

let contents = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";

let publicKey = read(contents, "VAPID_PUBLIC_KEY");
let privateKey = read(contents, "VAPID_PRIVATE_KEY");
if (!publicKey || !privateKey || process.argv.includes("--new-keys")) {
  ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
  console.log("Generated a new VAPID key pair.");
} else {
  console.log("Kept the existing VAPID key pair.");
}

let cronSecret = read(contents, "CRON_SECRET");
if (!cronSecret) {
  cronSecret = randomBytes(32).toString("base64url");
  console.log("Generated CRON_SECRET.");
}

contents = upsert(contents, "VAPID_PUBLIC_KEY", publicKey);
contents = upsert(contents, "VAPID_PRIVATE_KEY", privateKey);
contents = upsert(contents, "CRON_SECRET", cronSecret);
writeFileSync(ENV_FILE, contents, "utf8");
console.log(`Wrote VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and CRON_SECRET to ${ENV_FILE}.`);

if (process.argv.includes("--vercel")) {
  const { spawn } = await import("node:child_process");

  // Same approach as set-password: the value goes in on stdin, and Windows
  // needs a shell to run vercel.cmd. Every word of the command is a literal.
  const push = (key, value) =>
    new Promise((resolve) => {
      const child =
        process.platform === "win32"
          ? spawn(`vercel env add ${key} production --force`, {
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
    ["VAPID_PUBLIC_KEY", publicKey],
    ["VAPID_PRIVATE_KEY", privateKey],
    ["CRON_SECRET", cronSecret],
  ]) {
    const ok = await push(key, value);
    console.log(`${key} -> ${ok ? "sent to Vercel production" : "FAILED (is the CLI installed and linked?)"}`);
  }

  console.log("\nRedeploy for the new values to take effect:");
  console.log('  git commit --allow-empty -m "Redeploy"');
  console.log("  git push");
}
