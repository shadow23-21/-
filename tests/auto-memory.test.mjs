import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractAutoMemories,
  memoryExists,
} from '../web/src/lib/auto-memory.js';

test('extracts high-signal facts without an LLM', () => {
  const memories = extractAutoMemories(
    '我叫林晚，我最喜欢下雨天，我们约定周末去看海，第一次见你是在医院走廊。',
  );
  assert.ok(memories.some((memory) => memory.kind === '设定' && memory.text === '林晚'));
  assert.ok(memories.some((memory) => memory.kind === '喜好' && memory.text === '下雨天'));
  assert.ok(memories.some((memory) => memory.kind === '约定' && memory.text === '周末去看海'));
  assert.ok(memories.some((memory) => memory.kind === '事件'));
});

test('ignores tiny fragments like 我喜欢你', () => {
  const memories = extractAutoMemories('我喜欢你。');
  assert.equal(memories.length, 0);
});

test('memoryExists catches duplicates and containment', () => {
  const existing = [{ text: '周末去看海' }];
  assert.equal(memoryExists(existing, { text: '周末去看海' }), true);
  assert.equal(memoryExists(existing, { text: '去看海' }), true);
  assert.equal(memoryExists(existing, { text: '去看山' }), false);
});
