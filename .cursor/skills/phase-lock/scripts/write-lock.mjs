import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const schemaPath = path.join(repoRoot, '.cursor', 'protocol', 'PHASE_PACKET.schema.json');
const lockPath = path.join(repoRoot, '.cursor', 'phase.lock');
const BLAST_CAP = 8;

const META_KEYS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'default']);
const SUPPORTED_KEYS = new Set([
  'type',
  'additionalProperties',
  'required',
  'properties',
  'minLength',
  'minimum',
  'maximum',
  'enum',
  'items',
  'not',
  'const',
  'description'
]);

function die(errors) {
  const list = Array.isArray(errors) ? errors : [errors];
  for (const error of list) {
    process.stderr.write(`phase-lock: ${error}\n`);
  }
  process.exit(1);
}

function readPayload() {
  const arg = process.argv[2];
  try {
    if (!arg || arg === '-') return JSON.parse(fs.readFileSync(0, 'utf8'));
    if (arg.trim().startsWith('{')) return JSON.parse(arg);
    return JSON.parse(fs.readFileSync(arg, 'utf8'));
  } catch (err) {
    die(`payload is not valid JSON. ${err.message}`);
  }
  return null;
}

function assertSupported(schema, at) {
  for (const key of Object.keys(schema)) {
    if (META_KEYS.has(key) || SUPPORTED_KEYS.has(key)) continue;
    die(`schema keyword "${key}" at ${at} is not implemented. Refusing to validate.`);
  }
}

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function validate(schema, value, at) {
  assertSupported(schema, at);
  const errors = [];

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) {
    errors.push(`${at} must be ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const ok = types.some((expected) => {
      if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
      return actual === expected;
    });
    if (!ok) errors.push(`${at} must be ${types.join(' or ')}`);
  }

  if (typeof schema.minLength === 'number' && typeof value === 'string' && value.length < schema.minLength) {
    errors.push(`${at} must be at least ${schema.minLength} character(s)`);
  }

  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    errors.push(`${at} must be >= ${schema.minimum}`);
  }

  if (typeof schema.maximum === 'number' && typeof value === 'number' && value > schema.maximum) {
    errors.push(`${at} must be <= ${schema.maximum}`);
  }

  if (schema.not) {
    const forbidden = validate(schema.not, value, at);
    if (Object.prototype.hasOwnProperty.call(schema.not, 'const') && value === schema.not.const) {
      errors.push(`${at} must not be ${JSON.stringify(schema.not.const)}`);
    } else if (forbidden.length === 0) {
      errors.push(`${at} failed not`);
    }
  }

  if (schema.type === 'object' || schema.properties || schema.required || schema.additionalProperties === false) {
    if (typeOf(value) !== 'object') {
      if (!schema.type) errors.push(`${at} must be object`);
    } else {
      const props = schema.properties || {};
      if (Array.isArray(schema.required)) {
        for (const key of schema.required) {
          if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${at}.${key} is required`);
        }
      }
      for (const key of Object.keys(value)) {
        if (props[key]) {
          errors.push(...validate(props[key], value[key], `${at}.${key}`));
        } else if (schema.additionalProperties === false) {
          errors.push(`${at}.${key} is not allowed`);
        } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          errors.push(...validate(schema.additionalProperties, value[key], `${at}.${key}`));
        }
      }
    }
  }

  if (schema.items && Array.isArray(value)) {
    value.forEach((item, index) => {
      errors.push(...validate(schema.items, item, `${at}[${index}]`));
    });
  }

  return errors;
}

function worktreeDirty() {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    return out.trim().length > 0;
  } catch (err) {
    die(`git status --porcelain failed. ${err.message}`);
  }
  return true;
}

if (!fs.existsSync(schemaPath)) die(`schema missing: ${schemaPath}`);

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
} catch (err) {
  die(`schema is not valid JSON. ${err.message}`);
}

const payload = readPayload();
if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
  die('payload must be a JSON object');
}

const schemaErrors = validate(schema, payload, 'payload');
if (schemaErrors.length > 0) die(schemaErrors);

const mode = typeof payload.mode === 'string' && payload.mode.trim() ? payload.mode.trim() : 'edit';
if (mode !== 'certify' && payload.allowed_files.length === 0) {
  die('Empty allowed_files on edit phase.');
}

if (payload.allowed_files.length > BLAST_CAP && payload.override_blast_cap !== true) {
  die(
    `allowed_files has ${payload.allowed_files.length} entries. Cap is ${BLAST_CAP} unless override_blast_cap is true.`
  );
}

if (worktreeDirty() && payload.allow_dirty_base !== true) {
  die('worktree is dirty. Refusing to write .cursor/phase.lock unless allow_dirty_base is true.');
}

const tmpPath = `${lockPath}.tmp`;
fs.mkdirSync(path.dirname(lockPath), { recursive: true });
fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
fs.renameSync(tmpPath, lockPath);
process.stdout.write(`phase-lock: wrote ${path.relative(repoRoot, lockPath).replace(/\\/g, '/')}\n`);
