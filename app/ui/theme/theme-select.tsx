"use client";

import { useEffect, useState } from "react";

import { DEFAULT_THEME_ID, themeOptions, type ThemeId } from "@/app/theme";
import { Field, Select } from "@/app/ui/primitives/field";

export function ThemeSelect() {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [isSaving, setIsSaving] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);

  useEffect(() => {
    const currentTheme =
      (document.documentElement.getAttribute("data-theme") as ThemeId | null) ??
      DEFAULT_THEME_ID;
    setTheme(currentTheme);
  }, []);

  async function handleThemeChange(nextTheme: ThemeId) {
    const previousTheme = theme;
    setTheme(nextTheme);
    setThemeError(null);
    document.documentElement.setAttribute("data-theme", nextTheme);

    setIsSaving(true);
    try {
      const response = await fetch("/api/app/theme", {
        body: JSON.stringify({ themeId: nextTheme }),
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
        },
        method: "PUT",
      });

      const payload = (await response.json().catch(() => null)) as {
        errors?: Array<{ message?: string }>;
      } | null;
      if (!response.ok) {
        throw new Error(
          payload?.errors?.[0]?.message ??
            "Unable to save your theme preference.",
        );
      }
    } catch (error) {
      setTheme(previousTheme);
      document.documentElement.setAttribute("data-theme", previousTheme);
      setThemeError(
        error instanceof Error
          ? error.message
          : "Unable to save your theme preference.",
      );
    } finally {
      setIsSaving(false);
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
