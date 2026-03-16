"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  themeOptions,
  type ThemeId,
} from "@/app/theme";
import { Field, Select } from "@/app/ui/primitives/field";

export function ThemeSelect() {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME_ID);

  useEffect(() => {
    const currentTheme =
      (document.documentElement.getAttribute("data-theme") as ThemeId | null) ??
      DEFAULT_THEME_ID;
    setTheme(currentTheme);
  }, []);

  function handleThemeChange(nextTheme: ThemeId) {
    setTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }

  return (
    <Field
      hint={themeOptions.find((option) => option.id === theme)?.description}
      label="Theme"
    >
      <Select
        onChange={(event) => handleThemeChange(event.target.value as ThemeId)}
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
