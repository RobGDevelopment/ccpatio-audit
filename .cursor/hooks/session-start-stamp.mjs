import crypto from 'node:crypto';
import fs from 'node:fs';
import { readStdin } from './read-stdin.mjs';

const input = readStdin();
const source = 'PROJECT_STATE.md';
const body = fs.existsSync(source) ? fs.readFileSync(source) : Buffer.alloc(0);
const stamp = {
  source,
  present: fs.existsSync(source),
  algorithm: 'sha256',
  hash: crypto.createHash('sha256').update(body).digest('hex'),
  session_id: input.session_id || null,
  stamped_at: new Date().toISOString()
};

fs.writeFileSync('.cursor/session-stamp.json', `${JSON.stringify(stamp, null, 2)}\n`);
fs.writeSync(1, '{}\n');
process.exit(0);
