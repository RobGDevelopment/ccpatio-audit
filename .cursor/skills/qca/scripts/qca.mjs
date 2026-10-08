import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const AAR_PATH = '.cursor/aar.json';
const EMIT_SCRIPT = '.cursor/skills/aar/scripts/emit.mjs';

let emitError = null;
try {
  execFileSync(process.execPath, [EMIT_SCRIPT], {
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 10 * 1024 * 1024
  });
} catch (err) {
  emitError = (err.stderr || err.message || 'emit.mjs failed').toString().trim();
}

const lockPath = '.cursor/phase.lock';
let lock = null;
let lockError = null;

if (!fs.existsSync(lockPath)) {
  lockError = 'phase.lock missing. No manual audit mode.';
} else {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      lockError = 'phase.lock is not a JSON object. No manual audit mode.';
    } else {
      lock = parsed;
    }
  } catch (err) {
    lockError = `phase.lock unreadable. No manual audit mode. ${err.message}`;
  }
}

const phaseId =
  lock && typeof lock.phase_id === 'string' && lock.phase_id.trim() ? lock.phase_id.trim() : null;

const report = {
  phase_id: phaseId || 'ABSENT',
  phase: phaseId || 'ABSENT',
  verdict: 'CERTIFIED',
  audit_exit: 0,
  invariantViolations: [],
  testResults: {}
};

function reject(message) {
  report.verdict = 'DEFECT_REJECTED';
  report.audit_exit = 2;
  report.invariantViolations.push(message);
}

if (emitError) reject(`AAR emitter failed: ${emitError}`);

if (lockError) reject(lockError);
if (phaseId === 'manual') reject('phase_id "manual" is not an audit mode.');

function runCheck(name, cmd) {
  try {
    execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });
    report.testResults[name] = 'PASS';
  } catch (err) {
    report.testResults[name] = 'FAIL';
    reject(`${name} failed: ${err.message}`);
  }
}

function numeric(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function blastFrom(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return numeric(obj.expected_blast_radius) ?? numeric(obj.blast_radius);
}

function inScope(file, allowed) {
  const norm = file.replace(/\\/g, '/');
  return allowed.some((entry) => {
    const a = String(entry).replace(/\\/g, '/').replace(/^\.\//, '');
    return norm === a || norm.startsWith(a.endsWith('/') ? a : `${a}/`);
  });
}

function isGatewayPath(file) {
  const norm = file.replace(/\\/g, '/');
  return norm.includes('api/') || norm.includes('checkout/');
}

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
}

function norm(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
}

function isGeneratedAar(filePath) {
  return norm(filePath) === AAR_PATH;
}

function canonicalKey(file) {
  return file.old_path ? `${file.status}\t${file.old_path}\t${file.path}` : `${file.status}\t${file.path}`;
}

function hashFileList(files) {
  const lines = files.map((file) => canonicalKey(file)).sort();
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
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

function loadAar() {
  try {
    const parsed = JSON.parse(fs.readFileSync(AAR_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'aar.json is not a JSON object.' };
    }
    return { aar: parsed };
  } catch (err) {
    return { error: `aar.json unreadable: ${err.message}` };
  }
}

function loadScripts() {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  } catch (err) {
    reject(`package.json unreadable: ${err.message}`);
    return {};
  }
  if (!pkg.scripts || typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts)) {
    reject('package.json scripts field missing.');
    return {};
  }
  return pkg.scripts;
}

function scriptMissing(scripts, name) {
  return !Object.prototype.hasOwnProperty.call(scripts, name) || String(scripts[name]).trim() === '';
}

function npmScriptName(cmd) {
  const match = String(cmd).match(/^npm(?:\.cmd)?\s+run\s+([^\s]+)/);
  return match ? match[1] : null;
}

const TO_FIXED_NOT_2 = /\.toFixed\((?!\s*2\s*\))/;
const scripts = loadScripts();

for (const name of ['typecheck', 'lint']) {
  if (scriptMissing(scripts, name)) {
    report.testResults[name] = 'FAIL';
    reject(`${name} script missing from package.json.`);
  } else {
    runCheck(name, `npm run ${name}`);
  }
}

const mode = lock && typeof lock.mode === 'string' && lock.mode.trim() ? lock.mode.trim() : 'edit';
const isEditPhase = mode !== 'certify';
const allowed = lock && Array.isArray(lock.allowed_files) ? lock.allowed_files : [];

if (lock && isEditPhase && allowed.length === 0) {
  reject('Empty allowed_files on edit phase.');
}

const targetTest = lock && typeof lock.target_test === 'string' ? lock.target_test.trim() : '';
if (!targetTest) {
  report.targetTest = null;
  report.testResults.target_test = 'FAIL';
  reject('target_test field missing from phase.lock.');
} else {
  report.targetTest = targetTest;
  const scriptName = npmScriptName(targetTest);
  if (scriptName && scriptMissing(scripts, scriptName)) {
    report.testResults.target_test = 'FAIL';
    reject(`target_test script missing from package.json: ${scriptName}.`);
  } else {
    runCheck('target_test', targetTest);
  }
}

const baseRef =
  lock && typeof lock.base_ref === 'string' && lock.base_ref.trim() ? lock.base_ref.trim() : 'HEAD~1';
const expected = blastFrom(lock);

try {
  const snapshot = collectAuditFiles(baseRef);
  const untrackedSet = new Set(snapshot.untracked);
  const changedFiles = [
    ...new Set(snapshot.files.flatMap((file) => (file.old_path ? [file.old_path, file.path] : [file.path])))
  ];
  const blastActual = snapshot.files.length;
  const blastFail = expected === null || blastActual !== expected;

  report.blastRadius = {
    actual: blastActual,
    expected,
    tolerance: 0,
    tracked: snapshot.files.filter((file) => file.status !== '??').length,
    untracked: snapshot.untracked.length,
    status: blastFail ? 'FAIL' : 'PASS'
  };

  if (expected === null) {
    reject('expected_blast_radius missing from phase.lock.');
  } else if (blastActual !== expected) {
    reject(`Blast Radius Breach: diff touches ${blastActual} files; expected ${expected}; tolerance 0.`);
  }

  const loaded = loadAar();
  if (loaded.error) {
    const gitHash = hashFileList(snapshot.files);
    report.aarParity = { status: 'FAIL', aar_sha256: hashFileList([]), git_sha256: gitHash };
    reject(loaded.error);
  } else {
    const aar = loaded.aar;
    const aarFiles = Array.isArray(aar.files) ? aar.files : [];
    const gitHash = hashFileList(snapshot.files);
    const aarHash = hashFileList(aarFiles);
    const parity = gitHash === aarHash;
    report.aarParity = {
      status: parity ? 'PASS' : 'FAIL',
      aar_sha256: aarHash,
      git_sha256: gitHash
    };
    if (!parity) {
      reject('AAR file list parity breach: generated file list does not match git diff.');
    }
    if (aar.file_list_sha256 !== aarHash) {
      reject('AAR file_list_sha256 does not match the generated file list.');
    }
    const listedUntracked = Array.isArray(aar.untracked) ? [...aar.untracked].sort() : [];
    const gitUntracked = [...snapshot.untracked].sort();
    if (listedUntracked.join('\n') !== gitUntracked.join('\n')) {
      reject('AAR untracked list does not match git ls-files --others --exclude-standard.');
    }
    const insertions = snapshot.files.reduce((sum, file) => sum + file.insertions, 0);
    const deletions = snapshot.files.reduce((sum, file) => sum + file.deletions, 0);
    if (!aar.counts || aar.counts.insertions !== insertions || aar.counts.deletions !== deletions) {
      reject('AAR insertion and deletion counts do not match git diff --numstat.');
    }
    if (!aar.counts || aar.counts.files !== aarFiles.length || aar.blast_radius !== aarFiles.length) {
      reject('AAR blast_radius does not match the generated file list.');
    }
    if (expected !== null && aar.blast_radius !== expected) {
      reject(
        `AAR blast radius ${aar.blast_radius} disagrees with phase.lock expected_blast_radius ${expected}. Lock wins.`
      );
    }
  }

  for (const file of changedFiles) {
    if (allowed.length > 0 && !inScope(file, allowed)) {
      reject(`Scope Breach: ${file} modified outside allowed phase scope.`);
    }

    if (isGatewayPath(file)) {
      let added = '';
      if (untrackedSet.has(file)) {
        added = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      } else {
        try {
          const patch = execFileSync('git', ['diff', '-U0', baseRef, '--', file], {
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024
          });
          added = patch
            .split('\n')
            .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
            .join('\n');
        } catch (err) {
          reject(`Diff Format Check Error: ${file}: ${err.message}`);
          continue;
        }
      }
      if (TO_FIXED_NOT_2.test(added)) {
        reject(`Format Breach: ${file} diff uses .toFixed() other than .toFixed(2).`);
      }
    }

    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('usePathname') && !content.includes('Suspense') && !file.includes('Suspense')) {
        reject(`Prerender Breach: ${file} reads usePathname() without Suspense.`);
      }
      if (
        file.startsWith('components/mobile/') &&
        file.endsWith('.tsx') &&
        content.includes('<button') &&
        !content.includes('touchTarget')
      ) {
        reject(`Tactile Breach: ${file} <button> missing 44px touchTarget.`);
      }
    }
  }
} catch (err) {
  reject(`Git Diff Error: ${err.message}`);
  if (!report.blastRadius) {
    report.blastRadius = {
      actual: null,
      expected,
      tolerance: 0,
      status: 'FAIL'
    };
  }
}

if (report.phase === 'ABSENT' || report.phase === 'manual' || report.phase_id === 'manual') {
  report.verdict = 'DEFECT_REJECTED';
}
report.phase_id = report.phase;
report.audit_exit = report.verdict === 'CERTIFIED' ? 0 : 2;

console.log(JSON.stringify(report, null, 2));
process.exit(report.audit_exit);
