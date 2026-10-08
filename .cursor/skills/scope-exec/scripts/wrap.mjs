import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Matcher limit: git checkout pathspecs, git clean, and output redirects only.
// Other mutations are passed through. See .cursor/protocol/TRACKS.md.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const lockPath = path.join(repoRoot, '.cursor', 'phase.lock');

function breach(message) {
  process.stderr.write(`scope breach: ${message}\n`);
  process.exit(2);
}

function inScope(file, allowed) {
  const norm = file.replace(/\\/g, '/').replace(/^\.\//, '');
  return allowed.some((entry) => {
    const a = String(entry).replace(/\\/g, '/').replace(/^\.\//, '');
    return norm === a || norm.startsWith(a.endsWith('/') ? a : `${a}/`);
  });
}

function toRel(rawPath) {
  const trimmed = String(rawPath).replace(/^['"]|['"]$/g, '');
  const abs = path.resolve(repoRoot, trimmed).replace(/\\/g, '/');
  const root = repoRoot.replace(/\\/g, '/');
  if (abs.toLowerCase() === root.toLowerCase()) return '.';
  if (abs.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return abs.slice(root.length + 1);
  return abs;
}

function tokenize(command) {
  const tokens = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) tokens.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function splitSegments(command) {
  const segments = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    const next = command[i + 1];
    if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      segments.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    if (ch === '|' || ch === ';') {
      segments.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) segments.push(cur);
  return segments;
}

function isGit(token) {
  return /^git(\.exe)?$/i.test(token);
}

function parseGit(tokens) {
  if (!tokens.length || !isGit(tokens[0])) return null;
  let i = 1;
  const withValue = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === '--') return null;
    if (token.startsWith('-')) {
      if (withValue.has(token)) i += 2;
      else i += 1;
      continue;
    }
    return { sub: token, rest: tokens.slice(i + 1) };
  }
  return null;
}

function checkoutPaths(rest) {
  const paths = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--') {
      paths.push(...rest.slice(i + 1));
      break;
    }
    if (['-b', '-B', '--orphan', '-m', '--conflict', '--pathspec-from-file'].includes(token)) {
      i += 1;
      continue;
    }
    if (token.startsWith('-')) continue;
    if (token.includes('/') || token.includes('\\') || token.includes('.')) paths.push(token);
  }
  return paths;
}

function cleanPaths(rest) {
  const paths = [];
  let afterDash = false;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--') {
      afterDash = true;
      continue;
    }
    if (!afterDash && (token === '-e' || token === '--exclude')) {
      i += 1;
      continue;
    }
    if (!afterDash && token.startsWith('-')) continue;
    paths.push(token);
  }
  return paths;
}

function extractRedirects(command) {
  const paths = [];
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch !== '>') continue;
    const prev = command[i - 1];
    if (prev && !/[\s\d&]/.test(prev)) continue;
    if (command[i + 1] === '=') continue;
    let j = i + 1;
    while (command[j] === '>') j += 1;
    while (j < command.length && /\s/.test(command[j])) j += 1;
    if (command[j] === '&') {
      i = j;
      continue;
    }
    let target = '';
    if (command[j] === '"' || command[j] === "'") {
      const q = command[j];
      j += 1;
      while (j < command.length && command[j] !== q) {
        target += command[j];
        j += 1;
      }
    } else {
      while (j < command.length && !/[\s|&;]/.test(command[j])) {
        target += command[j];
        j += 1;
      }
    }
    if (!target) breach('output redirect is missing a path');
    paths.push(target);
    i = j;
  }
  return paths;
}

function mutationReport(command) {
  const redirects = extractRedirects(command);
  const checkout = [];
  let cleanWholeTree = false;
  const clean = [];

  for (const segment of splitSegments(command)) {
    const git = parseGit(tokenize(segment));
    if (!git) continue;
    if (git.sub === 'checkout') checkout.push(...checkoutPaths(git.rest));
    if (git.sub === 'clean') {
      const paths = cleanPaths(git.rest);
      if (paths.length === 0) cleanWholeTree = true;
      else clean.push(...paths);
    }
  }

  return { redirects, checkout, clean, cleanWholeTree };
}

function readLock() {
  if (!fs.existsSync(lockPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      breach('phase.lock is not a JSON object.');
    }
    return parsed;
  } catch (err) {
    breach(`phase.lock is unreadable. ${err.message}`);
  }
  return null;
}

function outside(paths, allowed) {
  return paths.map(toRel).filter((file) => !inScope(file, allowed));
}

const command = process.argv
  .slice(2)
  .filter((arg, index) => !(index === 0 && arg === '--'))
  .join(' ')
  .trim();

if (!command) {
  process.stderr.write('usage: node .cursor/skills/scope-exec/scripts/wrap.mjs -- <command>\n');
  process.exit(2);
}

const lock = readLock();
if (lock) {
  const allowed = Array.isArray(lock.allowed_files) ? lock.allowed_files : [];
  const report = mutationReport(command);
  if (report.cleanWholeTree) {
    breach('git clean without paths is a worktree-wide mutation.');
  }
  const denied = [
    ...outside(report.checkout, allowed),
    ...outside(report.clean, allowed),
    ...outside(report.redirects, allowed)
  ];
  if (denied.length > 0) {
    for (const file of denied) breach(`path not in phase.lock allowed_files: ${file}`);
  }
}

const child = spawnSync(command, {
  cwd: repoRoot,
  shell: true,
  stdio: 'inherit',
  windowsHide: true
});

if (child.error) {
  process.stderr.write(`scope-exec: ${child.error.message}\n`);
  process.exit(1);
}

process.exit(child.status === null ? 1 : child.status);
