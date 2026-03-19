import type { MetadataRoute } from "next";

import { siteOrigin } from "@/config/public-site";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: siteOrigin,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteOrigin}/store`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
