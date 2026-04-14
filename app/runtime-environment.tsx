"use client";

import { createContext, useContext } from "react";

type RuntimeEnvironmentValue = {
  environmentName: string;
};

const RuntimeEnvironmentContext =
  createContext<RuntimeEnvironmentValue | null>(null);

export function RuntimeEnvironmentProvider({
  children,
  environmentName,
}: {
  children: React.ReactNode;
  environmentName: string;
}) {
  return (
    <RuntimeEnvironmentContext.Provider value={{ environmentName }}>
      {children}
    </RuntimeEnvironmentContext.Provider>
  );
}

export function useRuntimeEnvironment(): RuntimeEnvironmentValue {
  const value = useContext(RuntimeEnvironmentContext);
  if (!value) {
    throw new Error("RuntimeEnvironmentProvider is required.");
  }
  return value;
}
