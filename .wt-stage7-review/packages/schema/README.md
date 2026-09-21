# @vulto/schema

The canonical, immutable contract compiled from `VPS-A002`:

- 109 node registrations, including fixed versus feature-owned lifecycle policy
- 79 edge labels normalized to 110 exact endpoint triples
- 13 closed Privacy Classes and nine guaranteed split-node partitions
- ten cross-suite ownership rules and three conversion registrations
- JSON-native Zod validators for universal node and edge records

Consumers import only from `@vulto/schema`. There is no mutable registration API
and no supported deep-import surface. FDN-49 owns the conformance checks that
compare future specification and implementation changes; this package validates
its own canonical data and record shapes at import and in unit tests.

The registry deliberately does not define feature fields, permission grants,
reader sets, encryption envelopes or worker behavior. A feature-owned lifecycle
is recorded as feature-owned rather than guessed here.

## Why `loro-crdt` is declared here, and declared before anything imports it

`A001-T02` is a specification requirement, not housekeeping:

> The CRDT library MUST be Loro. The exact version MUST be pinned in the
> lockfile at implementation start and recorded in `VPS-A001` in the same commit.

**FDN-47 is implementation start.** Deferring the pin until the first import
would make "implementation start" mean whenever someone happens to feel like it,
which is exactly the deferral `VPS-A001`'s Decisions section already rejected
once by calling the version _"a specification requirement, not an open item."_

**This package declares it because this package is the first legitimate
importer.** `VPS-A002`'s Schema Evolution Protocol makes the schema package the
enforcement point, and prohibits raw untyped access to CRDT documents anywhere
outside the sync engine and the materialization worker. FDN-45 defines the
JSON-native graph boundary here; FDN-48 owns the actual local Loro graph layer.

**The risk this creates, stated so it is not discovered.** A pinned dependency
that nothing imports looks like dead weight, and a later cleanup deletes it —
taking `A001-T02`'s record with it and leaving `VPS-A001` naming a version no
longer in the lockfile, which is worse than never having pinned it. The mitigation
is that `VPS-A001`'s record names this package as the declarer, so the two point
at each other and a cleanup has to confront the specification rather than only a
`package.json`.

**Pinned exactly, not by range.** `loro-crdt@1.14.1`. A caret range is not a pin,
and this repository has already been bitten by that: `typescript@^5.7.3` had
silently drifted to `5.9.3` and `turbo@^2.3.4` to `2.10.8` before FDN-47 froze
them.

## Zod pin

`zod@4.4.3` is pinned exactly and was verified against the npm registry before
being recorded. It owns runtime validation of the JSON-native TypeScript–Rust
boundary. Types are inferred from those validators so the runtime and compile-
time representations do not drift into two independent definitions.
