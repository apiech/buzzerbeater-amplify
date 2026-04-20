import Link from "next/link";

import {
  getServerCurrentUser,
  resolveServerViewerLabel,
} from "@/app/server/amplify-server";
import { createPageMetadata, siteDescription } from "@/app/site-config";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";
import { BrandMark } from "@/app/ui/brand/brand-mark";
import { commercialModeEnabled } from "@/config/commercial-mode";

const primaryLinkClassName =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-accent-contrast shadow-sm transition duration-150 hover:border-accent-strong hover:bg-accent-strong";
const secondaryLinkClassName =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-border-soft bg-white/70 px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition duration-150 hover:-translate-y-px hover:border-accent/35 hover:bg-white/90";
const tertiaryLinkClassName =
  "inline-flex min-h-11 items-center justify-center rounded-full px-3 text-sm font-semibold text-ink-muted transition duration-150 hover:text-ink";

const featureCards = [
  {
    title: "Club overview",
    description:
      "Keep your roster health, recent form, and next-match prep in one private workspace.",
  },
  {
    title: "Opponent reads",
    description:
      "Pull tendencies, recent box scores, and scouting context without hopping across tabs.",
  },
  {
    title: "League context",
    description:
      "Keep standings, rivals, and season history close enough to use during actual prep.",
  },
  {
    title: "Lineup decisions",
    description:
      "Work through lineups, predictions, and recaps with the same team data underneath.",
  },
] as const;

export const metadata = createPageMetadata({
  path: "/",
  description: siteDescription,
});

export default async function HomePage() {
  const currentUser = await getServerCurrentUser();
  const viewerLabel = currentUser
    ? await resolveServerViewerLabel(currentUser)
    : null;

  return (
    <main className="grid gap-6 p-4 sm:p-6">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.9fr)]">
        <Panel as="section" className="gap-8" padding="lg">
          <div className="flex items-start gap-4">
            <BrandMark className="size-18 sm:size-20" />
            <div className="grid gap-2">
              <p className="text-accent m-0 text-[0.76rem] font-bold tracking-[0.18em] uppercase">
                BuzzerBeater Assistant Coach
              </p>
              <p className="text-ink-muted m-0 text-sm leading-6">
                {viewerLabel ? (
                  <>
                    Signed in as{" "}
                    <span className="text-ink font-semibold">
                      {viewerLabel}
                    </span>
                    .
                  </>
                ) : (
                  "Private BuzzerBeater prep for your club, your opponents, and your league context."
                )}
              </p>
            </div>
          </div>

          <SectionHeading
            description="A lightweight home page for getting into the app quickly. The public site stays small on purpose; the real work happens inside the private workspace."
            eyebrow="Private companion"
            title="Keep club prep, opponent reads, and lineup planning in one place."
            titleAs="h1"
          />

          <div className="flex flex-wrap items-center gap-3">
            {currentUser ? (
              <>
                <Link className={primaryLinkClassName} href="/workspace/home">
                  Open workspace
                </Link>
                <Link className={secondaryLinkClassName} href="/workspace/ops">
                  Account settings
                </Link>
              </>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- auth routes must hard-navigate to Cognito */}
                <a className={primaryLinkClassName} href="/api/auth/sign-in">
                  Sign in
                </a>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- auth routes must hard-navigate to Cognito */}
                <a className={secondaryLinkClassName} href="/api/auth/sign-up">
                  Create account
                </a>
              </>
            )}
            {commercialModeEnabled ? (
              <Link className={tertiaryLinkClassName} href="/store">
                Visit the store
              </Link>
            ) : null}
          </div>
        </Panel>

        <Panel as="section" className="gap-4" variant="solid">
          <div className="grid gap-2">
            <p className="text-accent m-0 text-[0.76rem] font-bold tracking-[0.18em] uppercase">
              Small public surface
            </p>
            <h2 className="text-ink m-0 text-2xl font-semibold tracking-[-0.04em]">
              Built to get you into the workspace fast.
            </h2>
          </div>
          <p className="text-ink-muted m-0 text-sm leading-7">
            {commercialModeEnabled
              ? "Sign-in and account creation stay public. The store exists for direct support, but it is secondary to the main app."
              : "Sign-in and account creation stay public. The rest of the product lives behind your private workspace."}
          </p>
          <div className="rounded-card border-border-soft grid gap-3 border bg-white/65 p-4">
            <strong className="text-ink text-sm">Private by default</strong>
            <p className="text-ink-muted m-0 text-sm leading-6">
              Workspace data, account settings, and billing details stay behind
              your app session. Public pages are limited to the homepage,
              secure sign-in
              {commercialModeEnabled ? ", and store." : "."}
            </p>
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {featureCards.map((card) => (
          <Panel
            key={card.title}
            as="article"
            className="gap-3"
            variant="solid"
          >
            <p className="text-accent m-0 text-[0.72rem] font-bold tracking-[0.16em] uppercase">
              {card.title}
            </p>
            <p className="text-ink-muted m-0 text-sm leading-7">
              {card.description}
            </p>
          </Panel>
        ))}
      </section>
    </main>
  );
}
