import fs from 'node:fs';
import path from 'node:path';
import { readStdin } from './read-stdin.mjs';

function emit(payload) {
  fs.writeSync(1, `${JSON.stringify(payload)}\n`);
}

function inScope(file, allowed) {
  const norm = file.replace(/\\/g, '/');
  return allowed.some((entry) => {
    const a = String(entry).replace(/\\/g, '/').replace(/^\.\//, '');
    return norm === a || norm.startsWith(a.endsWith('/') ? a : `${a}/`);
  });
}

function extractAtFiles(text) {
  const tags = [];
  const re = /(^|[\s"'`(])@([^\s"'`()<>|,;]+)/g;
  let match;
  while ((match = re.exec(String(text))) !== null) {
    const token = match[2].replace(/[.,:;]+$/, '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!token) continue;
    if (token.includes('/') || /\.[A-Za-z][A-Za-z0-9]{0,15}$/.test(token)) tags.push(token);
  }
  return tags;
}

function messageText(entry) {
  const message = entry.message || entry;
  const content = message.content ?? entry.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (part.type === 'file' && typeof part.file_path === 'string') return `@${part.file_path}`;
      return '';
    })
    .join('\n');
}

function latestUserText(transcriptPath) {
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return '';
  }
  let latest = '';
  for (const line of raw.split(/\n/)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const role = entry.role || entry.type;
    if (role !== 'user') continue;
    latest = messageText(entry);
  }
  return latest;
}

function promptContext(input) {
  const chunks = [];
  if (typeof input.prompt === 'string') chunks.push(input.prompt);
  if (typeof input.user_prompt === 'string') chunks.push(input.user_prompt);
  if (Array.isArray(input.attachments)) {
    for (const att of input.attachments) {
      if (att && att.type === 'file' && typeof att.file_path === 'string') chunks.push(`@${att.file_path}`);
    }
  }
  if (typeof input.transcript_path === 'string' && input.transcript_path) {
    chunks.push(latestUserText(input.transcript_path));
  }
  return chunks.join('\n');
}

function matchesTag(file, tags) {
  const norm = file.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  return tags.some((tag) => {
    const a = tag.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    if (norm === a || norm.endsWith(`/${a}`)) return true;
    if (a.endsWith('/')) return norm.startsWith(a) || norm === a.slice(0, -1);
    return false;
  });
}

function relFile(raw) {
  const cwd = process.cwd().replace(/\\/g, '/');
  let file = path.resolve(String(raw)).replace(/\\/g, '/');
  if (file.toLowerCase().startsWith(`${cwd.toLowerCase()}/`)) file = file.slice(cwd.length + 1);
  return file;
}

function targetPath(input) {
  const tool = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  return tool.path || tool.file_path || tool.target_file || tool.filePath || '';
}

const input = readStdin();
const lockPath = '.cursor/phase.lock';

if (input.__parse_error) {
  emit({ permission: 'deny', agent_message: 'preToolUse stdin was not valid JSON.' });
  process.exit(0);
}

if (!fs.existsSync(lockPath)) {
  const tags = extractAtFiles(promptContext(input));
  if (tags.length === 0) {
    emit({
      permission: 'deny',
      agent_message: 'Track 1: no @-tagged files in the prompt. Write, StrReplace, and Delete are denied.'
    });
    process.exit(0);
  }
  const raw = targetPath(input);
  if (!raw) {
    emit({ permission: 'deny', agent_message: 'No target file path on stdin.' });
    process.exit(0);
  }
  if (!matchesTag(relFile(raw), tags)) {
    emit({ permission: 'deny', agent_message: 'Track 1: path is not an @-tagged file.' });
    process.exit(0);
  }
  emit({ permission: 'allow' });
  process.exit(0);
}

let lock;
try {
  lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
} catch {
  emit({ permission: 'deny', agent_message: 'phase.lock is unreadable.' });
  process.exit(0);
}

const allowed = lock && Array.isArray(lock.allowed_files) ? lock.allowed_files : [];
const raw = targetPath(input);
if (!raw) {
  emit({ permission: 'deny', agent_message: 'No target file path on stdin.' });
  process.exit(0);
}

const file = relFile(raw);
if (!inScope(file, allowed)) {
  emit({ permission: 'deny', agent_message: 'File outside phase.lock allowed_files.' });
  process.exit(0);
}

emit({ permission: 'allow' });
process.exit(0);
