import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LoginForm } from "@/components/login-form";
import { ownerFromEnv } from "@/lib/credentials";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Already signed in: there is nothing to do here.
  const session = await auth();
  if (session?.user) redirect("/");

  const { callbackUrl } = await searchParams;
  const target = typeof callbackUrl === "string" ? callbackUrl : "/";

  // Without credentials configured nobody can sign in, so say so plainly rather
  // than letting the form reject every attempt with "wrong email or password".
  const configured = ownerFromEnv() !== null;

  return (
    <div className="mx-auto max-w-sm space-y-6 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-ink-muted">
          This deck is private.
        </p>
      </div>

      {configured ? (
        <LoginForm callbackUrl={target} />
      ) : (
        <div className="space-y-2 rounded-lg border border-hard/40 bg-hard/10 px-4 py-3 text-sm">
          <p className="font-medium text-hard">No account is configured.</p>
          <p className="text-ink-muted">
            Set <code>AUTH_USER_EMAIL</code> and <code>AUTH_PASSWORD_HASH</code>, then
            restart. Run <code>npm run set-password</code> to generate the hash.
          </p>
        </div>
      )}
    </div>
  );
}
