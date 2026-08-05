"use client";

/*
 * Theme and density state.
 *
 * VPS-D001 stores theme preference per user per device and defaults to system.
 * The prototype cannot persist it: CLAUDE.md forbids localStorage and
 * sessionStorage, so both controls work and reset on reload. That is an
 * accepted prototype limitation, not a disagreement with the specification.
 *
 * Both values land on the root element as data attributes. Nothing else in
 * the product reads them — every component resolves its own values through
 * the token variables those attributes switch.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  Density,
  ResolvedTheme,
  ThemePreference,
} from "@vulto/tokens";

type AppearanceValue = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  density: Density;
  setTheme: (theme: ThemePreference) => void;
  setDensity: (density: Density) => void;
};

const AppearanceContext = createContext<AppearanceValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>("light");

  // VPS-002 names the compact density's 32px row as the thing to look at
  // first. No document states the workspace default — see Findings F20.
  const [density, setDensity] = useState<Density>("compact");

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemTheme(query.matches ? "dark" : "light");
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const resolvedTheme: ResolvedTheme =
    theme === "system" ? systemTheme : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", resolvedTheme);
    root.setAttribute("data-density", density);
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme, density]);

  const value = useMemo<AppearanceValue>(
    () => ({ theme, resolvedTheme, density, setTheme, setDensity }),
    [theme, resolvedTheme, density],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceValue {
  const value = useContext(AppearanceContext);
  if (!value) {
    throw new Error("useAppearance must be used inside AppearanceProvider");
  }
  return value;
}

/** Cycles system → light → dark → system, so the control is one button. */
export function nextTheme(current: ThemePreference): ThemePreference {
  if (current === "system") return "light";
  if (current === "light") return "dark";
  return "system";
}

export function useToggleDensity(): () => void {
  const { density, setDensity } = useAppearance();
  return useCallback(
    () => setDensity(density === "compact" ? "comfortable" : "compact"),
    [density, setDensity],
  );
}
