import { useSyncExternalStore } from "react";

// The colour theme, Ember (dark) or Parchment (light): data-theme on <html>, which index.css reads,
// kept in this device's storage
export type Theme = "dark" | "light";

const storageKey = "ashborn-theme";
const listeners = new Set<() => void>();

export function storedTheme(): Theme {
  try {
    return window.localStorage.getItem(storageKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme) {
  applyTheme(theme);
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    // Storage blocked: the theme lasts until the app closes
  }
  listeners.forEach((listener) => listener());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
  );
}

// The theme's ink as RGB (0-255), for drawing outside CSS
export function inkRgb(): [number, number, number] {
  const hex = getComputedStyle(document.documentElement).getPropertyValue("--color-ink").trim();
  const value = Number.parseInt(hex.slice(1), 16);
  return Number.isNaN(value) ? [255, 255, 255] : [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
