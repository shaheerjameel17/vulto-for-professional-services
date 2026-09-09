# Contributing to Vulto

## Before you push: `pnpm verify:full`

There are two verification commands, and the difference matters.

| Command                | What it runs                                                                                                                                                                       | When                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **`pnpm verify`**      | The fast, hermetic gate — format, lint, schema conformance, the architecture assertion, typecheck, and the hermetic unit tests. No Postgres, no browser, no build. **~8 seconds.** | On every save. Keep it green as you work. |
| **`pnpm verify:full`** | `pnpm verify` **plus** the `@vulto/api` integration tests (behind a Postgres preflight that tells you to run `pnpm stack:up` if the stack is down). **~11 seconds.**               | **Before every push.**                    |

CI runs the full matrix — both of the above, plus the browser suites, the
multi-target Rust build, the production build and its artifact check, and
accessibility — but the browser suites alone take minutes, so they are not in
either local command. `pnpm verify:full` is the local floor: if it is red,
CI will be red.

`pnpm verify` staying fast is deliberate. A ten-minute every-save check gets
bypassed, and a check that gets bypassed prevents nothing.

## The stack

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm stack:up        # Postgres, Redis, sync-engine — containers
pnpm dev             # roster-web + api on the host
```

`pnpm stack:down` stops the containers. See [`docs/Bootstrap.md`](docs/Bootstrap.md)
for what exists to run and what is still absent.

## The rules that are not negotiable

These live in [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) and, where they
can be, are enforced by `pnpm verify`:

- **Never compute a working day** — no weekend, no holiday, no calendar
  arithmetic. `VRS-F004` owns it.
- **Never write a permission check in a feature** — `VPS-A004`'s interceptor is
  the only place access is decided.
- **Design tokens are the only source of values** — every colour, size, space
  and radius comes from `packages/tokens`. Arbitrary Tailwind values fail lint.
- **No `localStorage` or `sessionStorage`, anywhere.** The local graph is the
  store.
- **Components live in `packages/ui`**, not in an app.
- **No node type exists before it is registered** in `VPS-A002` /
  `packages/schema` — the conformance gate fails otherwise.

## Corrections to a specification

When building shows an internally consistent instruction produces the wrong
result, the implementation stands and the specification is corrected — in the
document that owns the fact, with the reasoning recorded in
[`docs/Foundations_Findings.md`](docs/Foundations_Findings.md). Finding numbers
continue rather than restart.
