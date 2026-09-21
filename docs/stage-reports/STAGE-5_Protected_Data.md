# Stage 5 — Protected data and field-level encryption

**Status:** BLOCKED
**Branch:** stage-5-protected-data @ cf2cdbc
**Linear issues:** FDN-96, FDN-97 (erasure only)
**Date:** 2026-09-21

## 1. Summary
Salaries and other Tier 1 and Tier 2 content are now stored only as ciphertext, under a three-level key hierarchy whose root is AWS KMS in production and an environment key in development. The only way to read the content is an audited request: the permission decision is made, an audit entry is written, and only then is the value decrypted and returned, and if the entry cannot be written nothing is returned. Erasing one employee's content destroys that employee's key and leaves everyone else readable. One piece is blocked: there is no audit event for an erasure in the audit vocabulary (finding F209), so as shipped the erasure function refuses to destroy anything until you decide one.

## 2. Done-criteria checklist
- [x] A dump of both tables contains no plaintext sentinel — evidence: `services/api/src/protected/protected.integration.test.ts::a dump of the key and fragment tables and the graph rows holds no plaintext sentinel`.
- [x] A fragment's ciphertext copied onto another owner fails authentication — evidence: `::ciphertext copied onto another node's row fails authentication and returns nothing`, `::a fragment moved to another partition or owner type fails too`; `services/api/src/crypto/crypto.test.ts::decrypts under the same header and fails under any changed field`.
- [x] A denied read writes an audit row and returns nothing — evidence: `::a denied read returns nothing and writes an audit row`.
- [x] A forced audit-append failure withholds the data — evidence: `::withholds the data if the audit entry cannot be written`.
- [x] Erasing one employee's domain leaves another employee's content readable — evidence: `::destroys one employee's key, leaves the row, and leaves another employee's content readable` (with a recording audit injected; see F209).
- [x] `runAsPrincipal` for a demoted or removed member throws before reading — evidence: `::stops before reading anything when the member has been demoted or removed`, `::uses the member's current roles...`.
- [x] The production guard rejects `LocalKeyProvider` — evidence: `services/api/src/crypto/crypto.test.ts::refuses the local provider in production, whether named or defaulted`; the server calls the factory before it listens (`server.ts::buildServer`).
- [x] `AwsKmsKeyProvider` is unit-tested with a mocked KMS client, no network — evidence: `crypto.test.ts::wraps and unwraps with the workspace as the encryption context and the configured key`.
- [x] Arch-check rules pass — evidence: `services/api/src/graph/arch-check.test.ts::fails when anything but the KMS provider imports the AWS SDK, or an unlisted module reaches decrypt`, `::passes on the real repository`.
- [x] Logging: no protected value or session cookie reaches the application log — evidence: `services/api/src/trpc.integration.test.ts::never lets a protected value or a session cookie reach the application log (A006-T12)`.
- [x] `protected.read` returns `Cache-Control: no-store`, is capped at 500 nodes and requires a session — evidence: `trpc.integration.test.ts` `protected.read over tRPC` (3 tests).
- [ ] Erasure is audited — blocked by F209. Evidence for the rest: `::destroys nothing when the erasure cannot be audited, and is refused for any other principal`.

VPS-A003's acceptance criteria: dump safety (`a dump of the key and fragment tables...`), a fragment moved to another node (`ciphertext copied onto another node's row...`), and erasure of one employee leaving others readable (`destroys one employee's key...`).

## 3. Spec clauses implemented
| Spec ID | Where implemented | Test proving it |
|---|---|---|
| A003-T55 (ciphertext only; RFC 8785 header as AAD) | `crypto/envelope.ts`, `protected/write.ts`, `protected/schema.ts` | `protected.integration.test.ts` dump and moved-fragment tests; `crypto.test.ts` envelope tests |
| A003-T56 (no protected content on a device) | `protected/schema.ts` (never published), `protected.read` in memory only | `trpc.integration.test.ts::returns the value, marks the response uncacheable...` |
| A003-T59 (decide, audit, then decrypt; audit failure withholds) | `protected/read.ts` | `::withholds the data if the audit entry cannot be written` |
| A003-T60 (no plaintext in logs) | `server.ts` redaction, no body logging | `trpc.integration.test.ts` log test |
| A003-T61 (key cache ≤ 5 minutes, memory only) | `crypto/key-cache.ts` | `::expires an entry after at most five minutes...`, `::holds at most 1,000 entries...` |
| A003-T62 (no key spans two domains; erasure destroys the key) | `crypto/keys.ts`, `protected/erasure.ts`, unique indexes | `::destroys one employee's key...`; `::keeps one data key per Tier 1 erasure domain...` |
| A003-T68 (job principal, re-resolved) | `jobs/principal.ts` | `::stops before reading anything when the member has been demoted or removed` |
| A003-T73 (KMS in production, local elsewhere; one interface) | `crypto/provider.ts`, `aws-kms-key-provider.ts`, `local-key-provider.ts` | `crypto.test.ts` factory and provider tests |
| A007-T08 (decryption reachability) | `scripts/arch-check.mjs` rule 5 | `arch-check.test.ts` |
| A006-T12 (log redaction) | `server.ts::LOG_REDACT` | log test |
| F206 (system operations added as built) | `packages/schema/src/policy/principal-policy.ts` | `protected.integration.test.ts::...refused for any other principal` |

## 4. Files changed
```
 docs/Foundations_Findings.md                       |   13 +
 packages/schema/src/index.ts                       |    1 +
 packages/schema/src/policy/index.ts                |    6 +-
 packages/schema/src/policy/principal-policy.ts     |    9 +-
 packages/schema/src/policy/subject-exclusion.ts    |    9 +
 packages/schema/src/protected.ts                   |    9 +
 pnpm-lock.yaml                                     |  277 ++
 scripts/arch-check.mjs                             |   50 +-
 services/api/drizzle.config.ts                     |    7 +-
 services/api/drizzle/0015_curved_carlie_cooper.sql |   49 +
 services/api/drizzle/meta/0015_snapshot.json       | 3021 ++++++++++++++++++++
 services/api/drizzle/meta/_journal.json            |    7 +
 services/api/package.json                          |    2 +
 services/api/src/auth/workspace-session.ts         |    4 +
 services/api/src/crypto/aes.ts                     |   66 +
 services/api/src/crypto/aws-kms-key-provider.ts    |   72 +
 services/api/src/crypto/crypto.test.ts             |  194 ++
 services/api/src/crypto/decrypt.ts                 |   28 +
 services/api/src/crypto/envelope.ts                |   57 +
 services/api/src/crypto/key-cache.ts               |   61 +
 services/api/src/crypto/key-provider.ts            |   25 +
 services/api/src/crypto/keys.ts                    |  227 ++
 services/api/src/crypto/local-key-provider.ts      |   43 +
 services/api/src/crypto/provider.ts                |   48 +
 services/api/src/db.ts                             |    3 +-
 services/api/src/graph/arch-check.test.ts          |   24 +
 services/api/src/jobs/principal.ts                 |   45 +
 services/api/src/protected/erasure-domain.ts       |   28 +
 services/api/src/protected/erasure.ts              |   93 +
 .../src/protected/protected.integration.test.ts    |  526 ++++
 services/api/src/protected/read.ts                 |  129 +
 services/api/src/protected/schema.ts               |  126 +
 services/api/src/protected/write.ts                |  133 +
 services/api/src/router.ts                         |   24 +-
 services/api/src/server.ts                         |   35 +-
 services/api/src/trpc.integration.test.ts          |   83 +-
 services/api/src/trpc.ts                           |    8 +-
 services/api/vitest.config.ts                      |    3 +
 38 files changed, 5532 insertions(+), 13 deletions(-)
```

## 5. Database changes
Migration `services/api/drizzle/0015_curved_carlie_cooper.sql`:
- `protected_data_keys`: `key_id` (pk), `workspace_id`, `kind` (`kek`/`dek`), `tier` (1 or 2), `erasure_domain_id`, `parent_key_id` (self-reference), `root_key_ref`, `wrapped_key bytea`, `created_at`, `destroyed_at`. Checks: KEK shape (root reference, no parent, no tier), DEK shape (parent and tier), a Tier 1 key has an erasure domain, and a key is live exactly when it has its wrapped bytes. Unique partial indexes: one live KEK per workspace, one live Tier 2 key per workspace, one live Tier 1 key per `(workspace_id, erasure_domain_id)`.
- `graph_protected_fragments`: as specified, with `data_key_id` referencing `protected_data_keys`, a unique index on `(owner_kind, owner_id, schema_partition)`, and indexes on `(workspace_id, owner_id)` and `data_key_id`.
Neither table is published for replication.

## 6. Tests and gates
- `pnpm install --frozen-lockfile` — exit 0 (after adding `@aws-sdk/client-kms@3.1136.0` and `canonicalize@4.0.0`, both exact)
- `pnpm stack:up` — exit 0
- `DATABASE_URL=postgres://vulto:vulto@localhost:5432/vulto_stage5_fresh pnpm --filter @vulto/api db:migrate` (fresh database) — exit 0, 16 migrations recorded
- `pnpm verify` — exit 0
- `pnpm verify:full` — exit 0; `@vulto/api`: `Test Files  10 passed (10)`, `Tests  195 passed (195)` (163 at the start of the stage)
- `pnpm arch:check` — exit 0

## 7. Micro-decisions
- `@aws-sdk/client-kms` is `3.1136.0`, the latest at the time; `canonicalize` is `4.0.0`, the version `packages/graph` already pins.
- One live KEK per workspace is enforced by a unique index, and the shape checks on `protected_data_keys` state what the brief says in words (a KEK has a root reference and no parent, a DEK has a parent).
- A Tier 2 data key stores no erasure domain; a Tier 2 fragment still records one (the owner's) in its header and column, as the brief requires the column.
- If a workspace has no KEK yet (a workspace created before this stage), `ensureDataKey` creates one on first use.
- `protected.read` is a tRPC mutation, because up to 500 ids do not fit a URL and a read-through-POST is never cached; it changes nothing but the audit journal.
- Fragment headers are rebuilt from the row's own columns at read time, never trusted from the stored `header` column, so moving ciphertext with its header still fails.
- Edge-owned fragments are not written yet: no feature has protected edge metadata, and the brief's Stage 2 wrote none. `writeProtected` accepts node owners.
- The `erasure` system principal gains one operation, `protected.destroy-key`. `key-rotation` gains none: its job is not built, and F206 says operations are added as built.
- Server logs redact `cookie`, `authorization` and `set-cookie`; request bodies are never logged.
- `services/api` reads its key provider configuration from the environment on first use and at startup; the test environment supplies a local-only key in `vitest.config.ts`.

## 8. Findings raised
- F209 — a cryptographic erasure has no audit event. **Open.**

## 9. Deviations from this brief
- Item 10's `appendAudit` for erasure is behind an `ErasureAudit` seam that refuses by default, per F209.
- FDN-96's scope mentions annual and on-demand KEK rotation and FDN-97's mentions blob encryption; neither is in this stage's brief. Rotation has no code yet; blob encryption waits for object storage (FDN-70).

## 10. Known limitations and risks
- **Backup key expiry is an operations task (FDN-58).** Destroying a data key in the live store does not by itself destroy retained backups of key records; A003's erasure criterion about backups needs FDN-58.
- Until F209 is decided no key can be destroyed in production.
- The pipeline does not yet call `writeProtected`: generic mutations refuse protected types (`requires-feature-mutation`), so the first feature mutation that owns a protected type is its first caller.
- The KMS provider is verified only against a mocked client; there is no live-KMS test in CI.
- `protected.read` audits each fragment separately, so a read of many fragments writes many entries.

## 11. Readiness for the next stage
Yes for Stage 6, which needs the interceptor, the pipeline seam and the key services. F209 needs a ruling before erasure can be used.
