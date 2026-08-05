import type { CSSProperties, ElementType, ReactNode } from "react";
import type { TypeToken } from "@vulto/tokens";
import { cx } from "./cx";

/*
 * Typography, as a component rather than a set of classes.
 *
 * Each of VPS-D001's eleven type tokens bundles a size, a line height, a face
 * and a weight. There is no legitimate reason to use 14px with the display
 * face, so the four parts are never assembled by hand at a call site: a
 * feature asks for `body` and gets all four.
 *
 * The face pairing is fixed by VPS-D001: Plus Jakarta Sans carries display
 * and headings, Manrope carries interface and body, Geist Mono carries every
 * figure a person will read as money.
 */

const FACE: Record<TypeToken, string> = {
  display: "font-display",
  h1: "font-display",
  h2: "font-display",
  h3: "font-ui",
  body: "font-ui",
  "body-medium": "font-ui",
  small: "font-ui",
  label: "font-ui",
  micro: "font-ui",
  mono: "font-mono",
  "mono-lg": "font-mono",
};

const SIZE: Record<TypeToken, string> = {
  display: "text-display",
  h1: "text-h1",
  h2: "text-h2",
  h3: "text-h3",
  body: "text-body",
  "body-medium": "text-body-medium",
  small: "text-small",
  label: "text-label",
  micro: "text-micro",
  mono: "text-mono",
  "mono-lg": "text-mono-lg",
};

/** VPS-D001: uppercase is permitted at `micro` only. */
const CASING: Partial<Record<TypeToken, string>> = {
  micro: "uppercase",
};

const DEFAULT_ELEMENT: Record<TypeToken, ElementType> = {
  display: "p",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  body: "p",
  "body-medium": "p",
  small: "p",
  label: "span",
  micro: "span",
  mono: "span",
  "mono-lg": "span",
};

export type TextProps = {
  variant: TypeToken;
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  title?: string;
  id?: string;
  /**
   * Geometry only — an absolute offset a token cannot express, such as a
   * timeline month label positioned against its track. Never colors, sizes or
   * spacing, which come from the token set.
   */
  style?: CSSProperties;
};

export function Text({
  variant,
  as,
  className,
  children,
  ...rest
}: TextProps) {
  const Component = as ?? DEFAULT_ELEMENT[variant];
  return (
    <Component
      className={cx(FACE[variant], SIZE[variant], CASING[variant], className)}
      {...rest}
    >
      {children}
    </Component>
  );
}
