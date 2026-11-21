import fs from 'node:fs';
import path from 'node:path';

const source = process.argv[2] ?? 'out/official-demo4';
const target = process.argv[3] ?? 'web/public/demo-data.json';

const bible = JSON.parse(
  fs.readFileSync(path.join(source, 'story-bible.json'), 'utf8'),
);
const events = fs
  .readFileSync(path.join(source, 'events.jsonl'), 'utf8')
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const payload = {
  ...bible,
  events: events.map((event) => ({
    id: event.id,
    role: event.role,
    speaker: event.speaker ?? null,
    text: event.text,
    thinking: event.thinking ?? null,
    createdAt: event.createdAt,
    selected: event.selected !== false,
  })),
};

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log('wrote', target, payload.events.length, 'events');
