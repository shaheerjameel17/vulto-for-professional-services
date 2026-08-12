# services/sync-engine

**This is a placeholder. It contains no sync logic.**

The sync engine's substance — the sync protocol, the encryption model, key
wrapping, and permission-filtered relay — belongs to `VPS-A003` and `VPS-A004`.
Neither is the Core Engineering and Graph Foundations phase's specification, and
building a relay before there is a protocol for it to speak would be building
against nothing.

**Content arrives with FDN-51**, "Deliver encrypted multi-device delta
synchronization and convergence."

## Why it exists now rather than later

`A001-T04` requires every engineer not working on the sync engine to run the
full local stack without a Rust toolchain. **That requirement is vacuous while no
Rust exists** — "runs without Rust" is trivially true when there is no Rust — and
the first time it means anything is the day someone adds a crate and finds the
bootstrap path assumed `cargo`.

This crate makes the test real from the first commit. `VPS-A007`'s `A007-T19`
assigns the `A001-T04` proof to the development image, which is what the compose
stack and the devcontainer provide.

## What is deliberately absent

**Dependencies.** Standard library only. An async runtime and an HTTP framework
would cost minutes of compile time for no benefit and would commit this crate to
choices FDN-51 should make with the real requirements in front of it.

**The WASM and mobile targets.** `VPS-A007`'s sixth gate requires this crate to
build three ways from one source. Proving that is **FDN-46**'s, not this issue's.
`rust-toolchain.toml` already installs the `wasm32-unknown-unknown` target so the
proof is a build away.

## `GET /health` is not an API

It exists so the container reports readiness and `docker compose up --wait` can
tell the stack is up. **It is not the sync engine's interface**, it is not part of
any contract, and nothing should be built against it. The delta and snapshot
contract this service will speak is defined by FDN-46. Everything here is
replaced wholesale rather than extended.

## Two costs recorded, so neither is mistaken for a defect later

**A cold `docker compose up` compiles Rust inside the container.** Your host stays
clean, which is what `A001-T04` requires, but the first build pays a compile. For
a std-only placeholder that is seconds. **When FDN-51 gives this crate real
content that becomes minutes**, and the answer changes to pulling a prebuilt image
from a registry rather than building locally. That is a deliberate scope boundary,
not a performance regression to file a bug against.

**The image is built, not pulled.** There is no registry in this setup yet.
Publishing is part of the pipeline, which `VPS-A007` owns and FDN-55 implements.
