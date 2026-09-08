//! Vulto sync engine — the native server binary, PLACEHOLDER.
//!
//! # This binary is one of three targets built from `lib.rs`, and it is server-only
//!
//! `lib.rs` is the shared core FDN-46 proves compiles to all three of A007's
//! sixth gate's targets. This file is not one of them — it is a separate
//! Cargo build target (`cargo build --bin vulto-sync-engine`), and the WASM
//! and mobile proofs build `--lib` only and never touch it. See `lib.rs`'s
//! module doc for why, and for a claim in an earlier version of this comment
//! that testing found to be false.
//!
//! It exists so that the *boundary* is real from the first commit. It gets its
//! content in **FDN-51**, "Deliver encrypted multi-device delta synchronization
//! and convergence", which implements VPS-A003. Until then this crate compiles,
//! containerizes, and does nothing else.
//!
//! # What it exists to prove
//!
//! **A001-T04** — every engineer not working on the sync engine must be able to
//! run the full local stack without a Rust toolchain. That requirement is
//! vacuous while no Rust exists: "runs without Rust" is trivially true when
//! there is no Rust to run. This crate makes the test mean something. The
//! compose stack builds it inside a container, so the host never needs `cargo`,
//! and VPS-A007's A007-T19 assigns exactly that proof to the development image.
//!
//! **A007-T17** — a service image must not contain a compiler or build
//! toolchain; it receives a built artifact. See `Dockerfile`: the Rust toolchain
//! lives in a builder stage that is discarded, and the runtime image carries a
//! binary and nothing else.
//!
//! # The health endpoint is scaffolding, not an interface
//!
//! `GET /health` is here so the container has something to report readiness on
//! and so `docker compose up --wait` can tell the stack is up. **It is not the
//! sync engine's API surface**, it is not part of any contract, and nothing
//! should be built against it. The real boundary — the delta and snapshot
//! contract this service will speak — is defined by **FDN-46**, and its protocol
//! by VPS-A003. Anything here is replaced wholesale, not extended.
//!
//! # No dependencies, deliberately
//!
//! Standard library only. A placeholder that pulled in an async runtime and an
//! HTTP framework would take minutes to compile for no benefit, and would commit
//! this crate to choices FDN-51 should make with the real requirements in front
//! of it.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};

use vulto_sync_engine::placeholder_info;

/// Built from the shared core's own self-description, not a second copy of
/// it — see `lib.rs`'s module doc for why that distinction is the point.
fn body() -> String {
    let info = placeholder_info();
    format!(
        "{{\"service\":\"{}\",\"status\":\"placeholder\",\"sync\":\"{}\",\
         \"content_owner\":\"{}\",\"note\":\"Scaffolding for container readiness. \
         Not an API surface. See VPS-A003 for the sync protocol and FDN-46 for \
         the delta contract.\"}}",
        info.service, info.status, info.content_owner
    )
}

fn main() {
    let port = std::env::var("SYNC_ENGINE_PORT").unwrap_or_else(|_| "8080".into());
    let addr = format!("0.0.0.0:{port}");

    let listener = TcpListener::bind(&addr).unwrap_or_else(|e| {
        eprintln!("vulto-sync-engine: cannot bind {addr}: {e}");
        std::process::exit(1);
    });

    println!("vulto-sync-engine: PLACEHOLDER listening on {addr}");
    println!("vulto-sync-engine: no sync logic. Content arrives with FDN-51.");

    for stream in listener.incoming() {
        match stream {
            Ok(s) => handle(s),
            Err(e) => eprintln!("vulto-sync-engine: connection failed: {e}"),
        }
    }
}

fn handle(mut stream: TcpStream) {
    let mut line = String::new();
    if BufReader::new(&stream).read_line(&mut line).is_err() {
        return;
    }

    let path = line.split_whitespace().nth(1).unwrap_or("/");

    let response = match path {
        "/health" | "/" => {
            let body = body();
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
        }
        _ => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
    };

    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}
