# FDN-52 Stage 6B — SLIP-0039 Implementation Candidate Assessment

**Date:** 20 August 2026  
**Status:** assessment complete; production recovery remains blocked by F167  
**Decision boundary:** this document recommends an audit target. It does not approve a dependency, add a production code path, or weaken `VPS-A003`'s pinned-audited-standards-conformant rule.

## Governing requirements

`VPS-A003` fixes all of the following together:

- Tier 1 recovery is SLIP-0039, two of three by default (A003-T14).
- The implementation is pinned, independently audited, and standards-conformant.
- Vulto does not hand-write Shamir or substitute generic secret sharing.
- Recovery secrets and reconstructed document keys exist only in Worker memory.
- The implementation that is audited must be the implementation and revision Vulto actually ships.

The [official SLIP-0039 specification](https://github.com/satoshilabs/slips/blob/master/slip-0039.md) is the conformance source. Its 45-vector set and the [Trezor Python reference](https://github.com/trezor/python-shamir-mnemonic) are correctness oracles, not production approval. Trezor explicitly says the Python reference is unhardened, exposes secrets in ordinary process memory, and should not handle sensitive secrets.

## Assessment method and limits

The assessment inspected exact upstream source and history in an isolated temporary checkout. No candidate was added to the repository, package lock, production graph package, or Worker. Published security advisories and audit reports were searched for each serious candidate. “No published advisory found” below is not evidence that a candidate is safe. Test vectors, downloads, stars, and wallet usage are likewise not substitutes for an independent cryptographic audit.

The Worker compatibility question is stricter than “can run in a browser.” The candidate must execute inside the existing module Worker, take and return secrets without a main-thread hop, obtain randomness from a cryptographically secure browser source, avoid persistence/logging, expose a small auditable adapter, and permit exact reproducible pinning.

## Candidate comparison

### Trezor `python-shamir-mnemonic`

- **Revision assessed:** `17fcce14736afe498871d3018e4fa9330443471a`; latest published package `0.3.0` (16 May 2024).
- **Runtime / maintenance:** Python reference; five releases since 2019, last substantive release in 2024; zero runtime dependencies in the core package as of 0.3.0.
- **Conformance:** normative reference and owner of the current 45 official vectors, including extendable shares.
- **Production / assurance:** correctness oracle only. Its own security notice says it is not hardened and should not handle sensitive secrets. No implementation-specific independent cryptographic audit was found.
- **Worker fit:** not directly executable in Vulto's browser Worker. Pyodide or another Python-in-WASM runtime would add a very large interpreter and supply chain; translating it would be the prohibited local implementation.
- **Memory handling:** Python immutable objects and garbage collection prevent reliable zeroing; upstream expressly acknowledges plaintext secret handling.
- **License / pinning:** MIT; exact commit and package hashes are pin-able.
- **Decision:** **reject for production; retain as the independent reference oracle.**

### `ilap/slip39-js` / npm `slip39`

- **Revision assessed:** `d316ee6a929ab645fe5462ef1c91720eb66889c8`; package version `0.1.9`. Tag `v0.1.9` points to `414a73b0a28f2fc966514b8f318eb6f68bf9979a`; BlueWallet deliberately pins the later full revision.
- **Runtime / maintenance:** CommonJS JavaScript, about 2,117 source lines, zero declared runtime dependencies. First release in 2019; current code last changed in June 2024. The repository labels itself early-development and “use at your own risk.”
- **Conformance:** carries all 45 current reference vectors and extendable-share support. Passing them is necessary but not independent assurance.
- **Production users:** BlueWallet is a credible production consumer and pins its fork to the exact `d316ee6` revision. The official specification's old BlueWallet source-directory link is stale: BlueWallet removed that copy in 2021 and now consumes this fork. Trezor also identifies BlueWallet as a SLIP-0039-compatible wallet.
- **Worker fit:** **not actually browser-Worker ready as published.** It synchronously calls Node's `crypto.randomBytes`, `pbkdf2Sync`, and `createHmac`, relies on `Buffer`, and mutates `String.prototype` and `Array.prototype`. Vulto has no Node-crypto polyfill in the Worker. Replacing those synchronous primitives with asynchronous Web Crypto would be a security-sensitive fork, not a thin adapter.
- **Memory / key handling:** ordinary JavaScript strings, arrays, Buffers, and prototype extensions; no systematic zeroing. Its table-driven arithmetic has no constant-time claim.
- **Audit / advisories:** no published independent cryptographic audit or package-specific security advisory was found. The absence of a published advisory is not a safety finding.
- **License / pinning:** MIT; small and pin-able by commit or vendored hash.
- **Decision:** **reject as Vulto's audit target.** Its direct integration is incompatible with the Worker; making it compatible requires material security-sensitive changes that would themselves become a new implementation.

### BlueWallet's officially listed implementation

- **Revision assessed:** BlueWallet `e242791752cb79f8372305472abf3623523e2465`; its dependency is `github:BlueWallet/slip39-js#d316ee6`.
- **Finding:** this is no longer an independent implementation. The listed `blue_modules/slip39` directory was removed in 2021. Current BlueWallet provides production-use evidence for `ilap/slip39-js`, but not a second implementation or separate audit lineage.
- **Decision:** **do not count it as an independent candidate or cross-verifier.**

### `ilap/slip39-dart`

- **Revision assessed:** `283ab32b07dea131ca6916cd05f213143d7ac60f`; version `0.3.0`; last changed April 2026.
- **Runtime / maintenance:** Dart implementation by the same author and lineage as `slip39-js`; active more recently, but still carries the same early-development disclaimer.
- **Conformance:** includes the 45 official vectors and current extendable-share support.
- **Worker fit:** Dart-to-JavaScript compilation is technically possible, but Vulto would add a Dart toolchain/runtime boundary and a generated-JavaScript review problem. A Worker adapter would still own secret transfer and lifecycle.
- **Memory / assurance:** garbage-collected strings/lists; no demonstrated zeroization, constant-time claim, published independent audit, or credibly identified production use.
- **License / pinning:** MIT; exact source can be pinned, but reproducible generated output adds another artifact/toolchain to audit.
- **Decision:** **reject in favor of the smaller and more reviewable candidates.**

### `gavincarr/go-slip39`

- **Release assessed:** latest indexed release `v0.1.3` (30 October 2024). The upstream Git repository was unavailable during this assessment, so a current immutable source commit could not be independently resolved.
- **Runtime / maintenance:** Go port of the Python reference; MIT. The package declares sixteen imports and has one indexed importer.
- **Conformance:** current API includes extendable shares and full group/member semantics; published documentation identifies it as a reference port.
- **Security:** upstream explicitly says it is unhardened, passes secrets openly, has not been professionally audited, and should not be used for sensitive secrets.
- **Worker fit:** Go can target browser WASM, but this candidate has no reviewed Worker/WASM adapter. The Go runtime, FFI boundary, and generated artifact would all enter the audit scope.
- **Decision:** **reject.** The upstream's own production warning and unresolved immutable repository state are disqualifying.

### `shurlinet/go-slip39`

- **Revision assessed and recommended:** `5c07db3111d767e326933838ac92d7c5b3d8ef15` (`v0.1.0`, 10 May 2026).
- **Runtime / maintenance:** pure Go library, approximately 1,600 implementation lines plus a substantial test/fuzz suite. It has one external dependency, `golang.org/x/crypto v0.51.0`, for PBKDF2. It is new, has no credibly identified production consumer, and was developed with disclosed AI assistance; those are audit risks, not endorsements.
- **Conformance:** implements current extendable and non-extendable SLIP-0039, all threshold/group/member semantics, passphrases, the canonical word list, and all 45 official vectors. It includes generated cross-implementation fixtures against the Python reference, exhaustive GF(256)/checksum checks, property tests, anti-tamper tests, and fuzz targets. These claims require independent reproduction.
- **Worker fit:** Go officially supports `js/wasm`; on that target `crypto/rand` uses Web Crypto. A dedicated main-package wrapper could keep input/output inside the module Worker. However, Go's browser runtime requires a matching `wasm_exec.js`, the current Vulto toolchain does not include Go, and the wrapper/FFI is security-sensitive. The exact Go compiler, module hashes, generated WASM, support runtime, and adapter must therefore be pinned and audited as one delivery unit.
- **Memory / key handling:** the library uses byte slices and explicit no-inline zeroing, constant-time digest comparison, and bitsliced GF(256) without data-dependent table lookups. Its own documentation honestly notes that Go's garbage collector may copy secret data before zeroing; an audit must evaluate whether the `js/wasm` runtime weakens these claims further.
- **Audit / advisories:** no published independent cryptographic audit or package-specific advisory was found. Its security properties are author claims until independently verified.
- **License / pinning:** MIT, with Apache-2.0 attribution for translated Trezor arithmetic. Exact commit and module sums are reproducibly pin-able. Vendoring is feasible, but adding a Go/WASM build lane requires an explicit repository/toolchain decision; the assessment does not silently make it.
- **Decision:** **best available independent-audit target, not approved for production.** It is preferred because it is current-spec, compact, dependency-light, cross-implementation tested, designed around zeroable byte buffers, and browser-WASM feasible without Vulto reimplementing SLIP-0039. Its youth, AI-assisted origin, Go runtime, and absence of production use make a rigorous external audit more important, not less.

### Official Rust candidates

- **`rust-bitcoin/rust-wallet/src/sss.rs`:** old in-repository implementation tied to an obsolete wallet codebase and old Bitcoin/crypto APIs. It predates the current extendable-share format (`CUSTOMIZATION_STRING` is only `shamir`) and is not a maintained standalone package. **Reject: not current SLIP-0039 and not a practical pin.**
- **`Internet-of-People/slip39-rust` revision `9a563088ec922f4173efcfa9bb9babca4893809d`:** last changed July 2022, release `0.1.1`, GPL-3.0-or-later, depends on a pinned git revision plus a wildcard package and multiple CLI dependencies. No current-vector, extendable-share, audit, constant-time, or WASM evidence was found. **Reject: stale format/maintenance, license and dependency surface.**
- **WASM assurance conclusion:** Rust/WASM is not automatically safer than JavaScript. It can improve byte-buffer control, but these candidates add allocator/FFI/wrapper/toolchain risk and neither offers a current audited implementation. It also conflicts with the repository rule confining Rust to `services/sync-engine` unless introduced strictly as an audited third-party artifact under a separate ruling.

### Trezor C and official C# candidates

- Trezor's production firmware has mature SLIP-0039 use and hardened C arithmetic, but the reusable `crypto/slip39.c` file is not the complete high-level split/combine construction. Extracting firmware Python/C pieces into browser WASM would make Vulto responsible for material glue and a custom build. **Reject as a direct library candidate; use its behavior and vectors as audit references.**
- `lontivero/Slip39` and `xecrets/xecrets-slip39` are genuine C# implementations. Browser execution requires the .NET/Blazor WASM runtime plus a Worker bridge. That runtime and adapter are disproportionate to this narrow primitive, and no implementation-specific independent cryptographic audit was found. **Reject for Vulto's Worker architecture.**

### Other discovered implementations

Generic Shamir/SSKR libraries are rejected even when audited because they are not SLIP-0039. Wallet applications such as Electrum, Sparrow, and Trezor prove ecosystem use of the format but do not expose a small Worker-compatible package Vulto can ship without extracting or rewriting security-sensitive code. No already-audited, current, browser-Worker-compatible SLIP-0039 library was found.

## Recommended immutable audit target

Commission the implementation audit against:

> `shurlinet/go-slip39` at `5c07db3111d767e326933838ac92d7c5b3d8ef15`

This revision is only the upstream half of the eventual shipping target. Before the audit starts, an isolated, non-production-reachable integration branch must freeze:

1. that exact upstream source tree;
2. exact Go compiler/container digest;
3. `golang.org/x/crypto v0.51.0` and all module sums;
4. the exact Worker-only `js/wasm` wrapper source;
5. the matching `wasm_exec.js` from the same Go release;
6. the generated WASM bytes and digest;
7. Vulto's TypeScript adapter revision and public surface.

The independent audit must cover that complete frozen unit and its produced artifact. Auditing upstream alone is insufficient. Any upstream, compiler, dependency, wrapper, or adapter change invalidates approval until reviewed under the audit's change policy.

## Expected Vulto adapter surface

The adapter should be deliberately smaller than the cryptographic construction:

- `split(secret: Uint8Array, configuration: fixed 2-of-3, passphrase policy): Promise<readonly [string, string, string]>`
- `combine(shares: readonly string[], passphrase policy): Promise<Uint8Array>`
- explicit `dispose/zero` behavior for every returned or temporary byte buffer
- structured, bounded errors for malformed, duplicate, mixed-identifier, inconsistent-threshold, insufficient, or excessive input
- no logs, callbacks, telemetry, persistence, network, main-thread messages, or generic caller-supplied random source
- no API exposing lower-level GF(256), interpolation, checksum, Feistel, identifier, or deterministic-random controls to production

The adapter is security-sensitive because it owns WASM memory copies, input bounds, zeroing, error translation, and Worker confinement. It must not implement SLIP-0039 arithmetic or encoding.

## Independent audit scope

The audit statement and report must identify the exact frozen source and binary hashes and cover:

1. SLIP-0039 algorithmic correctness against the current specification.
2. All 45 official positive and negative vectors.
3. Bidirectional cross-verification against Trezor Python `0.3.0` at `17fcce14736afe498871d3018e4fa9330443471a`.
4. CSPRNG use in browser `js/wasm`, random-identifier generation, polynomial randomness, short-read/error behavior, and prohibition of deterministic production injection.
5. Group/member thresholds and counts, especially Vulto's fixed single-group 2-of-3 configuration.
6. Mnemonic word encoding, padding, RS1024 checksum, extendable flag, iteration exponent, identifier, and passphrase/Feistel semantics.
7. Malformed shares, duplicates, excessive shares, inconsistent thresholds/counts, mixed identifiers/extendable flags/iteration exponents, insufficient groups/members, and invalid Unicode/size inputs.
8. Constant-time and side-channel claims across Go source, generated WASM, and the JavaScript runtime boundary; document what cannot be guaranteed in a browser.
9. Secret lifetime, Go GC copies, WASM linear-memory reuse/growth, explicit zeroing, TypeScript copies, strings that cannot be zeroed, exceptions, cancellation, termination, and crash paths.
10. Module Worker confinement: no secret-bearing `postMessage`, main-thread callback, global debug export, persistence, log, network, or telemetry path.
11. Denial-of-service bounds: mnemonic length/count, iteration exponent, allocation, CPU, pathological Unicode, and repeated failures.
12. Vulto adapter correctness and failure atomicity, including no partial share-set success.
13. Dependency and build supply chain: compiler/container, module sums, `x/crypto`, `wasm_exec.js`, reproducible WASM digest, licenses, and update policy.
14. Review of all AI-assisted code without treating existing tests or comments as independent evidence.

## Interoperability gate

This gate is required in addition to the audit:

- all official vectors, with expected failure classes preserved;
- Vulto-generated 2-of-3 shares reconstructed by the pinned Trezor Python reference;
- Python-generated shares reconstructed inside Vulto's real Chromium module Worker;
- randomized bidirectional property cases across supported secret sizes, extendable modes, passphrase behavior, iteration exponents, and threshold configurations used for audit coverage;
- dedicated default 2-of-3 cases for every pair of the three shares;
- corrupted word/checksum, malformed mnemonic, duplicate share, wrong share set, insufficient shares, mixed identifiers, mixed thresholds/group metadata, mixed extendable flags, mixed iteration exponents, wrong passphrase behavior, and bounded oversized input;
- byte-identical original/reconstructed workspace recovery secret, followed immediately by recovery-envelope unwrap/re-wrap and zeroization checks;
- a real Worker-boundary assertion that shares may be displayed only through the explicit setup ceremony while the reconstructed secret and document keys never cross the Worker.

Cross-implementation success proves interoperability, not resistance to leakage, side channels, denial of service, or supply-chain compromise. It cannot replace the independent audit.

## Result

Stage 6B has produced one auditable direction, not a shippable recovery path. F167 remains the sole direct FDN-52 implementation blocker: production Tier 1 recovery stays disabled until the frozen `shurlinet/go-slip39` delivery unit is independently audited, the audit findings are remediated and re-reviewed, the exact revision/artifacts are approved, and the repository/toolchain addition is explicitly accepted. No candidate code or dependency has entered Vulto.
