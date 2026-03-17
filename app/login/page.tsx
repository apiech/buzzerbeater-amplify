import Link from "next/link";

import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";

const authLinkClassName =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-accent-contrast shadow-sm transition duration-150 hover:border-accent-strong hover:bg-accent-strong";

const secondaryLinkClassName =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-border-soft bg-white/70 px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition duration-150 hover:-translate-y-px hover:border-accent/35 hover:bg-white/90";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center p-4 sm:p-6">
      <Panel
        as="section"
        className="rounded-panel grid max-w-2xl gap-6 p-8 sm:rounded-[2rem]"
      >
        <div className="grid gap-4">
          <p className="text-accent text-[0.76rem] font-bold tracking-[0.18em] uppercase">
            BuzzerBeater Assistant Coach
          </p>
          <SectionHeading
            description="Authentication now runs through Amplify's server-side managed login so your account session and theme can be rendered correctly on the first response."
            eyebrow="Login"
            title="Sign in to your account"
          />
          <p className="text-ink-muted text-sm leading-7">
            Sign-in, sign-up, password reset, and account confirmation all
            continue in Cognito managed login. After you finish there, you will
            be returned to your workspace.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link className={authLinkClassName} href="/api/auth/sign-in">
            Sign in
          </Link>
          <Link className={secondaryLinkClassName} href="/api/auth/sign-up">
            Create account
          </Link>
        </div>
      </Panel>
    </main>
  );
}
