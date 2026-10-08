import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCK_PATH = '.cursor/phase.lock';
const AAR_PATH = '.cursor/aar.json';

function norm(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
}

function isGeneratedAar(filePath) {
  return norm(filePath) === AAR_PATH;
}

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
}

function canonicalKey(file) {
  return file.old_path ? `${file.status}\t${file.old_path}\t${file.path}` : `${file.status}\t${file.path}`;
}

function hashFileList(files) {
  const lines = files.map((file) => canonicalKey(file)).sort();
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

function readLock() {
  if (!fs.existsSync(LOCK_PATH)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function resolveRef(lock) {
  const phaseId =
    lock && typeof lock.phase_id === 'string' && lock.phase_id.trim() ? lock.phase_id.trim() : 'ABSENT';
  const baseRef =
    lock && typeof lock.base_ref === 'string' && lock.base_ref.trim() ? lock.base_ref.trim() : 'HEAD~1';
  return { phaseId, baseRef };
}

function parseNameStatus(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const status = parts[0];
    if (parts.length >= 3) {
      const oldPath = norm(parts[1]);
      const filePath = norm(parts.slice(2).join('\t'));
      if (isGeneratedAar(oldPath) || isGeneratedAar(filePath)) continue;
      entries.push({ status, old_path: oldPath, path: filePath });
      continue;
    }
    const filePath = norm(parts[1]);
    if (isGeneratedAar(filePath)) continue;
    entries.push({ status, path: filePath });
  }
  return entries;
}

function destinationPath(filePath) {
  const marker = ' => ';
  if (!filePath.includes(marker)) return norm(filePath);
  const brace = filePath.match(/^(.*)\{.* => (.*)\}(.*)$/);
  if (brace) return norm(`${brace[1]}${brace[2]}${brace[3]}`);
  return norm(filePath.slice(filePath.lastIndexOf(marker) + marker.length));
}

function parseNumstat(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const insertions = parts[0] === '-' ? 0 : Number(parts[0]);
    const deletions = parts[1] === '-' ? 0 : Number(parts[1]);
    const filePath = destinationPath(parts.slice(2).join('\t'));
    if (isGeneratedAar(filePath)) continue;
    map.set(filePath, {
      insertions: Number.isFinite(insertions) ? insertions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0
    });
  }
  return map;
}

function parseUntracked(text) {
  return text
    .split('\n')
    .map((line) => norm(line.trim()))
    .filter((filePath) => filePath && !isGeneratedAar(filePath));
}

function collectAuditFiles(baseRef) {
  const tracked = parseNameStatus(git(['diff', '--name-status', baseRef]));
  const stats = parseNumstat(git(['diff', '--numstat', baseRef]));
  const untracked = parseUntracked(git(['ls-files', '--others', '--exclude-standard']));
  const files = tracked.map((entry) => {
    const stat = stats.get(entry.path) || { insertions: 0, deletions: 0 };
    return {
      status: entry.status,
      path: entry.path,
      ...(entry.old_path ? { old_path: entry.old_path } : {}),
      insertions: stat.insertions,
      deletions: stat.deletions
    };
  });
  for (const filePath of untracked) {
    files.push({ status: '??', path: filePath, insertions: 0, deletions: 0 });
  }
  files.sort((a, b) => (canonicalKey(a) < canonicalKey(b) ? -1 : canonicalKey(a) > canonicalKey(b) ? 1 : 0));
  untracked.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { files, untracked };
}

function readPreservedNotes() {
  if (!fs.existsSync(AAR_PATH)) return '';
  try {
    const prev = JSON.parse(fs.readFileSync(AAR_PATH, 'utf8'));
    return prev && typeof prev.notes === 'string' ? prev.notes : '';
  } catch {
    return '';
  }
}

function buildAar() {
  const { phaseId, baseRef } = resolveRef(readLock());
  const { files, untracked } = collectAuditFiles(baseRef);
  const tracked = files.filter((file) => file.status !== '??').length;
  const insertions = files.reduce((sum, file) => sum + file.insertions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return {
    phase_id: phaseId,
    base_ref: baseRef,
    blast_radius: files.length,
    counts: {
      files: files.length,
      tracked,
      untracked: untracked.length,
      insertions,
      deletions
    },
    files,
    untracked,
    file_list_sha256: hashFileList(files),
    notes: readPreservedNotes()
  };
}

function emit() {
  const doc = buildAar();
  fs.mkdirSync(path.dirname(AAR_PATH), { recursive: true });
  fs.writeFileSync(AAR_PATH, `${JSON.stringify(doc, null, 2)}\n`);
  return doc;
}

const self = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked && path.normalize(invoked).toLowerCase() === path.normalize(self).toLowerCase()) {
  emit();
}
