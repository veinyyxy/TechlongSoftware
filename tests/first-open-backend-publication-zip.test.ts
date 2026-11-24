import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { firstOpenBackendProofArchiveLimit, readFirstOpenBackendPublicationZip } from "../ops/aws-sandbox/first-open-backend-publication-zip.ts";

const member = "publication-result.json", body = strToU8(JSON.stringify({ status: "sample", note: "x".repeat(512) }));
const zip = (level: 0 | 6 = 6) => Buffer.from(zipSync({ [member]: body }, { level }));
const central = (bytes: Buffer) => bytes.readUInt32LE(bytes.length - 6);
const rejectsZip = (bytes: Uint8Array) => assert.throws(() => readFirstOpenBackendPublicationZip(bytes), /FIRST_OPEN_BACKEND_PROOF_ZIP/);

function streamingZip(signed: boolean) {
  const archive = zip(), at = central(archive);
  const head = Buffer.from(archive.subarray(0, at)), tail = Buffer.from(archive.subarray(at));
  const descriptor = Buffer.alloc(signed ? 16 : 12), d = signed ? 4 : 0;
  if (signed) descriptor.writeUInt32LE(0x08074b50);
  tail.copy(descriptor, d, 16, 28);
  head.writeUInt16LE(head.readUInt16LE(6) | 8, 6);
  head.fill(0, 14, 26);
  tail.writeUInt16LE(tail.readUInt16LE(8) | 8, 8);
  tail.writeUInt32LE(at + descriptor.length, tail.length - 6);
  return Buffer.concat([head, descriptor, tail]);
}

test("accepts only the exact proof body in stored, deflated and streaming ZIPs", () => {
  for (const archive of [zip(0), zip(6), streamingZip(true), streamingZip(false)]) {
    assert.deepEqual(Buffer.from(readFirstOpenBackendPublicationZip(archive)), Buffer.from(body));
  }
});

test("rejects aliases, extra members, encryption, symlinks and corrupt descriptors", () => {
  rejectsZip(zipSync({ [`sub/${member}`]: body }));
  rejectsZip(zipSync({ [member]: body, "other.json": body }));
  for (const change of [
    (b: Buffer) => { b[30] ^= 1; },
    (b: Buffer) => {
      b.writeUInt16LE(b.readUInt16LE(6) | 1, 6);
      const at = central(b) + 8;
      b.writeUInt16LE(b.readUInt16LE(at) | 1, at);
    },
    (b: Buffer) => b.writeUInt32LE(0xa0000000, central(b) + 38),
  ]) { const bytes = zip(); change(bytes); rejectsZip(bytes); }
  const badDescriptor = streamingZip(true);
  badDescriptor[central(badDescriptor) - 4] ^= 1;
  rejectsZip(badDescriptor);
  const stored = zip(0);
  stored[30 + member.length] ^= 1;
  rejectsZip(stored);
});

test("rejects archive overflow and bounded decompression rejects a lying plain size", () => {
  rejectsZip(new Uint8Array(firstOpenBackendProofArchiveLimit + 1));
  const bytes = zip();
  bytes.writeUInt32LE(10, 22);
  bytes.writeUInt32LE(10, central(bytes) + 24);
  rejectsZip(bytes);
  rejectsZip(zipSync({ [member]: new Uint8Array(firstOpenBackendProofArchiveLimit + 1) }));
});
