/**
 * @vulto/tokens — the type-level surface of the token set.
 *
 * Every value lives in the CSS. What is exported here is the small amount of
 * logic that maps something in the graph onto a token, plus the token names
 * themselves so a component cannot accept a variant that does not exist.
 */

/** The eleven type tokens from VPS-D001's scale. There is no twelfth. */
export const TYPE_TOKENS = [
  "display",
  "h1",
  "h2",
  "h3",
  "body",
  "body-medium",
  "small",
  "label",
  "micro",
  "mono",
  /*
   * FDN-15's twelfth token, and F40 is settled in favor of keeping it.
   *
   * The question was whether `mono` at 400 could simply become 500, leaving the
   * scale at eleven. It cannot: `mono` at 400 is load-bearing on the bench bar,
   * where the day count is deliberately lighter than the cost figure beside it.
   * That is the "weight, not hue" distinction FDN-15 established, and
   * redefining `mono` would collapse it. VPS-D001's count moves to twelve.
   */
  "mono-medium",
  /*
   * FDN-20's thirteenth token, for a supporting figure in a group — large
   * enough to read as a figure rather than a caption, below the figure that
   * leads. 16px is an existing step on VPS-D001's size ladder.
   *
   * NAMING COLLISION, for FDN-21 to resolve: `-medium` denotes weight here
   * (matching `body-medium`) while `-md` and `-lg` denote size. The mono family
   * is now the one place in the scale where a suffix means two things.
   */
  "mono-md",
  "mono-lg",
] as const;

export type TypeToken = (typeof TYPE_TOKENS)[number];

/** VPS-D001's three semantic hues. There is deliberately no fourth. */
export const SEMANTIC_TOKENS = ["success", "attention", "danger"] as const;

export type SemanticToken = (typeof SEMANTIC_TOKENS)[number];

/** The categorical palette, drawn exclusively from the cool half of the wheel. */
export const CATEGORICAL_TOKENS = [
  "cat-1",
  "cat-2",
  "cat-3",
  "cat-4",
  "cat-5",
  "cat-6",
  "cat-7",
  "cat-8",
] as const;

export type CategoricalToken = (typeof CATEGORICAL_TOKENS)[number];

/**
 * Assign a categorical color by hashing a Project's UUID, per VPS-D001.
 *
 * Deterministic on purpose: a project is the same color on every device and
 * for every user without storing a color on the node. This lives in the token
 * package rather than in a component because it maps an identifier onto a
 * token, and because the answer has to be identical everywhere it is asked.
 *
 * FNV-1a, 32-bit.
 */
export function categoricalTokenForId(id: string): CategoricalToken {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const index = hash % CATEGORICAL_TOKENS.length;
  // Non-null: index is bounded by the array length above.
  return CATEGORICAL_TOKENS[index]!;
}

/** VPS-D001's two density modes. Workspace default, per-user override. */
export const DENSITIES = ["compact", "comfortable"] as const;
export type Density = (typeof DENSITIES)[number];

/** VPS-D001: dark is a first-class theme. `system` is the default. */
export const THEMES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEMES)[number];
export type ResolvedTheme = "light" | "dark";

/*
 * FDN-12 candidates. TEMPORARY — these exist so the fills can be chosen by
 * looking rather than by argument. One of each becomes the token, and both
 * unions plus their runtime.css blocks are then deleted.
 */

/*
 * FDN-20 categorical palette candidates.
 *
 * `current` is the palette as built, kept for comparison. `spread` leans on hue,
 * `ladder` on lightness. TEMPORARY — one becomes the token set, and the other
 * two plus this union are then deleted.
 */
export const CAT_PALETTES = ["current", "spread", "ladder"] as const;
export type CatPalette = (typeof CAT_PALETTES)[number];
