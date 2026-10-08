import fs from 'node:fs';

export function readStdin() {
  let buf;
  try {
    buf = fs.readFileSync(0);
  } catch {
    return {};
  }
  if (!buf || buf.length === 0) return {};

  const utf8 = buf.toString('utf8').replace(/^\uFEFF/, '');
  const candidates = utf8.includes('\u0000')
    ? [buf.toString('utf16le').replace(/^\uFEFF/, ''), utf8]
    : [utf8];

  for (const text of candidates) {
    try {
      return JSON.parse(text);
    } catch {
      // try the next encoding
    }
  }
  return { __parse_error: true };
}
