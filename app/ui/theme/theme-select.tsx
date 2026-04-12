"use client";

import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { saveThemePreferenceMutation } from "@/app/dashboard/workspace-query-client";
import { DEFAULT_THEME_ID, themeOptions, type ThemeId } from "@/app/theme";
import { Field, Select } from "@/app/ui/primitives/field";
import {
  captureAnalyticsEvent,
  registerAnalyticsProperties,
  setAnalyticsPersonProperties,
} from "@/lib/analytics/client";

export function ThemeSelect() {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [themeError, setThemeError] = useState<string | null>(null);
  const saveThemeMutation = useMutation({
    mutationFn: saveThemePreferenceMutation,
  });
  const isSaving = saveThemeMutation.isPending;

  useEffect(() => {
    const currentTheme =
      (document.documentElement.getAttribute("data-theme") as ThemeId | null) ??
      DEFAULT_THEME_ID;
    setTheme(currentTheme);
    registerAnalyticsProperties({
      app_theme: currentTheme,
    });
    setAnalyticsPersonProperties({
      app_theme: currentTheme,
    });
  }, []);

  async function handleThemeChange(nextTheme: ThemeId) {
    const previousTheme = theme;
    setTheme(nextTheme);
    setThemeError(null);
    document.documentElement.setAttribute("data-theme", nextTheme);

    try {
      await saveThemeMutation.mutateAsync(nextTheme);
      captureAnalyticsEvent("theme_changed", {
        next_theme: nextTheme,
        previous_theme: previousTheme,
        source: "theme_select",
      });
      registerAnalyticsProperties({
        app_theme: nextTheme,
      });
      setAnalyticsPersonProperties({
        app_theme: nextTheme,
      });
    } catch (error) {
      setTheme(previousTheme);
      document.documentElement.setAttribute("data-theme", previousTheme);
      captureAnalyticsEvent("theme_change_failed", {
        next_theme: nextTheme,
        previous_theme: previousTheme,
        source: "theme_select",
      });
      setThemeError(
        error instanceof Error
          ? error.message
          : "Unable to save your theme preference.",
      );
    }
  }

  return (
    <Field
      hint={
        themeError ??
        themeOptions.find((option) => option.id === theme)?.description
      }
      label="Theme"
    >
      <Select
        disabled={isSaving}
        onChange={(event) =>
          void handleThemeChange(event.target.value as ThemeId)
        }
        value={theme}
      >
        {themeOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
