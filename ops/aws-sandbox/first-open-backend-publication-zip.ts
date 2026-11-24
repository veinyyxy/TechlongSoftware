import { crc32, inflateRawSync } from "node:zlib";

export const firstOpenBackendProofArchiveLimit = 1024 * 1024;
const name = Buffer.from("publication-result.json", "ascii");
const bad = () => { throw new Error("FIRST_OPEN_BACKEND_PROOF_ZIP"); };

// Same single-member ZIP layout as the identity proof reader. Include GitHub's
// streaming data descriptor; never extract to disk or trust its length alone.
export function readFirstOpenBackendPublicationZip(zip: Uint8Array): Uint8Array {
  const limit = firstOpenBackendProofArchiveLimit;
  if (zip.byteLength < 22 + 46 + 30 + 2 * name.length || zip.byteLength > limit) return bad();
  const b = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength), end = b.length - 22;
  const u16 = (p: number) => b.readUInt16LE(p), u32 = (p: number) => b.readUInt32LE(p);
  try {
    if (u32(end) !== 0x06054b50 || u32(end + 4) !== 0 || u16(end + 8) !== 1 || u16(end + 10) !== 1 || u16(end + 20) !== 0) return bad();
    const central = u32(end + 16), dirSize = u32(end + 12);
    if (central < 30 + name.length || central + dirSize !== end || dirSize < 46 + name.length || u32(central) !== 0x02014b50) return bad();
    const flags = u16(central + 8), method = u16(central + 10), crc = u32(central + 16), packed = u32(central + 20), plain = u32(central + 24);
    const attributes = u32(central + 38), unixType = attributes >>> 16 & 0xf000;
    const centralExtra = u16(central + 30), localExtra = u16(28), descriptor = Boolean(flags & 8);
    if ((flags & ~(method === 8 ? 0x80e : 0x808)) !== 0 || (method !== 0 && method !== 8) || plain < 1 || plain > limit || packed < 1 || packed > limit ||
      u16(central + 28) !== name.length || u16(central + 32) !== 0 || u16(central + 34) !== 0 || u32(central + 42) !== 0 ||
      (attributes & 0x10) !== 0 || (unixType !== 0 && unixType !== 0x8000) || dirSize !== 46 + name.length + centralExtra ||
      !name.equals(b.subarray(central + 46, central + 46 + name.length)) || u32(0) !== 0x04034b50 ||
      u16(6) !== flags || u16(8) !== method || u16(26) !== name.length || !name.equals(b.subarray(30, 30 + name.length))) return bad();
    const from = 30 + name.length + localExtra, to = from + packed;
    if (to > central || (!descriptor && to !== central)) return bad();
    // Permit only non-path metadata extensions, never ZIP64, Unicode name
    // overrides or alternate entries. Their contents are not interpreted.
    for (const [first, last] of [[30 + name.length, from], [central + 46 + name.length, end]]) {
      for (let at = first; at < last;) {
        if (at + 4 > last || ![0x5455, 0x000a, 0x7875].includes(u16(at))) return bad();
        at += 4 + u16(at + 2);
        if (at > last) return bad();
      }
    }
    if ([[u32(14), crc], [u32(18), packed], [u32(22), plain]].some(([local, expected]) => local !== expected && (!descriptor || local !== 0))) return bad();
    if (descriptor) {
      const size = central - to, at = size === 16 && u32(to) === 0x08074b50 ? to + 4 : to;
      if (at + 12 !== central || u32(at) !== crc || u32(at + 4) !== packed || u32(at + 8) !== plain) return bad();
    }
    const compressed = b.subarray(from, to);
    if (method === 0 && packed !== plain) return bad();
    let body: Buffer = compressed;
    if (method === 8) {
      const result = inflateRawSync(compressed, { maxOutputLength: plain, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      if (result.engine.bytesWritten !== packed) return bad();
      body = result.buffer;
    }
    if (body.byteLength !== plain || crc32(body) !== crc) return bad();
    return body;
  } catch { return bad(); }
}
