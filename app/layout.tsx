import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "@aws-amplify/ui-react/styles.css";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  title: "BB Amplify",
  description:
    "Modern BuzzerBeater team, opponent, league, and player intelligence on Amplify Gen 2.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} font-sans`}>{children}</body>
    </html>
  );
}
