"use client";

import { Text, ToggleGroup } from "@vulto/ui";
import type { CatPalette, Density, ThemePreference } from "@vulto/tokens";
import { useAppearance } from "../app/appearance";

/*
 * The density and theme controls at the sidebar's foot, per VPS-D004.
 *
 * Both are Toggle Groups: VPS-D002 reserves Toggle Group for small mutually
 * exclusive sets and names density mode as an example, and a Switch is only
 * for settings that take effect immediately with two states.
 */

export function AppearanceControls() {
  const { theme, density, catPalette, setTheme, setDensity, setCatPalette } =
    useAppearance();

  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup<Density>
        label="Density"
        value={density}
        onChange={setDensity}
        options={[
          { value: "compact", label: "Compact" },
          { value: "comfortable", label: "Comfortable" },
        ]}
        className="w-full"
      />
      <ToggleGroup<ThemePreference>
        label="Theme"
        value={theme}
        onChange={setTheme}
        options={[
          { value: "system", label: "Auto" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
        className="w-full"
      />

      {/* FDN-20 candidate. Temporary evaluation furniture — this block goes away
        * once a palette is chosen. */}
      <Text variant="micro" className="mt-2 text-text-secondary">
        Project palette
      </Text>
      <ToggleGroup<CatPalette>
        label="Categorical palette candidate"
        value={catPalette}
        onChange={setCatPalette}
        options={[
          { value: "current", label: "Now" },
          { value: "spread", label: "Hue" },
          { value: "ladder", label: "Light" },
        ]}
        className="w-full"
      />
    </div>
  );
}
