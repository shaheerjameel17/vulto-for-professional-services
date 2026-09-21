/**
 * FDN-51 Stage 5 — the committed server-opacity fixtures stay real and current.
 *
 * `services/sync-engine/tests/relay_pg.rs` consumes the checked-in
 * `tier1.json` / `tier3.json`. This guards them against drift: if an FDN-52
 * construction changes, the builders' output diverges from the committed
 * files and this fails, prompting `pnpm stage5:opacity-fixtures` + review
 * rather than a silently stale proof. It also decrypts one payload per tier
 * to confirm the committed ciphertext is genuine, not a placeholder.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createProtectedDocumentAddress,
  createProtectedEnvelopeHeader,
  createProtectedReaderSet,
  protectedEnvelopeAdditionalData,
} from "../protected-document";
import { buildTier1Fixture, buildTier3Fixture } from "./stage5-opacity-fixtures";

const dir = fileURLToPath(
  new URL(
    "../../../../../services/sync-engine/tests/vectors/opacity/",
    import.meta.url,
  ),
);

function committed(file: string): unknown {
  return JSON.parse(readFileSync(`${dir}${file}`, "utf8"));
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

async function aesDecrypt(
  keyBytes: Uint8Array,
  ivBytes: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ivBytes as BufferSource,
        additionalData: aad as BufferSource,
      },
      key,
      ciphertext as BufferSource,
    ),
  );
}

describe("FDN-51 Stage 5 opacity fixtures", () => {
  it("tier1.json matches the deterministic builder byte-for-byte", async () => {
    expect(await buildTier1Fixture()).toEqual(committed("tier1.json"));
  });

  it("tier3.json matches the deterministic builder byte-for-byte", async () => {
    expect(await buildTier3Fixture()).toEqual(committed("tier3.json"));
  });

  it("the committed tier1 document-update payload is real ciphertext of the recorded plaintext", async () => {
    const fixture = await buildTier1Fixture();
    const documentKey = fromHex(
      fixture.must_be_absent.find((s) => s.name === "tier1 per-document key")!.hex,
    );
    const plaintext = fromHex(
      fixture.must_be_absent.find((s) => s.name === "tier1 protected plaintext")!.hex,
    );
    const envelope = JSON.parse(
      new TextDecoder().decode(fromHex(fixture.payloads[0]!.hex)),
    ) as { header: unknown; iv: string; ciphertext: string };

    const readerSet = await createProtectedReaderSet(["user-stage5-opacity-subject"]);
    const address = await createProtectedDocumentAddress({
      workspaceId: "5721b0de-0000-4000-8000-00000000a5a5",
      nodeType: "Employee",
      schemaPartition: "compensation",
      tier: 1,
      readerSet,
      timeBucket: "2026-09",
      erasureDomainId: "stage5-opacity",
    });
    const header = createProtectedEnvelopeHeader({
      address,
      keyEpoch: 1,
      ciphertextKind: "document-update",
    });
    const decrypted = await aesDecrypt(
      documentKey,
      Uint8Array.from(atob(envelope.iv), (c) => c.charCodeAt(0)),
      protectedEnvelopeAdditionalData(header),
      Uint8Array.from(atob(envelope.ciphertext), (c) => c.charCodeAt(0)),
    );
    expect(decrypted).toEqual(plaintext);
  });

  it("every recorded secret is at least 32 bytes so a byte-window scan cannot collide by chance", async () => {
    for (const fixture of [await buildTier1Fixture(), await buildTier3Fixture()]) {
      for (const secret of fixture.must_be_absent) {
        expect(fromHex(secret.hex).byteLength).toBeGreaterThanOrEqual(32);
      }
    }
  });
});
