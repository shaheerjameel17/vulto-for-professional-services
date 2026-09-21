import type { CSSProperties, ElementType, ReactNode } from "react";
import type { TypeToken } from "@vulto/tokens";
import { cx } from "./cx";

/*
 * Typography, as a component rather than a set of classes.
 *
 * Each of VPS-D001's thirteen type tokens bundles a size, a line height, a
 * weight and a tracking value. The four are never assembled by hand at a call
 * site: a feature asks for `body` and gets all four.
 *
 * FDN-29 removes the separate product monospace face. Inter carries every
 * role; numeric tokens add tabular figures so columns align without making
 * workforce and commercial data look like code.
 */

const NUMERIC_TOKENS = new Set<TypeToken>([
  "numeric",
  "numeric-medium",
  "numeric-md",
  "numeric-lg",
]);

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
  numeric: "text-numeric",
  "numeric-medium": "text-numeric-medium",
  "numeric-md": "text-numeric-md",
  "numeric-lg": "text-numeric-lg",
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
  numeric: "span",
  "numeric-medium": "span",
  "numeric-md": "span",
  "numeric-lg": "span",
};

export type TextProps = {
  variant: TypeToken;
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  title?: string;
  id?: string;
  /** Only meaningful with `as="label"`. */
  htmlFor?: string;
  /**
   * Geometry only — an absolute offset a token cannot express, such as a
   * timeline month label positioned against its track. Never colors, sizes or
   * spacing, which come from the token set.
   */
  style?: CSSProperties;
};

export function Text({ variant, as, className, children, ...rest }: TextProps) {
  const Component = as ?? DEFAULT_ELEMENT[variant];
  return (
    <Component
      className={cx(
        "font-ui",
        NUMERIC_TOKENS.has(variant) && "numeric-tabular",
        SIZE[variant],
        CASING[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
