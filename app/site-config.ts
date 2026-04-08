import type { Metadata, Viewport } from "next";

import { siteUrl } from "@/config/public-site";

export const siteName = "BuzzerBeater Assistant Coach";
export const siteShortName = "BB Coach";
export const siteTagline =
  "Private scouting, lineups, and league context for your club.";
export const siteDescription =
  "A private BuzzerBeater companion for club prep, opponent reads, league context, and roster decisions.";
export const siteKeywords = [
  "BuzzerBeater",
  "basketball manager",
  "scouting",
  "lineup planning",
  "league context",
  "match prep",
] as const;

export const sharedViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3ecdf" },
    { media: "(prefers-color-scheme: dark)", color: "#101822" },
  ],
};

export const sharedMetadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: siteName,
  title: {
    default: siteName,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
  keywords: [...siteKeywords],
  category: "sports",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

type PageMetadataOptions = {
  description: string;
  noindex?: boolean;
  path: string;
  title?: string;
};

export function createPageMetadata({
  description,
  noindex = false,
  path,
  title,
}: PageMetadataOptions): Metadata {
  const pageTitle = title ? `${title} | ${siteName}` : siteName;
  const robots = noindex
    ? {
        index: false,
        follow: false,
        googleBot: {
          index: false,
          follow: false,
          "max-image-preview": "none" as const,
          "max-snippet": -1,
          "max-video-preview": -1,
        },
      }
    : undefined;

  return {
    title,
    description,
    alternates: {
      canonical: path,
    },
    openGraph: {
      type: "website",
      url: path,
      title: pageTitle,
      description,
      siteName,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: `${siteName} preview card`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description,
      images: ["/twitter-image"],
    },
    robots,
  };
}
