import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacterPack,
  parseCharacterPack,
} from '../web/src/lib/character-pack.js';

const character = {
  name: '沈砚',
  title: '和沈砚的雨夜',
  source: 'imported',
  bible: {
    title: '和沈砚的雨夜',
    persona: { name: '沈砚', personality: ['克制'] },
    memories: [{ kind: '约定', text: '去看海', importance: 0.9 }],
  },
  events: [{ id: '1', role: 'user', text: '你好' }],
  messages: [{ id: '1', role: 'user', text: '你好', pending: true }],
};

test('character pack round-trips', () => {
  const pack = createCharacterPack({ character });
  assert.equal(pack.format, 'whale-memory-character');
  const parsed = parseCharacterPack(JSON.stringify(pack));
  assert.equal(parsed.name, '沈砚');
  assert.equal(parsed.bible.persona.name, '沈砚');
  assert.equal(parsed.messages[0].pending, undefined);
});

test('invalid pack returns null', () => {
  assert.equal(parseCharacterPack('{"format":"other"}'), null);
  assert.equal(parseCharacterPack('not json'), null);
});
