import type { Metadata } from "next";

import { SimplePredictionPageClient } from "@/app/workspace/simple/simple-prediction-page-client";

export const metadata: Metadata = {
  title: "Simple Prediction",
  description: "Minimal game prediction workspace.",
};

export default function SimplePredictionPage() {
  return <SimplePredictionPageClient />;
}
