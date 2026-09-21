# FDN-52 — F172–F175 Final Adversarial Implementation Checkpoint

**Date:** 21 August 2026  
**Disposition:** stop at QA checkpoint; do not mark FDN-52 complete  
**Remaining FDN-52 blocker:** F167 only (no-existing-device SLIP-0039 recovery)

## Governing rulings incorporated

- **F172:** one P-256 identity generation per `(workspaceId, canonicalUserId)`; only a sealed Web Crypto-wrapped private key persists; genuine Worker recreation restores it nonextractable; existing-device transfer uses one-time P-256 ECDH, HKDF-SHA-256 and AES-256-GCM with complete authenticated context. FDN-63/89 still own enrollment authorization and FDN-51 still owns delivery.
- **F173:** FDN-84's one-record expected-generation/digest CAS is the durable linearization point. FDN-52 stages registry copies, commits, then publishes and disposes old keys. Complete historical-store rollback remains explicitly unclaimed and belongs to a future FDN-84/51 monotonic-anchor design.
- **F174:** cryptographic erasure applies only to Tier 1/3. Tier 0/2 use weaker VPS-F007 redaction/deletion/cache purge. Tier 3 erasure removes current/history document-key envelopes and loaded keys without destroying sibling documents or their root.
- **F175:** protected state remains Worker-private except for unavoidable, transient browser ceremony bytes in a narrow trusted Window path. Same-origin execution during an active ceremony is outside the claim. Generic production sealed-record access is prohibited, and diagnostics are excluded from optimized production artifacts.

The independent pre-code mapping is in `docs/FDN-52_F172-F175_Ruling_Review.md`. No contradiction was found after the rulings, so no additional Founder decision was required before implementation.

## Findings by severity

| Severity | Finding | Final state |
|---|---|---|
| High | F172 — Tier 1 identity continuity/transfer absent | Closed by direct same-device and second-device proof; F167 remains separate |
| High | F173 — non-atomic protected commits and cross-Worker lost update | Closed for crash/concurrent atomicity; deliberate complete-store rollback remains a recorded assurance limit |
| High | F174 — Tier 3 erasure absent and Tier 2 model contradictory | Closed by A003/F007 correction plus Tier 3 implementation |
| High, pre-activation | F175 — overstated Worker boundary and generic production payload access | Closed by corrected threat boundary, protocol removal, detached-buffer proof and production artifact exclusion |
| High, self-corrected | F180 — identity public/private pair mismatch accepted | Closed by failing-before/passing-after ECDH pair-consistency regression |
| High, self-corrected | F181 — malformed sealed CAS metadata trusted | Closed by exact hostile-record parser and nine mutation cases |

F168–F171 and F176–F179 also pass the final full regression. Their before/after evidence remains in `docs/FDN-52_Adversarial_QA_Checkpoint.md` and their final states are in `docs/Foundations_Findings.md`.

## F172 proof

- A real module Worker generated one identity, created/persisted a Tier 1 partition, and was terminated.
- A genuinely new Worker performed normal PostgreSQL/API-backed FDN-84 unlock, restored the sealed identity as nonextractable, materialized the partition and opened its marker.
- A separate Chromium browser context obtained a distinct device ID, created its own target transfer key, accepted the authenticated transfer and opened a challenge encrypted for the original identity.
- Replay failed; the installed operational private key was nonextractable.
- Wrong workspace, user, source device, target device, transfer ID, target key, expiry, authenticated header, ciphertext and public/private pair all fail closed.

## F173 crash and concurrency proof

Forced sealed-store rejection during reader removal, reader grant, Tier 1 erasure, Tier 3 recovery and Tier 3 erasure returns failure and preserves prior live state. Each subsequent fresh Worker reopens the prior durable state. Tier 3 erasure now has its own post-failure reopen assertion.

Pre-commit Workers are genuinely terminated after preparing removal/grant/recovery proposals; a fresh inspector sees the old generation. For post-commit proof, both competing Workers are terminated before a fresh inspector reopens the durable winner.

Real separate Workers raced:

- ordinary CAS write versus ordinary CAS write;
- write versus reader removal;
- reader grant versus reader removal;
- Tier 3 recovery versus Tier 3 recovery.

Every race produced exactly one success. Fresh reopen matched that winner, with no resurrected reader, lost successful write, false success or unusable authoritative key.

**Retained limit:** replacing the complete IndexedDB store with an older internally valid snapshot is still accepted after all Workers terminate. No trusted monotonic anchor exists. This is not described as rollback resistance.

## F174 erasure proof

Tier 3 erasure preserves current and historical ciphertext but removes every usable document-key envelope, zeros the loaded current key and frees the plaintext document. Reopen omits the erased partition while restoring its sibling and the still-required subject root. The strict erased-state schema rejects an injected `documentKeyEnvelope`; the CAS fault proof shows failed erasure preserves the prior state.

Tier 0/2 semantics are now explicit: data redaction/deletion and cache purge under VPS-F007 are weaker than Tier 1/3 cryptographic erasure. No Tier 2 key architecture was invented.

## F175 production boundary proof

- `sealPayload`/`openPayload` are absent from `LocalGraphClient`, production request/result schemas, `worker/entry.ts` and the main package export. Legacy operation names fail protocol parsing.
- Raw storage diagnostics use a separate test-only Worker and protocol.
- Production webpack compilation replaces all diagnostics client imports with inert modules. Optimized routes are 145-byte 404 shells; the implementation bundles are not emitted.
- Artifact search over `apps/roster-web/.next` finds none of the generic payload operation names, diagnostics Worker/proof names, identity-transfer construction or protected internal logical-key labels.
- The WebAuthn ceremony transfers the browser-returned PRF `ArrayBuffer` itself and observes both the buffer and its view detached synchronously. It never enters React state, persistence, logs, telemetry or a server request.
- Recovery codes remain inside the proof Worker. No production protected ceremony protocol exists yet.

## Malformed state, property/fuzz and negative authorization

- 128 deterministic ReaderSet permutations converge on one canonical set/digest; empty, duplicate and control-character identities reject.
- Sampled ciphertext bit flips and truncated AES-GCM values reject.
- 128 deterministic 256-bit Tier 3 recovery secrets round-trip.
- Malformed PRF input, root/envelope generations, credential binding, workspace, reader set, document history and unsupported manifest versions reject before materialization.
- Nine sealed-record shape mutations reject before read/CAS.
- Removed/never-authorized Tier 1 readers receive no envelope, plaintext or materialization; a newly granted reader receives only the named document.
- Tier 3 requires the exact canonical subject plus current credential/recovery path; company role alone, another subject, wrong code, retired credential and old recovery path fail.
- F168 cross-workspace, F169 recipient-set substitution, F170 cross-document history splice and F171 mismatched-root/rollback-over-live regressions remain green.

## Specification drift resolved

- A003-T04 now records the FDN-84 CAS ownership and exact atomicity property.
- A003-T31–T35 record identity continuity/transfer, staged commits, the real Window/Worker boundary and production protocol restriction.
- A003 and VPS-F007 now agree that cryptographic erasure is Tier 1/3 only.
- A003 no longer treats Tier 0 `Expense` as Tier 1 retained history (F176).
- A004 no longer uses the stale company-“Owner's devices/no cross-device” Tier 3 model (F179).

No privacy tier, permission grant, ReaderSet or feature scope changed.

## Verification

- Targeted changed-file Prettier check: passed.
- `git diff --check`: passed.
- `pnpm lint`: passed, 6/6 packages.
- `pnpm typecheck`: passed, 6/6 packages.
- `pnpm test`: passed; graph 17 files/202 tests, schema 2 files/23 tests, API 1 file/17 tests — 242 executed assertions total.
- `pnpm test:worker-browser`: passed, 3/3 real PostgreSQL/API/Chromium/module-Worker tests after the final termination-order change.
- `pnpm test:device-store-browser`: passed, 51/51 real browser tests.
- `pnpm build`: passed; optimized Next production build completed.
- Production artifact denylist search: passed with zero matches.
- `pnpm verify`: stops only at repository-wide formatting because four unrelated, pre-existing API files fail Prettier: `device-revocation-signal.spec.ts`, `auth.integration.test.ts`, `device-unlock.ts`, and `http.ts`. None is present in this branch's status/diff. The command's independently invoked lint/typecheck/test stages all pass as listed above.

## Repository state

Branch: `fdn-52-implement-privacy-tier-partitioning-and-workspace-key`.

`HEAD`, local `main` and `origin/main` are all `042f7c7274e04723c4c9a9dbd1f7226e477c8835`. Main is untouched. There was no commit, merge, reset, branch switch, status change or SLIP-0039 implementation.

Tracked diff: 24 modified files, 2,412 insertions and 188 deletions. There are 25 untracked status entries, including the pre-existing `.claude/worktrees/` directory and FDN-52 evidence/source/test files. `git status --short` at the checkpoint:

```text
 M apps/roster-web/next.config.ts
 M apps/roster-web/src/app/device-store-diagnostics/device-store-diagnostics-client.tsx
 M apps/roster-web/src/app/graph-persistence-diagnostics/graph-persistence-diagnostics-client.tsx
 M apps/roster-web/src/app/worker-diagnostics/worker-diagnostics-client.tsx
 M docs/Foundations_Findings.md
 M docs/Vulto_Specs/VPS-A003_Unified_Sync_Architecture.md
 M docs/Vulto_Specs/VPS-A004_Graph_Permission_Layer.md
 M docs/Vulto_Specs/VPS-F007_Data_Governance_Retention_and_Erasure.md
 M packages/graph/package.json
 M packages/graph/src/client.test.ts
 M packages/graph/src/client.ts
 M packages/graph/src/index.ts
 M packages/graph/src/protocol.test.ts
 M packages/graph/src/protocol.ts
 M packages/graph/src/worker/entry.ts
 M packages/graph/src/worker/runtime.ts
 M packages/graph/src/worker/storage/sealed-store.ts
 M packages/graph/src/worker/storage/storage-keys.ts
 M packages/graph/src/worker/testing/unchecked-mutation.ts
 M packages/schema/src/index.ts
 M packages/schema/src/registry.test.ts
 M packages/schema/src/registry/protection.ts
 M packages/schema/src/registry/validate.ts
 M pnpm-lock.yaml
?? .claude/worktrees/
?? docs/FDN-52_Adversarial_QA_Checkpoint.md
?? docs/FDN-52_F172-F175_Implementation_Checkpoint.md
?? docs/FDN-52_F172-F175_Ruling_Review.md
?? docs/FDN-52_SLIP39_Candidate_Assessment.md
?? docs/FDN-52_Stage6_Requirements_Evidence.md
?? packages/graph/browser-tests/protected-document-contract.spec.ts
?? packages/graph/src/worker/protected-document.test.ts
?? packages/graph/src/worker/protected-document.ts
?? packages/graph/src/worker/protected-partitions.test.ts
?? packages/graph/src/worker/protected-partitions.ts
?? packages/graph/src/worker/storage/sealed-store-record.test.ts
?? packages/graph/src/worker/testing/adversarial-durability-proof.worker.ts
?? packages/graph/src/worker/testing/protected-document-proof.worker.ts
?? packages/graph/src/worker/testing/sealed-store-client.ts
?? packages/graph/src/worker/testing/sealed-store-entry.ts
?? packages/graph/src/worker/testing/tier1-envelope-shared-vector.ts
?? packages/graph/src/worker/tier1-envelope.test.ts
?? packages/graph/src/worker/tier1-envelope.ts
?? packages/graph/src/worker/tier1-identity-transfer.test.ts
?? packages/graph/src/worker/tier1-identity-transfer.ts
?? packages/graph/src/worker/tier3-partitions.test.ts
?? packages/graph/src/worker/tier3-partitions.ts
?? packages/graph/src/worker/tier3-root.test.ts
?? packages/graph/src/worker/tier3-root.ts
```

## External record and final ruling state

The requested Linear FDN-52/FDN-84 decision-record comments were not posted: the connector rejected the security-detail export, and no issue status was changed. The repository decision record is `docs/FDN-52_F172-F175_Ruling_Review.md` plus this checkpoint.

No new finding requires a Founder/architecture ruling. F180 and F181 were implementation defects resolvable from the existing A003 identity/CAS properties. F167 remains the only SLIP-0039-related blocker and already has its separate Founder ruling/audit gate.
