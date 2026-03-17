import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

import { getServerCurrentUser } from "@/app/server/amplify-server";
import { resolveServerThemeId } from "@/app/server/theme-preferences";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  title: "BuzzerBeater Assistant Coach",
  description:
    "A BuzzerBeater companion for team prep, opponent reads, league context, and roster decisions.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const currentUser = await getServerCurrentUser();
  const themeId = await resolveServerThemeId(currentUser?.userId);

  return (
    <html lang="en" data-theme={themeId}>
      <head />
      <body className={`${spaceGrotesk.variable} font-sans`}>{children}</body>
    </html>
  );
}
