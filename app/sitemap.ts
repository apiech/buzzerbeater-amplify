import type { MetadataRoute } from "next";

import { commercialModeEnabled } from "@/config/commercial-mode";
import { siteOrigin } from "@/config/public-site";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const entries: MetadataRoute.Sitemap = [
    {
      url: siteOrigin,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  if (commercialModeEnabled) {
    entries.push({
      url: `${siteOrigin}/store`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  return entries;
}
