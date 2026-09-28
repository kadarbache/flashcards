import { compare } from "bcryptjs";

/**
 * The one account, as configured by the environment. There is no user table:
 * this app has a single owner, so a row in a database would be a row that is
 * always the same.
 */
export interface OwnerCredentials {
  email: string;
  passwordHash: string;
}

/**
 * A bcrypt hash of 32 random bytes that were thrown away. Nothing hashes to it,
 * which is the point -- see `verifyOwner`.
 */
const UNMATCHABLE_HASH =
  "$2b$12$uxrZvRXjAIf6hAHEH9kzme4BCyNLefiANOnAKL0iOt.xX8k2tkGR6";

/**
 * Reads the owner's credentials from the environment, or `null` if either half
 * is missing.
 *
 * Returning `null` rather than a partial object is what makes the app fail
 * closed: `verifyOwner` rejects everyone when it is handed `null`, so a deploy
 * that forgets these variables locks everybody out instead of letting anybody
 * in. The same reasoning as the HTTP API answering 503 without its key.
 */
export function ownerFromEnv(
  env?: Readonly<Record<string, string | undefined>>,
): OwnerCredentials | null {
  // `process.env.NAME` is written out in full rather than read through the
  // parameter, because Next substitutes these statically at build time and can
  // only do so when the property name is visible in the source. The optional
  // parameter exists so tests can supply an environment without touching the
  // real one.
  const email = (env ? env.AUTH_USER_EMAIL : process.env.AUTH_USER_EMAIL)?.trim();
  const passwordHash = (
    env ? env.AUTH_PASSWORD_HASH : process.env.AUTH_PASSWORD_HASH
  )?.trim();
  if (!email || !passwordHash) return null;
  return { email, passwordHash };
}

/**
 * Whether these credentials belong to the owner.
 *
 * The bcrypt comparison runs even when the address is already known to be
 * wrong, against a hash nothing matches. Skipping it would make a request with
 * an unknown address return in microseconds while a known one takes the ~200ms
 * bcrypt deliberately costs, and that difference is readable over the network
 * -- it would turn the login form into an oracle for "does this address own
 * the account". Doing the work regardless costs one hash on a page nobody
 * loads in a loop.
 */
export async function verifyOwner(
  email: unknown,
  password: unknown,
  owner: OwnerCredentials | null,
): Promise<boolean> {
  const suppliedEmail = typeof email === "string" ? email : "";
  const suppliedPassword = typeof password === "string" ? password : "";

  // Addresses are case- and whitespace-insensitive; passwords are neither.
  const emailMatches =
    owner !== null &&
    suppliedEmail.trim().toLowerCase() === owner.email.toLowerCase();

  const passwordMatches = await compare(
    suppliedPassword,
    emailMatches ? owner!.passwordHash : UNMATCHABLE_HASH,
  );

  return emailMatches && passwordMatches;
}
