"use client";

import { Text, ToggleGroup } from "@vulto/ui";
import type {
  BarFill,
  BenchFill,
  Density,
  ThemePreference,
} from "@vulto/tokens";
import { useAppearance } from "../app/appearance";

/*
 * The density and theme controls at the sidebar's foot, per VPS-D004.
 *
 * Both are Toggle Groups: VPS-D002 reserves Toggle Group for small mutually
 * exclusive sets and names density mode as an example, and a Switch is only
 * for settings that take effect immediately with two states.
 */

export function AppearanceControls() {
  const {
    theme,
    density,
    benchFill,
    barFill,
    setTheme,
    setDensity,
    setBenchFill,
    setBarFill,
  } = useAppearance();

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

      {/* FDN-12 candidates. Temporary evaluation furniture — this block goes
        * away once one of each pair is chosen. */}
      <Text variant="micro" className="mt-2 text-text-tertiary">
        Bench fill
      </Text>
      <ToggleGroup<BenchFill>
        label="Bench fill candidate"
        value={benchFill}
        onChange={setBenchFill}
        options={[
          { value: "restrained", label: "1" },
          { value: "present", label: "2" },
          { value: "assertive", label: "3" },
        ]}
        className="w-full"
      />
      <Text variant="micro" className="text-text-tertiary">
        Bar fill
      </Text>
      <ToggleGroup<BarFill>
        label="Bar fill candidate"
        value={barFill}
        onChange={setBarFill}
        options={[
          { value: "hairline", label: "1" },
          { value: "wash", label: "2" },
          { value: "tint", label: "3" },
        ]}
        className="w-full"
      />
    </div>
  );
}
