/**
 * Best-effort SketchUp .skp embedded PNG thumbnail extractor.
 * Scans for PNG signature → IEND. Also checks ZIP-packaged modern .skp.
 */
import { inflateRawSync, inflateSync } from "node:zlib";

const PNG_SIG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const IEND = Buffer.from("IEND");
const ZIP_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function findPngInBuffer(buf: Buffer): Buffer | null {
  let from = 0;
  while (from < buf.length) {
    const start = buf.indexOf(PNG_SIG, from);
    if (start < 0) return null;
    let offset = start + 8;
    let foundEnd = -1;
    while (offset + 12 <= buf.length) {
      const length = buf.readUInt32BE(offset);
      const type = buf.subarray(offset + 4, offset + 8);
      const next = offset + 12 + length;
      if (next > buf.length) break;
      if (type.equals(IEND)) {
        foundEnd = next;
        break;
      }
      offset = next;
    }
    if (foundEnd > start) {
      return buf.subarray(start, foundEnd);
    }
    from = start + 1;
  }
  return null;
}

/** Try inflate ZIP local-file payloads looking for PNG (modern SKP). */
function scanZipPayloads(buf: Buffer): Buffer | null {
  if (!buf.subarray(0, 4).equals(ZIP_SIG) && buf.indexOf(ZIP_SIG) < 0) {
    return null;
  }
  let offset = 0;
  while (offset + 30 < buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > buf.length) break;
    const payload = buf.subarray(dataStart, dataEnd);
    try {
      const raw =
        method === 0
          ? payload
          : method === 8
            ? inflateRawSync(payload)
            : inflateSync(payload);
      const png = findPngInBuffer(raw);
      if (png && png.length > 200) return png;
    } catch {
      /* skip bad entry */
    }
    offset = dataEnd;
  }
  return null;
}

export function extractSkpThumbnail(buffer: Buffer): Buffer | null {
  if (!buffer?.length) return null;
  const direct = findPngInBuffer(buffer);
  if (direct && direct.length > 200) return direct;
  return scanZipPayloads(buffer);
}
