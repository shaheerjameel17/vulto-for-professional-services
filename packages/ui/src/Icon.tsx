import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";

/*
 * One icon set throughout: Lucide, 16px default, 1.5px stroke, currentColor.
 * VPS-D002.
 *
 * Icons never carry color independently of their text, so no color prop
 * exists. Decorative icons are not permitted — every icon in this product
 * either replaces a word or clarifies one, which is why `label` is required
 * whenever the icon is not accompanied by text.
 */

export type IconProps = {
  icon: LucideIcon;
  /** Accessible name. Required for an icon-only control, per VPS-D002. */
  label?: string;
  /** 14 exists only for a glyph inside a circular icon-only button, where a
   * full 16px reads heavy against the surrounding padding — VPS-D002's own
   * documented floor stays 16px everywhere else. */
  size?: 14 | 16 | 20 | 24;
  className?: string;
};

export function Icon({ icon: Component, label, size = 16, className }: IconProps) {
  return (
    <Component
      width={size}
      height={size}
      strokeWidth={1.5}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      className={cx("shrink-0", className)}
    />
  );
}
