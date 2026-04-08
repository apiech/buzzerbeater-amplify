import type { MetadataRoute } from "next";

import { commercialModeEnabled } from "@/config/commercial-mode";
import { siteOrigin } from "@/config/public-site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: commercialModeEnabled ? ["/", "/store"] : ["/"],
      disallow: ["/api/", "/login", "/workspace/"],
    },
    sitemap: `${siteOrigin}/sitemap.xml`,
    host: siteOrigin,
  };
}
