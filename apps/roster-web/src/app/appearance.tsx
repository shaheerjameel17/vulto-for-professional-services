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
  BarFill,
  BenchFill,
  Density,
  ResolvedTheme,
  ThemePreference,
} from "@vulto/tokens";

type AppearanceValue = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  density: Density;
  /** FDN-12 candidate. Temporary — see @vulto/tokens. */
  benchFill: BenchFill;
  /** FDN-12 candidate. Temporary — see @vulto/tokens. */
  barFill: BarFill;
  setTheme: (theme: ThemePreference) => void;
  setDensity: (density: Density) => void;
  setBenchFill: (fill: BenchFill) => void;
  setBarFill: (fill: BarFill) => void;
};

const AppearanceContext = createContext<AppearanceValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>("light");

  // VPS-002 names the compact density's 32px row as the thing to look at
  // first. No document states the workspace default — see Findings F20.
  const [density, setDensity] = useState<Density>("compact");

  // FDN-12 candidates, defaulting to the middle of each set.
  const [benchFill, setBenchFill] = useState<BenchFill>("present");
  const [barFill, setBarFill] = useState<BarFill>("wash");

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
    root.setAttribute("data-bench", benchFill);
    root.setAttribute("data-bar", barFill);
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme, density, benchFill, barFill]);

  const value = useMemo<AppearanceValue>(
    () => ({
      theme,
      resolvedTheme,
      density,
      benchFill,
      barFill,
      setTheme,
      setDensity,
      setBenchFill,
      setBarFill,
    }),
    [theme, resolvedTheme, density, benchFill, barFill],
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
