# @vulto/schema

**Empty and buildable. Content arrives with FDN-45.**

This package will hold `VPS-A002`'s node and edge registry as typed contracts,
the Universal Node and Edge Conventions, and the Zod validators shared by the
client, the API and the sync engine. FDN-47 creates it as a placeholder because
it owns repository structure; it does not own what goes in it.

Nothing may be added before FDN-45. `A002-T09` makes registration precede
implementation, and `VPS-A007`'s third gate fails any type here with no row in
`VPS-A002`'s registry.

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
outside the sync engine and the materialization worker. The Loro document shapes
are therefore defined here, by FDN-45.

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
