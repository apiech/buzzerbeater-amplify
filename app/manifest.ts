import type { MetadataRoute } from "next";

import {
  siteDescription,
  siteName,
  siteShortName,
  siteTagline,
} from "@/app/site-config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteName,
    short_name: siteShortName,
    description: `${siteDescription} ${siteTagline}`,
    start_url: "/",
    scope: "/",
    display: "browser",
    background_color: "#f3ecdf",
    theme_color: "#f3ecdf",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
