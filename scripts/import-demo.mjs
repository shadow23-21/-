import fs from 'node:fs';
import path from 'node:path';

import { importChat } from '../src/import/index.mjs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/import-demo.mjs <file> [out.jsonl]');
  process.exit(1);
}

const raw = fs.readFileSync(file, 'utf8');
let input;
try {
  input = JSON.parse(raw);
} catch {
  input = raw;
}

const result = importChat(input);
const dates = result.selected.map((event) => event.createdAt).sort();
const characters = result.selected.reduce((sum, event) => sum + event.text.length, 0);
const speakers = [...new Set(result.selected.map((event) => event.speaker).filter(Boolean))];

const summary = {
  file,
  format: result.format,
  messages: result.events.length,
  selected: result.selected.length,
  archivedBranches: result.events.length - result.selected.length,
  speakers,
  firstAt: dates[0],
  lastAt: dates[dates.length - 1],
  characters,
  avgChars: Math.round(characters / Math.max(1, result.selected.length)),
  thinkingMessages: result.events.filter((event) => event.thinking).length,
};

console.log(JSON.stringify(summary, null, 2));

const out =
  process.argv[3] ??
  path.join('fixtures/private', `${path.basename(file)}.normalized.jsonl`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  `${result.selected.map((event) => JSON.stringify(event)).join('\n')}\n`,
  'utf8',
);
console.log('wrote', out);
