import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMessages,
  chunkEvents,
  deterministicBible,
  mergeBibles,
  normalizeBible,
  parseJsonObject,
} from '../src/memory/extract.mjs';

test('parseJsonObject handles fences and surrounding text', () => {
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonObject('好的，结果是 {"a":2} 以上。'), { a: 2 });
});

test('normalizeBible cleans address terms and clamps importance', () => {
  const bible = normalizeBible({
    title: '测试',
    persona: { name: '沈砚', personality: ['克制'] },
    relationship: {
      stage: '暧昧',
      address_terms: { user: ['你', '沈砚'], character: ['她'] },
    },
    timeline: [{ when: '第1天', event: '下雨', importance: 2 }],
    memories: [{ kind: '约定', text: '去海边', importance: -1 }],
    style_samples: ['a', 'b'],
  });

  assert.equal(bible.persona.name, '沈砚');
  assert.deepEqual(bible.relationship.address_terms.user, ['你']);
  assert.deepEqual(bible.relationship.address_terms.character, ['沈砚']);
  assert.equal(bible.timeline[0].importance, 1);
  assert.equal(bible.memories[0].importance, 0);
});

test('chunkEvents keeps every event and respects the budget', () => {
  const events = Array.from({ length: 20 }, (_, index) => ({
    text: 'x'.repeat(10),
    role: index % 2 === 0 ? 'user' : 'assistant',
  }));
  const chunks = chunkEvents(events, 35);
  assert.equal(chunks.flat().length, events.length);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.reduce((sum, event) => sum + event.text.length, 0) <= 40);
  }
});

test('mergeBibles dedupes memories and keeps the later stage', () => {
  const first = normalizeBible({
    title: 't',
    persona: { name: '沈砚' },
    relationship: { stage: '初识' },
    memories: [{ kind: '约定', text: '去海边' }],
    timeline: [{ when: '第1天', event: '下雨' }],
  });
  const second = normalizeBible({
    title: 't',
    persona: { name: '沈砚', personality: ['克制'] },
    relationship: { stage: '暧昧' },
    memories: [
      { kind: '约定', text: '去海边' },
      { kind: '心事', text: '怕失去' },
    ],
    timeline: [{ when: '第2天', event: '送伞' }],
  });

  const merged = mergeBibles([first, second]);
  assert.equal(merged.relationship.stage, '暧昧');
  assert.equal(merged.memories.length, 2);
  assert.equal(merged.timeline.length, 2);
  assert.deepEqual(merged.persona.personality, ['克制']);
});

test('deterministicBible marks itself as deterministic', () => {
  const events = [
    {
      role: 'assistant',
      speaker: '沈砚',
      text: '答应你，周末去看海。',
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      role: 'user',
      text: '你别忘了。',
      createdAt: '2026-01-01T00:01:00Z',
    },
  ];
  const bible = deterministicBible(events, { title: '测试' });
  assert.equal(bible.meta.source, 'deterministic');
  assert.equal(bible.persona.name, '沈砚');
  assert.ok(bible.memories.length >= 1);
});

test('buildMessages includes the title and transcript', () => {
  const messages = buildMessages(
    [{ role: 'user', text: '你好' }],
    { title: '测试故事' },
  );
  assert.equal(messages.length, 2);
  assert.match(messages[1].content, /测试故事/);
  assert.match(messages[1].content, /你好/);
});
