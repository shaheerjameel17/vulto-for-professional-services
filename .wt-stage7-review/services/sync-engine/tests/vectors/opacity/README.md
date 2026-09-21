# Server-opacity fixtures (FDN-51 Stage 5, A003-T43)

`tier1.json` / `tier3.json` drive the adversarial opacity cases in
`../../relay_pg.rs`. Each file holds:

- **`payloads`** — real FDN-52 protected-envelope byte strings (hex): a Tier
  1/3 document update under the per-document key, the wrapped document key, the
  recovery envelope, and — for Tier 1 — the A003-T32 `Tier1IdentityTransfer`
  envelope, which FDN-51 also delivers. The Rust test pushes each as
  `PushDelta { tier_tag: opaque }`.
- **`must_be_absent`** — every secret in the Tier 1/3 key hierarchy (the founder
  ruling on the Stage 5 plan): protected plaintext, per-document key, Tier 3
  root key, Tier 1 recovery secret and a share, reader-set unwrap material, Tier
  1 identity private key and the transfer's unwrapped contents, Tier 3 recovery
  code, and the WebAuthn PRF _result_. The test proves none appears in any
  `sync_*` column or relay log line, in any representation.
- **`not_scanned`** — non-secret metadata that legitimately may appear
  server-side, listed so the proof is explicit about what it does not treat as
  a leak. In particular the Tier 3 PRF **input** is non-secret persisted
  metadata and is deliberately not scanned for; only the PRF result is.

## These are test-only values

**Every key, secret, and plaintext in these files is a fixed non-production
value, generated solely for this proof, and never used in or derived from any
real workspace.** Each file repeats this in its `_warning` field.

## Regenerating

`pnpm stage5:opacity-fixtures` runs
`packages/graph/src/worker/testing/stage5-opacity-fixtures.ts`, which builds
both files from the real FDN-52 constructions with fixed keys and fixed IVs, so
the output is byte-stable. `stage5-opacity-fixtures.test.ts` (in `@vulto/graph`)
fails if a committed file drifts from what the builder produces — regenerate and
review when an FDN-52 construction changes.

Unlike the wire vectors next door, these are **not** a cross-implementation
contract: they have one consumer (the Rust opacity scan) and need only be real
FDN-52 output, not independently reproducible.
