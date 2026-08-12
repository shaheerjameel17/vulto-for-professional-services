import js from "@eslint/js";
import ts from "typescript-eslint";
import prettier from "eslint-config-prettier";

/**
 * Vulto's lint harness.
 *
 * Two custom rules land here, and both encode a fact that is already settled
 * and already checkable — VPS-A001's A001-T09 and the storage prohibition in
 * VPS-A007's first gate.
 *
 * Three rules VPS-A007's first gate also names are deliberately absent, each
 * because the boundary it would enforce does not exist yet:
 *
 *   - No dependency-direction or private-kernel rule. FDN-46 defines the
 *     package boundaries a rule would check.
 *   - No direct-Loro-access rule, per A001-T06. FDN-77 creates the worker
 *     that the rule would draw a line around.
 *   - No vendor-SDK rule, per VPS-A006. `packages/schema` holds no service
 *     interfaces yet, so there is nothing to require imports go through.
 *
 * A fourth is absent for a different reason, recorded so it is not mistaken
 * for an oversight: the working-day prohibition (A001-T10, Standing Rule 9).
 * A rule could ban `getDay()` and literal weekend arrays, but it cannot tell
 * a working-day computation from ordinary date formatting without knowing
 * what VRS-F004's API looks like to redirect callers to. A rule with false
 * positives teaches people to disable it. The real enforcement is VPS-A007's
 * working-day test suite, and the lint rule arrives with VRS-F004.
 */
export default ts.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/target/**",
      "**/*.tsbuildinfo",
    ],
  },

  js.configs.recommended,
  ...ts.configs.recommended,

  {
    rules: {
      /*
       * An underscore prefix is the established signal that a binding is
       * deliberately unused — a destructured field being dropped, a positional
       * argument being skipped. Honoring it is convention, not a concession.
       */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      /*
       * A001-T09: arbitrary values in class names must fail lint. A value not
       * in the token set is a design system change, not a component decision.
       *
       * Matched on the class attribute rather than every string literal, so
       * ordinary bracket syntax elsewhere in the codebase is unaffected.
       *
       * NARROWED DELIBERATELY, AND BROADENING IT AGAIN WOULD BE A MISTAKE.
       *
       * Tailwind uses square brackets for three unrelated things, and only one
       * of them is a design value:
       *
       *   has-[:focus-visible]:…      a variant selector — a pseudo-class
       *   data-[highlighted]:…        a variant selector — a Radix state
       *   transition-[opacity,width]  a list of CSS property names
       *   w-[13px], bg-[#a1a1a1]      an arbitrary DESIGN VALUE  <- the target
       *
       * A first draft of this rule flagged any bracket and produced nine
       * violations across packages/ui, every one of them a false positive:
       * focus-visible variants, Radix state variants, and transition property
       * lists. There is no design token for a pseudo-class and there could not
       * be, so those are not what A001-T09 is about — it names "every color,
       * size, space and radius".
       *
       * A lint rule with false positives teaches people to disable it, which
       * would cost more than the rule is worth. So this matches a bracket whose
       * contents look like a value: a number with or without a unit, a hex
       * color, or a CSS function call.
       */
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name=/^(class|className)$/] Literal[value=/\\[(#[0-9a-fA-F]{3,8}|-?[0-9.]+[a-z%]*|[a-z-]+\\()/]",
          message:
            "Arbitrary Tailwind value. Every color, size, space and radius comes from packages/tokens, per VPS-A001's A001-T09. If the value you need is not in the token set, that is a design system change — raise it against VPS-D001 rather than inlining it.",
        },
        {
          selector:
            "JSXAttribute[name.name=/^(class|className)$/] TemplateElement[value.raw=/\\[(#[0-9a-fA-F]{3,8}|-?[0-9.]+[a-z%]*|[a-z-]+\\()/]",
          message:
            "Arbitrary Tailwind value in a template literal. See VPS-A001's A001-T09.",
        },
      ],

      /*
       * VPS-A007's first gate: the local graph is the store. Anywhere.
       */
      "no-restricted-globals": [
        "error",
        {
          name: "localStorage",
          message:
            "No localStorage anywhere. The local graph is the store, per VPS-A007's first gate.",
        },
        {
          name: "sessionStorage",
          message:
            "No sessionStorage anywhere. The local graph is the store, per VPS-A007's first gate.",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "window",
          property: "localStorage",
          message: "No localStorage anywhere. The local graph is the store.",
        },
        {
          object: "window",
          property: "sessionStorage",
          message: "No sessionStorage anywhere. The local graph is the store.",
        },
        {
          object: "globalThis",
          property: "localStorage",
          message: "No localStorage anywhere. The local graph is the store.",
        },
        {
          object: "globalThis",
          property: "sessionStorage",
          message: "No sessionStorage anywhere. The local graph is the store.",
        },
      ],
    },
  },

  /* Prettier owns formatting. This must stay last. */
  prettier,
);
