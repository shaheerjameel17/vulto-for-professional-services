# FDN-52 adversarial QA checkpoint

> **Historical pre-ruling checkpoint.** Its before-fix reproductions remain the evidence record. The post-ruling implementation state for F172–F175 is in `docs/FDN-52_F172-F175_Implementation_Checkpoint.md`.

**Date:** 21 August 2026  
**Branch under review:** `fdn-52-implement-privacy-tier-partitioning-and-workspace-key`  
**Disposition:** **Do not mark FDN-52 complete.** Stop at this QA checkpoint. No SLIP-0039 implementation or candidate dependency was introduced.

## Outcome

The review found twelve FDN-52-specific defects or specification drifts beyond the pre-existing F167/F157 records:

- F168–F171: one Critical and three High restore/trust-boundary defects, fixed with failing-before/passing-after regressions;
- F172–F175: four open High findings requiring explicit ownership/architecture decisions rather than ad-hoc fixes;
- F176/F179: two specification drifts, corrected in their owning documents;
- F177: one Medium malformed durable-format defect, fixed with a regression;
- F178: one Medium key-lifetime/resource-cleanup defect, fixed with a regression.

The real browser characterization proves F172 and F173 are current behavior, not theoretical concerns. A genuine Worker restart retains the Tier 1 manifest but cannot materialize it without the destroyed in-memory private key. Two independent module Workers both report successful writes while the record remains at generation zero. Replacing a generation-one record with its prior valid encrypted generation-zero record is accepted by a newly created Worker. A forced persistence failure rejects the call after the registry has already mutated while durable bytes remain unchanged.

## Findings by severity

| Severity | Finding | Status | Security or correctness effect |
|---|---|---|---|
| **Critical** | F168 — workspace binding absent at protected runtime boundaries | **Fixed, provisional pending full verification** | A Worker for workspace A accepted Tier 1/3 addresses or a sealed-store binding for workspace B, creating cross-workspace key/state confusion. |
| **High** | F169 — durable Tier 1 envelope set not bound back to current `readerSetId` | **Fixed, provisional pending full verification** | A valid envelope for an unauthorized third reader could materialize a document whose address claimed a different exact ReaderSet. |
| **High** | F170 — Tier 3 historical document substitution | **Fixed, provisional pending full verification** | Valid ciphertext/history from document B could be imported into A under the same subject root, crossing document and erasure-domain identity. |
| **High** | F171 — incomplete Tier 3 authoritative-root/rollback validation | **Fixed in process, provisional pending full verification** | Recovery could bless mismatched PRF metadata and restore could overwrite a live newer registry with an older manifest. Cold-start rollback remains F173. |
| **High** | F172 — Tier 1 identity continuity and existing-device transfer absent | **Open; blocks completion independently of F167** | Ordinary Worker termination destroys the only private key that can open durable Tier 1 recipient envelopes. The specified one-time P-256 transfer path is also absent. |
| **High** | F173 — non-atomic persistence, cross-Worker lost update, and cold rollback | **Open; architecture ruling required** | Failed persistence leaves memory/disk divergent; reader removal or erasure can resurrect; concurrent recovery can split brain; a stale valid manifest is accepted after restart. |
| **High** | F174 — all-tier erasure claim implemented only for Tier 1 | **Open; specification contradiction/ruling required** | Tier 3 retains usable root/document keys; Tier 2 has no per-document key compatible with A003's stated cryptographic-erasure mechanism. |
| **High, pre-activation** | F175 — Worker-only Tier 3 boundary is not literal and `openPayload` is unrestricted | **Open; threat-boundary ruling required** | WebAuthn PRF originates in Window; an unlocked same-origin caller can request the predictable Tier 3 manifest. Protected lifecycle is not production-protocol-reachable yet. |
| **Medium** | F177 — durable PRF input length not enforced | **Fixed** | A durable header could describe an application PRF input the normative 32-byte constructor could never create, yielding a fail-closed data-loss format. |
| **Medium** | F178 — partial Tier 3 restore/recovery did not clean transient keys/documents | **Fixed** | Earlier raw document keys and Loro documents remained unreachable by `dispose()` after a later partition failed. |
| **Specification drift** | F176 — Tier 0 `Expense` listed as Tier 1 retention material | **Fixed in A003** | The example contradicted the registry and could cause the wrong storage lifecycle to be applied. |
| **Specification drift** | F179 — A004 retained “owner's devices” and no-cross-device wording | **Fixed in A004** | The text contradicted canonical-subject device establishment/recovery and reintroduced company-Owner ambiguity. |

F167 remains the independent High/blocking SLIP-0039 dependency finding. F157 remains the independent-vector verification limitation.

## F168–F171 regression evidence

| Finding | Before-fix reproduction | Root cause | Smallest fix | After-fix evidence |
|---|---|---|---|---|
| F168 | Real Chromium runtime initialized for workspace A accepted a protected address for workspace B; `stage3WrongWorkspaceDenied` returned `false` and the Playwright assertion failed. | Runtime checked only that some workspace existed, not equality among runtime, sealed store, protected address and Tier 3 root. | Bind unlock/initialize/runtime operations/restore to one exact workspace and verify the server grant's workspace/device. | Real Chromium/PostgreSQL/module-Worker proof returns `true`; graph and app typechecks pass. |
| F169 | A valid reader-C envelope replaced the A/B durable envelope set under an address whose `readerSetId` still named A/B; restore resolved instead of rejecting. | Individual envelope authentication did not make the complete manifest recipient set authoritative. | Recompute the concrete user set from every current/historical envelope map and require its digest to equal the current authoritative address. | `rejects a durable envelope recipient set that disagrees with readerSetId` passes. The test itself is the durable-state mutation. |
| F170 | After Tier 3 recovery, a valid historical epoch from document B replaced A's epoch; restore resolved instead of rejecting. | Root/subject equality was checked, but the full child document identity was not. | Require every historical epoch's complete protected partition key to equal its current document's key. | `rejects a valid historical epoch spliced from a different Tier 3 document` passes. The test itself is the cross-domain mutation. |
| F171 | Recovery accepted a stored PRF header with substituted credential metadata; an old manifest could be restored into an already-open generation-one registry. | Recovery validated only the recovery envelope, and restore lacked an empty-registry precondition. | Validate both authoritative root envelopes and require restore into an empty registry. | Both dedicated regressions pass. F173 deliberately retains cold-start/cross-Worker rollback as open. |

No separate synthetic mutation operator was necessary for F169–F171: each regression directly mutates the authenticated durable structure at the exact omitted binding. F168 uses the real runtime/Worker workspace boundary.

## F172–F175 ownership and ruling analysis

| Finding | Resolvable from existing specifications? | Ownership boundary crossed | Specification state | Founder/architecture ruling before implementation? |
|---|---|---|---|---|
| **F172** | **Partly.** A003 already requires a per-person P-256 identity and one-time P-256 ECDH transfer from an existing device, so absence is a direct FDN-52 defect and cannot be hidden behind F167. | FDN-84 owns sealed local persistence; FDN-63 owns device enrollment/revocation; FDN-89 owns canonical person/device identity activation. FDN-52 owns key continuity/transfer cryptography. | **Incomplete.** It does not choose the at-rest representation for the private key, binding/version/rotation rules, transfer authentication, replay prevention or rendezvous ceremony. | **Yes.** Preserve the specified P-256 path, but decide the durable identity-key and authenticated one-time transfer contract before code. SLIP-0039 remains separate. |
| **F173** | **The defect is clear; the fix is not.** Mutation-before-commit and unconditional last-write-wins violate the intended authoritative-generation model, but A003 does not define the linearization point. | FDN-84 owns local sealed-store transactions/generations; FDN-51 owns relay/remote authoritative persistence and multi-device convergence. FDN-52 owns protected state transitions. | **Incomplete.** No multi-Worker writer policy, compare-and-swap contract, crash outcome, trusted monotonic anchor or local/remote conflict rule exists. | **Yes.** Decide single-writer/lease versus local CAS versus remote authoritative CAS, and define how a protected transition and its sealed manifest commit atomically. Do not invent a local rollback protocol in FDN-52. |
| **F174** | **Tier 3: yes, direct missing implementation. Tier 2: no.** A003 clearly includes Tier 3 erasure, but its Tier 2 mechanism cannot be implemented from the current architecture. | VPS-F007 owns approval, graph retention and audit semantics; FDN-51/63 own distribution/wipe; FDN-84 owns durable deletion behavior. FDN-52 owns Tier 1/3 protected keys. | **Contradictory for Tier 2.** A003 calls Tier 2 standard encryption/app-held keys, then says erasure deletes every Tier 2 document key. No per-document Tier 2 key exists. | **Yes for Tier 2.** Options requiring a ruling: narrow Tier 2 to field redaction and admit the weaker guarantee; introduce per-erasure-domain Tier 2 envelope keys while retaining server readability; or reclassify affected data into protected tiers. No option is chosen here. Tier 3 erasure remains direct FDN-52 work after atomic persistence is settled. |
| **F175** | **Protocol restriction is resolvable; the absolute boundary claim is not.** Internal manifest keys can be removed from/restricted in the generic production payload API before activation. | FDN-84 owns `sealPayload`/`openPayload`; FDN-52 owns protected crypto APIs; browser WebAuthn defines the ceremony origin. | **Incomplete/overstated.** WebAuthn credentials are Window-exposed, so “PRF result never exists in application code” cannot literally hold. A defensible boundary could prohibit retention/API return and require immediate transfer/detachment, while treating same-origin compromise as outside Worker isolation. | **Yes.** Define the same-origin/XSS threat model and remove or authorize arbitrary internal-key `openPayload` access before protected lifecycle activation. Do not weaken Tier 3 readers or move root decryption into Window. |

## Crash consistency results

The real browser test forces persistence to fail by locking the sealed store immediately before `createProtectedPartition` reaches its durable write:

- the call rejects;
- the in-memory protected registry nevertheless contains the new partition;
- the previous sealed manifest remains byte-for-byte unchanged.

This proves the API does not have one atomic success/failure boundary. A later successful persistence from that runtime could publish state after its caller observed failure; terminating and reopening instead restores the old durable state. Reader removal and cryptographic erasure have the more serious version because they zero/remove in-memory keys before the failed `put`, allowing the old usable envelopes to return on reopen.

The cold-rollback characterization writes encrypted values at generations zero and one, reinstalls the valid generation-zero IndexedDB record, terminates that Worker, and opens it from a new Worker. The new Worker returns the old plaintext and accepts generation zero. `generationHistory` validates internal structure only; no trusted monotonic anchor exists.

Crash injection at every byte boundary is not meaningful for IndexedDB because a single transaction is atomic at the record level. The defect is above that layer: the protected state transition and the record transaction are separate operations, and generations are not compare-and-swapped.

## Concurrency and multi-Worker results

Two actual module Workers, each with its own `LocalGraphWorkerRuntime`, `SealedStore`, database connection and per-Worker queue, were unlocked against the same workspace. Both concurrently wrote the same previously absent logical key. Both promises succeeded. Direct IndexedDB inspection found final generation `0`, not `1`.

Exact interleaving:

1. Worker A reads no record and chooses generation 0.
2. Worker B reads no record and chooses generation 0.
3. Both encrypt independently.
4. Both unconditional `put` transactions commit and report success.
5. One ciphertext wins; no conflict is reported and the generation records only one write.

The `entry.ts` promise queue serializes requests only inside one Worker. Multiple tabs create multiple Workers, so it cannot close this race. Concurrent Tier 3 recovery can produce two distinct generation-N+1 roots/recovery codes while only one survives durably.

## Genuine terminated-Worker result

A first module Worker created one Tier 1 protected partition using a nonextractable P-256 private key and persisted its manifest. The browser terminated that Worker. A second newly constructed module Worker unlocked the same IndexedDB workspace and found the durable manifest, but `restoreProtectedPartitions([])` materialized zero partitions. There is no production API that reloads or reconstructs the destroyed identity private key.

The earlier integrated proof remains valuable for encrypted document/recovery behavior, but its multiple `LocalGraphWorkerRuntime` objects live inside one still-running proof Worker and reuse the same JavaScript `CryptoKey`. It is not evidence of F172 continuity.

## Malformed durable state and property/fuzz results

- 128 deterministic permutations of eight concrete reader IDs produce exactly one canonical sorted ReaderSet and digest.
- Empty, duplicate and control-character reader IDs reject.
- Sampled bit flips across every third byte of a Tier 1 recipient ciphertext reject; a truncated 31-byte encrypted document key rejects.
- 128 deterministic 256-bit Tier 3 recovery secrets encode/decode exactly.
- A durable Tier 3 PRF input shorter than the required canonical 32-byte base64url value failed before the F177 fix and now rejects at schema parsing.
- Altered address, epoch, ciphertext kind, recipient identity, root address, root generation, recovery generation, credential, PRF input, wrong key/code and truncated/corrupted AES-GCM ciphertext fail closed.
- Duplicate protected addresses, impossible epoch histories, cross-document Tier 3 history, Tier 1 envelope kinds in Tier 3 state and unsupported manifest versions reject before materialization.
- The duplicate Tier 3 document cleanup test observed one of two documents freed before F178 and both after; transient keys are now zeroed on failure.

No probabilistic collision claim is made from 128 samples. The property cases protect canonicalization/round-trip invariants; Web Crypto provides the primitive authentication guarantees.

## Negative authorization matrix

| Actor/state | Tier 1 current document | Tier 1 other document | Tier 3 subject root/document | Evidence/result |
|---|---|---|---|---|
| Exact current concrete reader | Materializes and opens | Only if separately present in that document's ReaderSet | Not by Tier 1 identity | Unit and real Chromium positive paths. |
| Removed reader only | **Denied; not materialized** | Unaffected documents still available if reader remains authorized there | Not applicable | Real cold Chromium removed-reader-only proof and old-key rejection. |
| Never-authorized person | **Denied; no envelope** | **Denied** | **Denied** unless exact canonical subject/current credential | ReaderSet/envelope matching and subject equality. |
| Reader newly granted to document A | Immediate A access | **Denied for B** | Not applicable | Real Chromium immediate-grant isolation. |
| Company Owner/HR Admin not in concrete set | **Denied**; role has no cryptographic effect | **Denied** | **Denied** for another subject | Tier 1 consumes exact people, not roles; Tier 3 tests use an Owner-like different session and reject. FDN-89 still owns real set resolution. |
| Tier 3 canonical subject + current credential | Not implied | Not implied | Opens current root/documents | Real WebAuthn PRF persistent reopen. |
| Tier 3 canonical subject + wrong recovery code | Not applicable | Not applicable | **Denied** | Unit and real Chromium. |
| Different subject/Owner + valid-looking credential or code | Not applicable | Not applicable | **Denied before key use** | Exact session-subject equality tests. |
| Retired Tier 3 credential / old recovery code after rotation | Not applicable | Not applicable | **Denied for current/future state** | Unit and real Chromium. A fully rolled-back durable manifest remains F173. |
| Full device/membership revocation | FDN-63 whole-store path | FDN-63 whole-store path | FDN-63 whole-store path | Correctly outside FDN-52 document-only removal; not reimplemented here. |

Unauthorized restore does not create protected registry or SQLite materialization. The encrypted manifest itself remains locally accessible to an unlocked caller through generic `openPayload`; that is F175, not a plaintext authorization success.

## Cryptographic construction review

Confirmed against A003:

- Tier 1 document keys and Tier 3 roots/document keys are 256 random bits.
- Protected content and key/root envelopes use AES-256-GCM with random 96-bit IVs.
- Tier 1 uses P-256 ECDH, a fresh production ephemeral key, HKDF-SHA-256 salt `SHA-256(canonical protected header)`, fixed info `vulto:tier1-recipient-envelope:v1`, and canonical header AAD.
- Tier 3 PRF and recovery envelopes use distinct fixed HKDF info strings, separate canonical root headers/AAD, fresh 32-byte PRF input, credential binding and root/recovery generation binding.
- Document snapshot/update/key-envelope kinds are domain-separated in authenticated metadata.
- Recovery code contains all 256 generated bits in canonical Crockford encoding; no user-chosen low-entropy phrase exists.
- Superseded/transient raw arrays are zeroed where JavaScript retains a mutable byte array; F178 closes the partial-failure hole. Web Crypto internal key/material buffers cannot be explicitly zeroed by JavaScript.

Limitations:

- F157: the custom Tier 1 vector is project-generated rather than independently reproduced.
- Optional deterministic ephemeral/IV inputs exist to support vectors; production callers do not pass them, but a future public activation must keep those seams test-only.
- Random 96-bit GCM IV uniqueness relies on CSPRNG collision probability; there is no persisted nonce counter. This matches the governing specification.
- WebAuthn PRF's Window origin and the generic payload API remain F175. WebAuthn's credential container is a Window-exposed browser API, while PRF results are 32-byte outputs intended for symmetric-key derivation; the specification must describe immediate transfer/detachment rather than claim the bytes originate inside a Worker.

## Specification drift

- **F176, corrected:** A003 listed Tier 0 `Expense` among Tier 1 retention examples.
- **F179, corrected:** A004 retained the old “owner's devices/no cross-device decryption” Tier 3 model after A003 adopted canonical-subject establishment and recovery.
- **F174, open contradiction:** A003 requires deletion of every Tier 2 document key while Tier 2 uses standard application/server-readable encryption with no per-document key.
- **F175, ruling required:** A literal no-application-code PRF boundary conflicts with the browser's Window-exposed WebAuthn ceremony.
- **Stage 6 evidence, corrected:** every “one remaining gap/blocked solely by F167” conclusion was withdrawn and replaced with F172–F175.

No node tier, permission grant, reader role or feature scope changed.

## Verification checkpoint

Final results:

- `git diff --check` — **passed**.
- Targeted Prettier check over every FDN-52 TypeScript/TSX file — **passed**.
- `pnpm lint` — **passed**, 6/6 packages.
- `pnpm typecheck` — **passed**, 6/6 packages.
- `pnpm test` — **passed**. Graph: 15 files/179 tests; schema: 2 files/23 tests; API: 1 file/17 tests; other packages had no test files. Total executed assertions: 219.
- `pnpm pretest:worker-browser && pnpm test:worker-browser` — **passed**, 3/3 real Chromium tests, including PostgreSQL-backed unlock, real module Workers, IndexedDB, CTAP2.1 virtual WebAuthn PRF, terminated-Worker continuity characterization, forced persistence failure, two-Worker race and cold rollback.
- `pnpm verify` — **blocked only at its first format-check stage** by four unrelated pre-existing files: `services/api/browser-tests-device-store/device-revocation-signal.spec.ts`, `services/api/src/auth/auth.integration.test.ts`, `services/api/src/auth/device-unlock.ts`, and `services/api/src/auth/http.ts`. They are absent from this branch's status/diff and were deliberately not reformatted. The independently run lint/typecheck/test stages all pass.

Exact repository state at checkpoint:

- branch: `fdn-52-implement-privacy-tier-partitioning-and-workspace-key`;
- `HEAD`, local `main`, and `origin/main`: `042f7c7274e04723c4c9a9dbd1f7226e477c8835` — main is untouched;
- 14 tracked modified files, with tracked diff `1,110 insertions(+), 32 deletions(-)`;
- 18 untracked status entries: the pre-existing `.claude/worktrees/` directory plus 17 FDN-52 documents/source/test files;
- no commit, merge, reset, branch switch, Linear status change or SLIP-0039 implementation occurred.

Tracked modified files:

```text
apps/roster-web/src/app/worker-diagnostics/worker-diagnostics-client.tsx
docs/Foundations_Findings.md
docs/Vulto_Specs/VPS-A003_Unified_Sync_Architecture.md
docs/Vulto_Specs/VPS-A004_Graph_Permission_Layer.md
packages/graph/package.json
packages/graph/src/index.ts
packages/graph/src/worker/runtime.ts
packages/graph/src/worker/storage/sealed-store.ts
packages/graph/src/worker/storage/storage-keys.ts
packages/schema/src/index.ts
packages/schema/src/registry.test.ts
packages/schema/src/registry/protection.ts
packages/schema/src/registry/validate.ts
pnpm-lock.yaml
```

Untracked FDN-52 files:

```text
docs/FDN-52_Adversarial_QA_Checkpoint.md
docs/FDN-52_SLIP39_Candidate_Assessment.md
docs/FDN-52_Stage6_Requirements_Evidence.md
packages/graph/browser-tests/protected-document-contract.spec.ts
packages/graph/src/worker/protected-document.test.ts
packages/graph/src/worker/protected-document.ts
packages/graph/src/worker/protected-partitions.test.ts
packages/graph/src/worker/protected-partitions.ts
packages/graph/src/worker/testing/adversarial-durability-proof.worker.ts
packages/graph/src/worker/testing/protected-document-proof.worker.ts
packages/graph/src/worker/testing/tier1-envelope-shared-vector.ts
packages/graph/src/worker/tier1-envelope.test.ts
packages/graph/src/worker/tier1-envelope.ts
packages/graph/src/worker/tier3-partitions.test.ts
packages/graph/src/worker/tier3-partitions.ts
packages/graph/src/worker/tier3-root.test.ts
packages/graph/src/worker/tier3-root.ts
```

FDN-52 remains In Progress and must not be marked complete.
