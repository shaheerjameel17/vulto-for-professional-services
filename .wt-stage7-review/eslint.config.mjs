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
 * Two rules VPS-A007's first gate also names are deliberately absent, each
 * because the boundary it would enforce does not exist yet:
 *
 *   - No direct-Loro-access rule, per A001-T06. FDN-77 creates the worker
 *     that the rule would draw a line around.
 *   - No vendor-SDK rule, per VPS-A006. `packages/schema` holds no service
 *     interfaces yet, so there is nothing to require imports go through.
 *
 * The dependency-direction and private-kernel rules are no longer absent —
 * FDN-46 defines them below, in a second, directory-scoped set of config
 * objects following the base rules in this one.
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

  /*
   * ============================================================
   * FDN-46 — package dependency direction and the private-kernel rule
   * ============================================================
   *
   * VPS-A001's two-language boundary and A002's Schema Evolution Protocol
   * describe a shape — tokens under ui, nothing under schema, features never
   * touch a package's internals directly — but described it in prose. These
   * rules are that prose, checked.
   *
   * FDN-49's scope previously also claimed "package dependency boundaries."
   * That claim is removed there and kept here, because this check is generic
   * across every package — not specific to the graph — and FDN-46's own done
   * criteria already require it ("automated verification detects a
   * dependency-direction or boundary violation"). FDN-49 keeps *graph*
   * access enforcement: raw Loro reads and raw SQL bypassing the typed query
   * interface, per A001-T03 and A002-T05, which are graph-specific and stay
   * with the schema-conformance suite that already understands the registry.
   *
   * NOT ATTEMPTED: a monorepo-wide "no importing up" rule enforced by
   * physical path. ESLint's import-restriction rules match module
   * SPECIFIERS, not filesystem zones, so this rule denies each app and
   * service by the package name it resolves to today — `roster-web`,
   * `@vulto/api` — rather than by a path pattern that would automatically
   * cover a name nobody has chosen yet. A new application under `apps/`
   * needs its name added below. `eslint-plugin-boundaries` or an
   * equivalent path-zone plugin would remove that maintenance cost, and is
   * worth adopting once the app count makes a hand-maintained list
   * unwieldy — not yet, with one app and one service.
   */

  {
    files: ["packages/tokens/**/*.{ts,tsx}"],
    rules: {
      /*
       * The leaf. Nothing in this repository styles itself against a
       * component or a graph type, so tokens depends on nothing here.
       */
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@vulto/*", "roster-web"],
              message:
                "packages/tokens is the leaf of the dependency graph, per VPS-A001. It depends on nothing else in this repository.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["packages/ui/**/*.{ts,tsx}"],
    rules: {
      /*
       * ui depends on tokens and nothing graph-shaped. A component takes
       * props; it does not know what an Employee node looks like. Importing
       * @vulto/schema here would make a component half a feature — coupled
       * to a graph shape, unusable without one, and no longer the reusable
       * primitive VPS-D002 specifies. VPS-A001: "a feature composes
       * components; it never defines one" runs the other direction too — a
       * component never composes a feature's data.
       */
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@vulto/schema",
                "@vulto/schema/*",
                "@vulto/api",
                "@vulto/api/*",
                "roster-web",
              ],
              message:
                "packages/ui depends on packages/tokens only. A component takes props, per VPS-D002 — it does not know the graph's shape. Wire schema data to a component in the feature that composes them, in apps/.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["packages/schema/**/*.{ts,tsx}"],
    rules: {
      /*
       * schema is the enforcement point for the graph, per A002's Schema
       * Evolution Protocol, and depends on nothing else in this repository —
       * only loro-crdt, which A001-T02 pins. It is consumed by everything;
       * it consumes nothing here.
       */
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@vulto/ui",
                "@vulto/ui/*",
                "@vulto/tokens",
                "@vulto/tokens/*",
                "@vulto/api",
                "@vulto/api/*",
                "roster-web",
              ],
              message:
                "packages/schema is the graph's enforcement point, per VPS-A002's Schema Evolution Protocol, and depends on nothing else in this repository.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["apps/**/*.{ts,tsx}"],
    rules: {
      /*
       * apps/roster-web importing @vulto/api's router TYPE is the one
       * sanctioned exception to "nothing imports up" — tRPC's whole value
       * proposition is a client that shares the server's types without a
       * runtime dependency on the server. The value export is a live Fastify
       * server; bundling it into a browser build is not merely an
       * architecture violation, it is a broken build the moment someone
       * reaches for the wrong one instead of the type.
       *
       * `allowTypeImports: true` is what makes this the narrow exception
       * rather than an open door: `import type { AppRouter } from
       * "@vulto/api/router"` passes, `import { appRouter } from "@vulto/api"`
       * fails, on the same specifier.
       */
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@vulto/api", "@vulto/api/*"],
              message:
                "@vulto/api may be imported type-only from apps/ — `import type`, never a value import. The API is a deployed service reached over tRPC/HTTP, not an in-process module; importing its runtime exports risks bundling a Fastify server into a browser build.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },

  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["packages/tokens/**", "packages/ui/**", "packages/schema/**", "apps/**"],
    rules: {
      /*
       * Everything else — services/api today, every future service — may
       * import tokens, ui and schema normally, and may not deep-import
       * another package's internals. A package's `exports` field in its
       * package.json is already its complete public surface; this rule is
       * what turns that convention into a build failure instead of an
       * honor system, and it is the "private kernel internals" check
       * FDN-46's done criteria name.
       *
       * There is no private layer inside any package yet — nothing to
       * bypass today. The rule is written now because FDN-48 and FDN-77 add
       * materialization-worker internals shortly that must never be reached
       * directly, per A002-T05, and retrofitting an import rule after a
       * deep import already exists in a feature is the expensive direction.
       */
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@vulto/*/src/*", "@vulto/*/dist/*"],
              message:
                "Deep import of a package's internals. Use its declared exports (package.json's \"exports\" field) — a subpath outside that map is private, per FDN-46's package-boundary rule.",
            },
          ],
        },
      ],
    },
  },

  /* Prettier owns formatting. This must stay last. */
  prettier,
);
