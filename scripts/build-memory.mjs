import fs from 'node:fs';
import path from 'node:path';

import { importChat } from '../src/import/index.mjs';
import {
  deterministicBible,
  extractStoryBible,
} from '../src/memory/extract.mjs';
import { renderPersonaMarkdown, renderReportMarkdown } from '../src/memory/render.mjs';
import { renderDemoHtml } from '../src/memory/render-html.mjs';
import { openDb } from '../src/store/db.mjs';
import { storeImport } from '../src/store/import-store.mjs';

const args = process.argv.slice(2);
const options = {};
let file = null;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    if (key === 'no-llm') {
      options.noLlm = true;
    } else {
      options[key] = args[index + 1];
      index += 1;
    }
  } else {
    file = arg;
  }
}

if (!file) {
  console.error(
    'Usage: node scripts/build-memory.mjs <file> [--out dir] [--title title] [--no-llm] [--provider deepseek|zhipu] [--model name]',
  );
  process.exit(1);
}

const slug = path
  .basename(file)
  .replace(/\.[^.]+$/, '')
  .replace(/[^a-zA-Z0-9_-]+/g, '-');
const outDir = options.out ?? path.join('out', slug || 'import');

const raw = fs.readFileSync(file, 'utf8');
let input;
try {
  input = JSON.parse(raw);
} catch {
  input = raw;
}

const result = importChat(input);
if (result.selected.length === 0) {
  console.error('No selected messages after import');
  process.exit(1);
}

const title = options.title ?? result.selected[0]?.title ?? '未命名故事';
fs.mkdirSync(outDir, { recursive: true });

const db = openDb(path.join(outDir, 'whale.db'));
const storeStats = storeImport(db, result, { title });

let bible;
try {
  bible = await extractStoryBible(result.selected, {
    title,
    envFile: '.env',
    provider: options.provider ?? 'deepseek',
    model: options.model,
    maxChars: Number(options['max-chars'] ?? 12000),
    noLlm: options.noLlm === true,
  });
} catch (error) {
  console.error('LLM extraction failed:', error.message);
  bible = deterministicBible(result.selected, { title });
  bible.meta = {
    source: 'deterministic-fallback',
    error: error.message,
    generatedAt: new Date().toISOString(),
  };
}

const conversationId = String(result.selected[0]?.conversationId ?? 'default');
db.prepare(
  `INSERT OR REPLACE INTO story_bible (conversation_id, version, json, created_at)
   VALUES (?, ?, ?, ?)`,
).run(conversationId, 1, JSON.stringify(bible), new Date().toISOString());

if (bible.persona.name && bible.persona.name !== '未知') {
  db.prepare(
    `INSERT OR REPLACE INTO characters (id, conversation_id, name, persona_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    `${conversationId}:${bible.persona.name}`,
    conversationId,
    bible.persona.name,
    JSON.stringify(bible.persona),
    new Date().toISOString(),
  );
}

const insertMemory = db.prepare(
  `INSERT OR REPLACE INTO memories (
     id, conversation_id, character_id, kind, text, importance,
     source_event_id, created_at
   ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
);
bible.memories.forEach((memory, index) => {
  insertMemory.run(
    `${conversationId}:mem:${index + 1}`,
    conversationId,
    null,
    memory.kind,
    memory.text,
    memory.importance,
    new Date().toISOString(),
  );
});

const stats = {
  format: result.format,
  events: result.events.length,
  selected: result.selected.length,
  archived: result.events.length - result.selected.length,
};

const files = [
  path.join(outDir, 'whale.db'),
  path.join(outDir, 'story-bible.json'),
  path.join(outDir, 'persona.md'),
  path.join(outDir, 'report.md'),
  path.join(outDir, 'events.jsonl'),
  path.join(outDir, 'index.html'),
];

fs.writeFileSync(
  path.join(outDir, 'story-bible.json'),
  `${JSON.stringify(bible, null, 2)}\n`,
  'utf8',
);
fs.writeFileSync(path.join(outDir, 'persona.md'), renderPersonaMarkdown(bible), 'utf8');
fs.writeFileSync(
  path.join(outDir, 'report.md'),
  renderReportMarkdown({
    bible,
    stats,
    files,
  }),
  'utf8',
);
fs.writeFileSync(
  path.join(outDir, 'events.jsonl'),
  `${result.selected.map((event) => JSON.stringify(event)).join('\n')}\n`,
  'utf8',
);
fs.writeFileSync(
  path.join(outDir, 'index.html'),
  renderDemoHtml({ bible, events: result.events, stats }),
  'utf8',
);

const stored = {
  ...storeStats,
  characters: db.prepare('SELECT COUNT(*) AS n FROM characters').get().n,
};

db.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      format: result.format,
      title,
      events: result.events.length,
      selected: result.selected.length,
      archived: result.events.length - result.selected.length,
      stored,
      persona: bible.persona.name,
      memories: bible.memories.length,
      timeline: bible.timeline.length,
      styleSamples: bible.style_samples.length,
      generation: bible.meta?.source ?? 'unknown',
      outDir,
    },
    null,
    2,
  ),
);
console.log(`\npersona: ${path.join(outDir, 'persona.md')}`);
console.log(`report:  ${path.join(outDir, 'report.md')}`);
console.log(`bible:   ${path.join(outDir, 'story-bible.json')}`);
console.log(`demo:    ${path.join(outDir, 'index.html')}`);
