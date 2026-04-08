import type { Metadata } from "next";
import Link from "next/link";

import { getServerMaintenanceState } from "@/app/server/maintenance";
import { createPageMetadata } from "@/app/site-config";
import { Panel } from "@/app/ui/primitives/panel";
import { SectionHeading } from "@/app/ui/primitives/section-heading";

const primaryLinkClassName =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-accent-contrast shadow-sm transition duration-150 hover:border-accent-strong hover:bg-accent-strong";
const secondaryLinkClassName =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-border-soft bg-white/70 px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition duration-150 hover:-translate-y-px hover:border-accent/35 hover:bg-white/90";

export const metadata: Metadata = createPageMetadata({
  path: "/status",
  title: "Site Status",
  description:
    "Current maintenance status for BuzzerBeater Assistant Coach.",
  noindex: true,
});

export default async function StatusPage() {
  const state = await getServerMaintenanceState();
  const activeDocument = state.document;

  return (
    <main className="grid min-h-screen place-items-center p-4 sm:p-6">
      <Panel
        as="section"
        className="rounded-panel grid max-w-3xl gap-6 p-8 sm:rounded-[2rem]"
      >
        <div className="grid gap-4">
          <p className="text-accent text-[0.76rem] font-bold tracking-[0.18em] uppercase">
            BuzzerBeater Assistant Coach
          </p>
          <SectionHeading
            description={
              activeDocument
                ? "The app is intentionally unavailable right now. Reloading or returning to the site will apply the latest status immediately."
                : "No active maintenance document is set right now."
            }
            eyebrow="Status"
            title={activeDocument ? activeDocument.headline : "Site is available"}
          />
          <p className="text-ink-muted text-sm leading-7">
            {activeDocument
              ? activeDocument.detail
              : "The maintenance control plane is clear. You can return to the app."}
          </p>
        </div>

        {activeDocument ? (
          <div className="grid gap-3 rounded-3xl border border-black/8 bg-black/[0.03] p-4 text-sm text-ink-muted">
            <p className="m-0">
              Reason code:{" "}
              <span className="text-ink font-semibold">
                {activeDocument.reasonCode}
              </span>
            </p>
            <p className="m-0">
              Activated at:{" "}
              <span className="text-ink font-semibold">
                {formatTimestamp(activeDocument.activatedAt)}
              </span>
            </p>
            <p className="m-0">
              Activated by:{" "}
              <span className="text-ink font-semibold">
                {activeDocument.activatedBy}
              </span>
            </p>
            {activeDocument.expectedRecoveryAt ? (
              <p className="m-0">
                Expected recovery:{" "}
                <span className="text-ink font-semibold">
                  {formatTimestamp(activeDocument.expectedRecoveryAt)}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Link className={primaryLinkClassName} href="/status">
            Refresh status
          </Link>
          <Link className={secondaryLinkClassName} href="/">
            Try the site
          </Link>
        </div>
      </Panel>
    </main>
  );
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}
