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
  CatPalette,
  Density,
  ResolvedTheme,
  ThemePreference,
} from "@vulto/tokens";

type AppearanceValue = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  density: Density;
  /** FDN-20 candidate. Temporary — see @vulto/tokens. */
  catPalette: CatPalette;
  setTheme: (theme: ThemePreference) => void;
  setDensity: (density: Density) => void;
  setCatPalette: (palette: CatPalette) => void;
};

const AppearanceContext = createContext<AppearanceValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>("light");

  // FDN-16: comfortable is the default. No document states the workspace
  // default — see Findings F20 — and compact was only ever a starting point for
  // looking at the 32px row VPS-002 names. The mechanism is unchanged.
  const [density, setDensity] = useState<Density>("comfortable");

  const [catPalette, setCatPalette] = useState<CatPalette>("current");

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
    root.setAttribute("data-cat-palette", catPalette);
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme, density, catPalette]);

  const value = useMemo<AppearanceValue>(
    () => ({
      theme,
      resolvedTheme,
      density,
      catPalette,
      setTheme,
      setDensity,
      setCatPalette,
    }),
    [theme, resolvedTheme, density, catPalette],
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
