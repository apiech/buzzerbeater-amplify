import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

import { getServerCurrentUser } from "@/app/server/amplify-server";
import { sharedMetadata, sharedViewport } from "@/app/site-config";
import { resolveServerThemeId } from "@/app/server/theme-preferences";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = sharedMetadata;
export const viewport: Viewport = sharedViewport;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const currentUser = await getServerCurrentUser();
  const themeId = await resolveServerThemeId(currentUser?.userId);

  return (
    <html lang="en" data-theme={themeId}>
      <head>
        <link
          rel="manifest"
          href="/manifest.webmanifest"
          crossOrigin="use-credentials"
        />
      </head>
      <body className={`${spaceGrotesk.variable} font-sans`}>{children}</body>
    </html>
  );
}
