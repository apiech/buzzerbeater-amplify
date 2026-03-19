import type { MetadataRoute } from "next";

import { siteOrigin } from "@/config/public-site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/store"],
      disallow: ["/api/", "/login", "/workspace/"],
    },
    sitemap: `${siteOrigin}/sitemap.xml`,
    host: siteOrigin,
  };
}
