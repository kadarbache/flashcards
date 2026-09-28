import { auth } from "@/auth";

/**
 * Refuse to go on unless someone is signed in.
 *
 * Server Actions are POST endpoints. They are reachable directly, with no page
 * ever rendered, so the proxy redirect in front of the pages does not protect
 * them on its own -- and a gate implemented only in middleware has been a real
 * source of bypasses. Each action calls this first, which puts the check next
 * to the write it is guarding rather than three layers away from it.
 */
export async function requireSession(): Promise<void> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("You need to sign in to do that.");
  }
}
