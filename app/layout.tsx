import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

import { DEFAULT_THEME_ID, getThemeInitScript } from "@/app/theme";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  title: "BuzzerBeater Assistant Coach",
  description:
    "A BuzzerBeater companion for team prep, opponent reads, league context, and roster decisions.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme={DEFAULT_THEME_ID}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
      </head>
      <body className={`${spaceGrotesk.variable} font-sans`}>{children}</body>
    </html>
  );
}
