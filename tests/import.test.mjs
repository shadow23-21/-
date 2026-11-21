import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { detectFormat, importChat } from '../src/import/index.mjs';

const read = (name) => fs.readFileSync(path.join('fixtures', name), 'utf8');
const loadJson = (name) => JSON.parse(read(name));

const cases = [
  {
    format: 'deepseek-official',
    file: 'deepseek-official.json',
    input: () => loadJson('deepseek-official.json'),
    all: 241,
    selected: 240,
  },
  {
    format: 'deepseek-tree',
    file: 'deepseek-tree.json',
    input: () => loadJson('deepseek-tree.json'),
    all: 241,
    selected: 240,
  },
  {
    format: 'chatgpt',
    file: 'chatgpt-conversations.json',
    input: () => loadJson('chatgpt-conversations.json'),
    all: 241,
    selected: 240,
  },
  {
    format: 'sillytavern',
    file: 'sillytavern-chat.jsonl',
    input: () => read('sillytavern-chat.jsonl'),
    all: 240,
    selected: 240,
  },
  {
    format: 'plaintext',
    file: 'plain-text.md',
    input: () => read('plain-text.md'),
    all: 240,
    selected: 240,
  },
];

test('detects every fixture format', () => {
  for (const item of cases) {
    assert.equal(detectFormat(item.input()), item.format, item.file);
  }
  assert.equal(
    detectFormat(JSON.stringify(loadJson('deepseek-official.json'))),
    'deepseek-official',
  );
});

for (const item of cases) {
  test(`${item.format} imports ${item.selected} selected messages`, () => {
    const result = importChat(item.input());
    assert.equal(result.format, item.format);
    assert.equal(result.events.length, item.all);
    assert.equal(result.selected.length, item.selected);

    const ids = new Set(result.events.map((event) => event.id));
    assert.equal(ids.size, result.events.length, 'ids must be unique');

    for (const event of result.selected) {
      assert.ok(event.text.length > 0, `empty text: ${event.id}`);
      assert.ok(event.createdAt.endsWith('Z'), `bad timestamp: ${event.id}`);
      assert.ok(['user', 'assistant', 'system', 'narrator'].includes(event.role));
    }

    for (let index = 1; index < result.selected.length; index += 1) {
      assert.equal(
        result.selected[index].parentId,
        result.selected[index - 1].id,
        `broken parent chain at ${index}`,
      );
    }
  });
}

test('branch alternate is archived, not selected', () => {
  for (const item of cases.filter((entry) => entry.format !== 'sillytavern' && entry.format !== 'plaintext')) {
    const result = importChat(item.input());
    const alternate = result.events.find((event) => event.id === 'm0241b');
    assert.ok(alternate, `${item.format}: alternate missing`);
    assert.equal(alternate.selected, false, `${item.format}: alternate selected`);
    assert.match(alternate.text, /另一版/);
  }
});

test('chatgpt follows current_node', () => {
  const result = importChat(loadJson('chatgpt-conversations.json'));
  assert.equal(result.selected.at(-1).id, 'm0240');
});

test('plain text keeps speakers', () => {
  const result = importChat(read('plain-text.md'));
  assert.equal(result.selected[0].speaker, '林晚');
  assert.equal(result.selected[0].role, 'user');
  assert.equal(result.selected[1].speaker, '沈砚');
  assert.equal(result.selected[1].role, 'assistant');
});
