import type { Metadata } from "next";

import { loadAmplifyOutputs } from "@/app/amplify-outputs";
import { LoginActions } from "@/app/login/login-actions";
import { createPageMetadata } from "@/app/site-config";
import { BrandMark } from "@/app/ui/brand/brand-mark";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { commercialModeEnabled } from "@/config/commercial-mode";
import {
  extractCognitoAuthDomainFromConfig,
  isAmazonCognitoManagedDomain,
} from "@/lib/env/auth-domain";

const authLinkClassName =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-accent-contrast shadow-sm transition duration-150 hover:border-accent-strong hover:bg-accent-strong";

const secondaryLinkClassName =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-border-soft bg-white/70 px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition duration-150 hover:-translate-y-px hover:border-accent/35 hover:bg-white/90";

export const metadata: Metadata = createPageMetadata({
  path: "/login",
  title: "Sign In",
  description:
    "Continue to the secure hosted sign-in flow for BuzzerBeater Assistant Coach and return to your private workspace when you finish.",
  noindex: true,
});

type LoginPageProps = {
  searchParams?: Promise<{
    mode?: string | string[] | undefined;
  }>;
};

function resolvePreferredFlow(
  value: string | string[] | undefined,
): "sign_in" | "sign_up" {
  const normalizedValue = Array.isArray(value) ? value[0] : value;
  return normalizedValue === "sign-up" ? "sign_up" : "sign_in";
}

async function resolveDisplayAuthHost(): Promise<string | null> {
  try {
    const outputs = await loadAmplifyOutputs();
    const domain = extractCognitoAuthDomainFromConfig(outputs);
    if (!domain || isAmazonCognitoManagedDomain(domain)) {
      return null;
    }

    return domain;
  } catch {
    return null;
  }
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const preferredFlow = resolvePreferredFlow(resolvedSearchParams?.mode);
  const isCreateAccountFlow = preferredFlow === "sign_up";
  const authHost = await resolveDisplayAuthHost();
  const trustBullets = [
    authHost
      ? `Credential entry continues on ${authHost}, the branded account domain for this app.`
      : "Credential entry continues on the secure account domain for this app.",
    "Your scouting data, billing, and private workspace stay behind the same authenticated session.",
    "When sign-in or account setup is complete, you come straight back to the workspace.",
  ] as const;
  const nextStepCards = [
    {
      title: "Choose your path",
      description:
        "Pick secure sign-in if you already have an account, or create a new one first.",
    },
    {
      title: authHost ? "Watch the URL bar" : "Finish account access",
      description: authHost
        ? `The next screen opens on ${authHost}. Finish sign-in, sign-up, or reset there without leaving the app's branded domain family.`
        : "The next screen opens on the secure account domain for this app. Finish sign-in, sign-up, or reset there.",
    },
    {
      title: "Return to work",
      description:
        "After the hosted flow finishes, the app brings you back with your private session ready.",
    },
  ] as const;

  return (
    <main className="grid min-h-screen gap-6 p-4 sm:p-6">
      <section className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <Panel as="section" className="gap-8" padding="lg">
          <div className="flex items-start gap-4">
            <BrandMark className="size-18 sm:size-20" />
            <div className="grid gap-2">
              <p className="text-accent m-0 text-[0.76rem] font-bold tracking-[0.18em] uppercase">
                BuzzerBeater Assistant Coach
              </p>
              <p className="text-ink-muted m-0 text-sm leading-6">
                Private scouting, lineup planning, and league context for your
                club.
              </p>
            </div>
          </div>

          <SectionHeading
            description={
              isCreateAccountFlow
                ? "Create your account through the secure hosted access flow, then come back here with the same private workspace session."
                : "Use the secure hosted sign-in flow for this app, then return directly to your private workspace."
            }
            eyebrow="Secure access"
            title={
              isCreateAccountFlow
                ? "Create your account with confidence."
                : "Continue to secure hosted sign-in."
            }
            titleAs="h1"
          />

          <p className="text-ink-muted m-0 max-w-3xl text-sm leading-7">
            Credential entry, account creation, password resets, and email
            confirmation continue on the secure account domain for this app.
            {authHost ? (
              <>
                {" "}
                You&apos;ll see{" "}
                <span className="text-ink font-semibold">{authHost}</span> in
                the URL bar before you enter credentials.
              </>
            ) : null}{" "}
            When you finish there, you&apos;ll return to this workspace with
            your session ready.
          </p>

          <ul className="grid list-none gap-3 p-0 sm:grid-cols-3">
            {trustBullets.map((bullet) => (
              <li
                key={bullet}
                className="rounded-card border-border-soft bg-white/65 p-4 text-sm leading-7 text-ink-muted shadow-sm"
              >
                {bullet}
              </li>
            ))}
          </ul>

          <div className="rounded-card border-border-soft grid gap-2 border bg-white/72 p-4">
            <strong className="text-ink text-sm">What happens next</strong>
            <p className="text-ink-muted m-0 text-sm leading-7">
              Choose one of the secure account actions below. We&apos;ll open
              {authHost ? (
                <>
                  {" "}
                  <span className="text-ink font-semibold">{authHost}</span>
                </>
              ) : (
                " the secure account domain"
              )}{" "}
              in this browser, you&apos;ll finish the auth step there, and then
              the app will bring you back to the private workspace.
            </p>
          </div>

          <LoginActions
            authLinkClassName={authLinkClassName}
            commercialModeEnabled={commercialModeEnabled}
            preferredFlow={preferredFlow}
            secondaryLinkClassName={secondaryLinkClassName}
          />
        </Panel>

        <div className="grid gap-4">
          <Panel as="section" className="gap-4" variant="solid">
            <div className="grid gap-2">
              <p className="text-accent m-0 text-[0.76rem] font-bold tracking-[0.18em] uppercase">
                Branded account domain
              </p>
              <h2 className="text-ink m-0 text-2xl font-semibold tracking-[-0.04em]">
                Private workspace, trusted account URL.
              </h2>
            </div>
            <p className="text-ink-muted m-0 text-sm leading-7">
              This app keeps the workspace UI on your main domain while the
              credential step happens on a dedicated secure account domain.
              {authHost ? (
                <>
                  {" "}
                  For this environment, that means the URL bar switches to{" "}
                  <span className="text-ink font-semibold">{authHost}</span>
                  before you sign in.
                </>
              ) : null}{" "}
              That gives us SSR-friendly sessions without turning the public
              app into a generic login wall.
            </p>
          </Panel>

          <Panel as="section" className="gap-4">
            <p className="text-accent m-0 text-[0.72rem] font-bold tracking-[0.16em] uppercase">
              Before you continue
            </p>
            <div className="grid gap-3">
              {nextStepCards.map((card, index) => (
                <div
                  key={card.title}
                  className="rounded-card border-border-soft grid gap-1 border bg-white/72 p-4"
                >
                  <strong className="text-ink text-sm">
                    {index + 1}. {card.title}
                  </strong>
                  <p className="text-ink-muted m-0 text-sm leading-7">
                    {card.description}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </section>
    </main>
  );
}
