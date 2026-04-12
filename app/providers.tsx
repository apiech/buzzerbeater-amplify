"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useState } from "react";

import {
  AnalyticsProvider,
  type AnalyticsProviderProps,
} from "@/app/analytics-provider";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        retry: 0,
      },
      queries: {
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 60 * 1000,
      },
    },
  });
}

export function AppProviders({
  analytics,
  children,
}: {
  analytics: Omit<AnalyticsProviderProps, "children">;
  children: React.ReactNode;
}) {
  const [queryClient] = useState(createQueryClient);

  return (
    <NuqsAdapter>
      <QueryClientProvider client={queryClient}>
        <AnalyticsProvider {...analytics}>{children}</AnalyticsProvider>
      </QueryClientProvider>
    </NuqsAdapter>
  );
}
