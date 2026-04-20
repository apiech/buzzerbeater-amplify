import type { Metadata } from "next";

import { SimpleSchedulePageClient } from "@/app/workspace/simple/simple-schedule-page-client";

export const metadata: Metadata = {
  title: "Simple Schedule",
  description: "Minimal opponent schedule workspace.",
};

export default function SimpleSchedulePage() {
  return <SimpleSchedulePageClient />;
}
