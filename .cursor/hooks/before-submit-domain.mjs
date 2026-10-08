import fs from 'node:fs';
import { readStdin } from './read-stdin.mjs';

function emit(payload) {
  fs.writeSync(1, `${JSON.stringify(payload)}\n`);
}

const input = readStdin();
const denyPath = '.cursor/foreign-domain.deny';

if (input.__parse_error || !fs.existsSync(denyPath)) {
  emit({ continue: true });
  process.exit(0);
}

const prompt = String(input.prompt || '');
const nouns = fs
  .readFileSync(denyPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const hit = nouns.find((noun) => prompt.toLowerCase().includes(noun.toLowerCase()));
if (hit) {
  emit({
    continue: false,
    user_message: `Blocked: prompt contains denied foreign-domain noun "${hit}".`
  });
  process.exit(0);
}

emit({ continue: true });
process.exit(0);
