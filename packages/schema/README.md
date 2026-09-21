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
reader sets, encryption envelopes or client behavior. A feature-owned lifecycle
is recorded as feature-owned rather than guessed here.

## Zod pin

`zod@4.4.3` is pinned exactly and was verified against the npm registry before
being recorded. It owns runtime validation of the JSON-native graph boundary
between the API, the sync client and the database. Types are inferred from those validators so the runtime and compile-
time representations do not drift into two independent definitions.
