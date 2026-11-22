import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeChatRequest } from '../server/chat-limits.mjs';

test('normalizeChatRequest accepts normal roleplay payload', () => {
  const result = normalizeChatRequest({
    messages: [
      { role: 'system', content: '人设' },
      { role: 'user', content: '你好' },
    ],
    maxTokens: 400,
    temperature: 0.9,
  });

  assert.equal(result.ok, true);
  assert.equal(result.model, 'deepseek-flash');
  assert.equal(result.maxTokens, 400);
  assert.deepEqual(result.messages, [
    { role: 'system', content: '人设' },
    { role: 'user', content: '你好' },
  ]);
});

test('normalizeChatRequest caps output tokens and rejects huge prompts', () => {
  const capped = normalizeChatRequest({
    messages: [{ role: 'user', content: '你好' }],
    maxTokens: 100000,
  });
  assert.equal(capped.ok, true);
  assert.equal(capped.maxTokens, 500);

  const tooMany = normalizeChatRequest({
    messages: Array.from({ length: 13 }, () => ({ role: 'user', content: 'hi' })),
  });
  assert.equal(tooMany.ok, false);

  const tooLong = normalizeChatRequest({
    messages: [{ role: 'user', content: '雨'.repeat(2401) }],
  });
  assert.equal(tooLong.ok, false);

  const tooMuch = normalizeChatRequest({
    messages: Array.from({ length: 3 }, () => ({
      role: 'user',
      content: '雨'.repeat(2300),
    })),
  });
  assert.equal(tooMuch.ok, false);
});

test('normalizeChatRequest rejects unapproved models', () => {
  const result = normalizeChatRequest({
    model: 'deepseek-reasoner',
    messages: [{ role: 'user', content: '你好' }],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /模型/);
});
