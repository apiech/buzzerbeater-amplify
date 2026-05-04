import { createPageMetadata } from "@/app/site-config";

import { BBApiBrowserTestClient } from "./bbapi-browser-test-client";

export const metadata = createPageMetadata({
  path: "/bbapi-browser-test",
  title: "BB API Browser Test",
  description:
    "A browser-only diagnostic page for probing direct BuzzerBeater XML API access.",
  noindex: true,
});

export default function BBApiBrowserTestPage() {
  return <BBApiBrowserTestClient />;
}
