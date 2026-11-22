import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildContext,
  estimateCostCNY,
  estimateTokens,
  memoryLines,
  retrieve,
  tokenize,
} from '../web/src/lib/context.js';

const bible = {
  title: '和沈砚的一百二十天',
  persona: {
    name: '沈砚',
    aliases: [],
    personality: ['克制'],
    speech_style: '短句',
    background: '医生',
    habits: [],
    appearance: '白大褂',
  },
  relationship: {
    stage: '暧昧',
    user_name: '你',
    character_role: '恋人',
    address_terms: { user: ['你'], character: ['沈砚'] },
    boundaries: ['别提顾青'],
    tensions: [],
  },
  memories: [
    { kind: '约定', text: '周末去看海', importance: 0.9 },
    { kind: '喜好', text: '喜欢吃栗子蛋糕', importance: 0.7 },
  ],
  style_samples: ['带了。在柜子里。'],
  open_threads: ['周末看海'],
};

const events = Array.from({ length: 12 }, (_, index) => ({
  id: String(index + 1),
  role: index % 2 === 0 ? 'user' : 'assistant',
  speaker: index % 2 === 0 ? null : '沈砚',
  text:
    index === 0
      ? '今天下雨了，你带伞没有？'
      : index === 1
        ? '带了，在柜子里。'
        : `第 ${index + 1} 条普通对话。`,
}));

test('tokenize handles Chinese bigrams and single characters', () => {
  assert.ok(tokenize('雨伞').includes('雨伞'));
  assert.ok(tokenize('伞').includes('伞'));
  assert.ok(tokenize('Magic the Gathering').includes('magic'));
});

test('retrieve finds the event matching the query', () => {
  const results = retrieve(events, '伞', { excludeLast: 0 });
  assert.ok(results.some((event) => event.text.includes('伞')));
});

test('retrieve ranks a specific old event above generic distractors', () => {
  const corpus = Array.from({ length: 30 }, (_, index) => ({
    id: `distractor-${index}`,
    role: 'assistant',
    text: `第 ${index} 条普通日常对话，在房间里待着。`,
  }));
  corpus.splice(3, 0, {
    id: 'old-meeting',
    role: 'assistant',
    text: '我第一次见你是在医院走廊，你穿着白大褂。',
  });

  const results = retrieve(corpus, '第一次见面是在哪里', {
    excludeLast: 0,
    limit: 3,
  });
  assert.equal(results[0].id, 'old-meeting');
});

test('memoryLines prefers matching memory but keeps core memories', () => {
  const results = memoryLines(bible, '蛋糕');
  assert.equal(results[0].text, '喜欢吃栗子蛋糕');
  assert.ok(results.some((memory) => memory.text === '周末去看海'));
});

test('buildContext includes persona, memory and exactly one user message', () => {
  const context = buildContext({
    bible,
    events,
    messages: [
      { role: 'assistant', text: '走廊尽头的灯闪了一下。' },
      { role: 'user', text: '你带伞没有？' },
    ],
    userText: '周末还去看海吗？',
  });

  assert.match(context.messages[0].content, /沈砚/);
  assert.match(context.messages[1].content, /看海/);
  assert.equal(context.messages.at(-1).content, '周末还去看海吗？');
  assert.equal(
    context.messages.filter(
      (message) => message.role === 'user' && message.content === '周末还去看海吗？',
    ).length,
    1,
  );
  assert.ok(context.estimatedInputTokens > 0);
});

test('buildContext anchors persona consistency and memory rules', () => {
  const context = buildContext({
    bible,
    events,
    messages: [{ role: 'assistant', text: '走廊尽头的灯闪了一下。' }],
    userText: '周末还去看海吗？',
    estimatedOutputTokens: 400,
  });
  assert.match(context.messages[0].content, /保持角色一致性/);
  assert.match(context.messages[0].content, /1–3 句/);
  assert.match(context.messages[1].content, /不要编造记忆里没有的事/);
  assert.equal(context.options.estimatedOutputTokens, 400);
});

test('buildContext respects the cheap defaults and custom budgets', () => {
  const context = buildContext({
    bible,
    events,
    messages: [{ role: 'assistant', text: '走廊尽头的灯闪了一下。' }],
    userText: '周末还去看海吗？',
    maxRecent: 2,
    retrievalLimit: 1,
    memoryLimit: 1,
  });
  assert.ok(context.memories.length <= 1);
  assert.ok(context.retrieved.length <= 1);
  assert.equal(context.options.maxRecent, 2);
});

test('stable system prefix stays identical for prefix caching', () => {
  const left = buildContext({
    bible,
    events,
    messages: [{ role: 'assistant', text: '走廊尽头的灯闪了一下。' }],
    userText: '今天下雨了',
  });
  const right = buildContext({
    bible,
    events,
    messages: [{ role: 'assistant', text: '走廊尽头的灯闪了一下。' }],
    userText: '周末还去看海吗？',
  });
  assert.equal(left.messages[0].content, right.messages[0].content);
});

test('buildContext respects a tight token budget', () => {
  const largeBible = {
    ...bible,
    memories: Array.from({ length: 10 }, (_, index) => ({
      kind: '事件',
      text: `第 ${index} 条很长的记忆：${'雨夜和伞。'.repeat(8)}`,
      importance: 0.5 + index / 20,
    })),
  };

  const context = buildContext({
    bible: largeBible,
    events,
    messages: [{ role: 'assistant', text: '走廊尽头的灯闪了一下。' }],
    userText: '周末还去看海吗？',
    contextBudgetTokens: 260,
  });
  assert.equal(context.options.contextBudgetTokens, 260);
  assert.ok(context.estimatedInputTokens > 0);
  assert.ok(context.budgetUsedPct <= 100);
  assert.ok(context.memories.length < 10);
  assert.ok(context.retrieved.length < events.length);
});

test('estimateTokens is conservative for Chinese', () => {
  assert.ok(estimateTokens('雨'.repeat(150)) >= 90);
  assert.ok(estimateTokens('hello world') < 10);
});

test('long persona fields and recent messages keep persona and memory anchors', () => {
  const longBible = {
    ...bible,
    persona: {
      ...bible.persona,
      appearance: '白大褂。'.repeat(400),
      background: '医生。'.repeat(400),
    },
    relationship: {
      ...bible.relationship,
      boundaries: ['不能让顾青误会'],
    },
  };
  const longMessages = Array.from({ length: 6 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `第 ${index} 条很长的日常。${'雨夜。'.repeat(500)}`,
  }));

  const context = buildContext({
    bible: longBible,
    events,
    messages: longMessages,
    userText: '你还记得周末要去看海吗？',
  });

  assert.match(context.messages[0].content, /沈砚/);
  assert.match(context.messages[0].content, /保持角色一致性/);
  assert.match(context.messages[0].content, /不能让顾青误会/);
  assert.ok(context.memories.length >= 1, 'core memory should survive trimming');
  assert.match(context.messages[1].content, /看海/);
  assert.ok(context.estimatedInputTokens > 0);
});

test('cost estimate is positive', () => {
  assert.ok(estimateCostCNY(10_000) > 0);
});
