import { describe, expect, it } from "vitest";
import canonicalize from "canonicalize";
import {
  createProtectedDocumentAddress,
  createProtectedEnvelopeHeader,
  createProtectedReaderSet,
  protectedEnvelopeAdditionalData,
} from "./protected-document";

const decoder = new TextDecoder();

/**
 * External RFC 8785 oracles, copied verbatim from RFC 8785 §3.2.2–§3.2.4
 * and its published property-order test data. These expected strings are
 * not produced by Vulto code.
 */
describe("RFC 8785 canonicalization dependency", () => {
  it("matches the RFC's complete primitive serialization example", () => {
    // Parsed from the RFC's published JSON text. Writing its first number as
    // a TypeScript literal would round it before the test reached JCS.
    const value = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/","literals":[null,true,false]}',
    );

    expect(canonicalize(value)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("matches the RFC's UTF-16 code-unit property-sort vector", () => {
    const value = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      דּ: "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      ö: "Latin Small Letter O With Diaeresis",
    };

    expect(canonicalize(value)).toBe(
      '{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
  });
});

describe("protected document address and header", () => {
  async function fixture() {
    const readerSet = await createProtectedReaderSet(["user-bravo", "user-alpha"]);
    const address = await createProtectedDocumentAddress({
      workspaceId: "workspace-1",
      nodeType: "Employee",
      schemaPartition: "compensation",
      tier: 1,
      readerSet,
      timeBucket: "2026-08",
      erasureDomainId: "employee-1",
    });
    return { readerSet, address };
  }

  it("normalizes concrete readers and binds their digest into the address", async () => {
    const { readerSet, address } = await fixture();
    expect(readerSet.userIds).toEqual(["user-alpha", "user-bravo"]);
    expect(address.readerSetId).toBe(readerSet.id);
  });

  it("keeps reader-set identity invariant across deterministic permutations", async () => {
    const readers = [
      "reader-0",
      "reader-1",
      "reader-2",
      "reader-3",
      "reader-4",
      "reader-5",
      "reader-6",
      "reader-7",
    ];
    const oracle = await createProtectedReaderSet(readers);
    let state = 0x52_89_00_01;
    const random = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state;
    };

    for (let trial = 0; trial < 128; trial += 1) {
      const permutation = [...readers];
      for (let index = permutation.length - 1; index > 0; index -= 1) {
        const swap = random() % (index + 1);
        [permutation[index], permutation[swap]] = [
          permutation[swap]!,
          permutation[index]!,
        ];
      }
      await expect(createProtectedReaderSet(permutation)).resolves.toEqual(oracle);
    }
  });

  it("rejects empty and duplicate supplied reader sets", async () => {
    await expect(createProtectedReaderSet([])).rejects.toThrow(
      "at least one concrete reader",
    );
    await expect(
      createProtectedReaderSet(["user-alpha", "user-alpha"]),
    ).rejects.toThrow("duplicate");
    await expect(createProtectedReaderSet(["user-alpha\nadmin"])).rejects.toThrow(
      "ASCII identifier",
    );
  });

  it("rejects a reader-set digest paired with different concrete people", async () => {
    const readerSet = await createProtectedReaderSet(["user-alpha"]);
    await expect(
      createProtectedDocumentAddress({
        workspaceId: "workspace-1",
        nodeType: "Employee",
        schemaPartition: "compensation",
        tier: 1,
        readerSet: { ...readerSet, userIds: ["user-bravo"] },
        timeBucket: "2026-08",
        erasureDomainId: "employee-1",
      }),
    ).rejects.toThrow("does not match");
  });

  it("fails closed when an address contradicts the registered effective tier", async () => {
    const readerSet = await createProtectedReaderSet(["user-alpha"]);
    await expect(
      createProtectedDocumentAddress({
        workspaceId: "workspace-1",
        nodeType: "Employee",
        schemaPartition: "compensation",
        tier: 3,
        readerSet,
        timeBucket: "current",
        erasureDomainId: "employee-1",
      }),
    ).rejects.toThrow(/expected 1, received 3/);
    await expect(
      createProtectedDocumentAddress({
        workspaceId: "workspace-1",
        nodeType: "InventedNode",
        schemaPartition: "private",
        tier: 3,
        readerSet,
        timeBucket: "current",
        erasureDomainId: "employee-1",
      }),
    ).rejects.toThrow(/not registered/);
  });

  it("canonicalizes every address field, epoch, and ciphertext kind into AAD", async () => {
    const { address } = await fixture();
    const header = createProtectedEnvelopeHeader({
      address,
      keyEpoch: 3,
      ciphertextKind: "document-update",
    });
    const serialized = decoder.decode(protectedEnvelopeAdditionalData(header));

    expect(serialized).toBe(
      '{"address":{"erasureDomainId":"employee-1","nodeType":"Employee","readerSetId":"' +
        address.readerSetId +
        '","schemaPartition":"compensation","tier":1,"timeBucket":"2026-08","workspaceId":"workspace-1"},"ciphertextKind":"document-update","formatVersion":1,"keyEpoch":3}',
    );
  });
});
