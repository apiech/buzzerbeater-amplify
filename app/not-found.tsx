import Link from "next/link";
import type { Metadata } from "next";

import { createPageMetadata } from "@/app/site-config";
import { BrandMark } from "@/app/ui/brand/brand-mark";
import { Panel } from "@/app/ui/primitives/panel";

const primaryLinkClassName =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-accent-contrast shadow-sm transition duration-150 hover:border-accent-strong hover:bg-accent-strong";
const secondaryLinkClassName =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-border-soft bg-white/70 px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition duration-150 hover:-translate-y-px hover:border-accent/35 hover:bg-white/90";

export const metadata: Metadata = createPageMetadata({
  path: "/",
  title: "Page Not Found",
  description: "The page you tried to open does not exist.",
  noindex: true,
});

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-4 sm:p-6">
      <Panel as="section" className="max-w-2xl gap-6" padding="lg">
        <div className="flex items-center gap-4">
          <BrandMark className="size-16" />
          <div className="grid gap-1">
            <p className="text-accent m-0 text-[0.76rem] font-bold tracking-[0.18em] uppercase">
              BuzzerBeater Assistant Coach
            </p>
            <h1 className="text-ink m-0 text-3xl font-semibold tracking-[-0.05em]">
              That page is not here.
            </h1>
          </div>
        </div>

        <p className="text-ink-muted m-0 text-sm leading-7">
          Head back to the homepage, open the workspace, or use the login helper
          to get back on track.
        </p>

        <div className="flex flex-wrap gap-3">
          <Link className={primaryLinkClassName} href="/">
            Go home
          </Link>
          <Link className={secondaryLinkClassName} href="/workspace/home">
            Open workspace
          </Link>
          <Link className={secondaryLinkClassName} href="/login">
            Login helper
          </Link>
        </div>
      </Panel>
    </main>
  );
}
