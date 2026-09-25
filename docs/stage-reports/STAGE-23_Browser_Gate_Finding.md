# Stage 23 finding — browser verification gate mismatch

The Stage 23 brief says `pnpm verify:full` already runs a device-store browser suite and requires that suite's result in the completion report. The current root `package.json` defines `verify:full` as `pnpm verify && pnpm verify:preflight && pnpm --filter @vulto/api test`; it runs no Playwright suite. The existing sync browser suite is a separate `pnpm test:sync-browser` command and a separate job in `.github/workflows/slow-lane.yml`.

This changes the verification requirement for the new `cache_search` triggers in the real IndexedDB VFS. The brief also says to stop on a brief-versus-code contradiction and not choose an unbriefed mechanism. No Stage 23 product code was written. Reviewer ruling requested: specify whether `pnpm test:sync-browser` is an additional required gate for this stage, or correct the Stage 23 report requirement to acknowledge that `verify:full` contains no browser suite.
