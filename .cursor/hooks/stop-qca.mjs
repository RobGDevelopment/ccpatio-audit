import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { readStdin } from './read-stdin.mjs';

readStdin();

const result = spawnSync(process.execPath, ['.cursor/skills/qca/scripts/qca.mjs'], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024
});

fs.mkdirSync('.cursor/logs', { recursive: true });
fs.writeFileSync(
  '.cursor/logs/qca-last.log',
  [
    `status=${result.status}`,
    '--- stdout ---',
    result.stdout || '',
    '--- stderr ---',
    result.stderr || '',
    result.error ? `--- error ---\n${result.error.message}` : ''
  ].join('\n')
);

const auditExit = result.status === 0 ? 0 : 2;
const transcript = (result.stdout || '').trim();
const instruction =
  auditExit === 0
    ? 'Transcribe the following JSON verbatim. Do not restate the verdict in other words.'
    : 'audit_exit is 2. DEFECT_REJECTED. Transcribe the following JSON verbatim. Do not rename exit 2 to CERTIFIED or summarize this failure as a success.';
const body = transcript || (result.stderr || result.error?.message || 'qca.mjs produced no JSON.').trim();

const payload = {
  audit_exit: auditExit,
  followup_message: `${instruction}\n${body}`
};

fs.writeSync(1, `${JSON.stringify(payload)}\n`);
process.exit(0);
