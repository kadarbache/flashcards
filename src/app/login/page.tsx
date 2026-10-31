import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LogoMark } from "@/components/icons";
import { LoginForm } from "@/components/login-form";
import { panel } from "@/components/ui";
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
    <div className="mx-auto max-w-sm space-y-6 py-6 sm:py-12">
      <div className="anim-rise text-center">
        <LogoMark className="anim-pop-in mx-auto h-16 w-16" />
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-ink-muted">Sign in to keep your streak going.</p>
      </div>

      {configured ? (
        <div className={`${panel} anim-rise`}>
          <LoginForm callbackUrl={target} />
        </div>
      ) : (
        <div className="space-y-2 rounded-3xl border border-hard/40 bg-hard/10 p-5 text-sm">
          <p className="font-bold text-hard">No account is configured.</p>
          <p className="text-ink-muted">
            Set <code>AUTH_USER_EMAIL</code> and <code>AUTH_PASSWORD_HASH</code>, then restart. Run{" "}
            <code>npm run set-password</code> to generate the hash.
          </p>
        </div>
      )}
    </div>
  );
}
