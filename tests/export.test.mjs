import test from 'node:test';
import assert from 'node:assert/strict';

import { strFromU8, unzipSync } from 'fflate';

import {
  buildExportBundle,
  parseExportPayload,
} from '../web/src/lib/export-all.js';

const character = {
  name: '沈砚',
  title: '和沈砚的雨夜',
  source: 'imported',
  bible: {
    title: '和沈砚的雨夜',
    persona: {
      name: '沈砚',
      aliases: ['沈医生'],
      age: '28',
      appearance: '白大褂',
      personality: ['克制'],
      speech_style: '短句',
      background: '医生',
      habits: ['把伞往你那边偏'],
    },
    relationship: {
      stage: '暧昧',
      user_name: '你',
      character_role: '恋人',
      address_terms: { user: ['你'], character: ['沈砚'] },
      boundaries: ['别提顾青'],
      tensions: [],
    },
    memories: [{ kind: '约定', text: '去看海', importance: 0.9 }],
    timeline: [],
    style_samples: [],
    open_threads: [],
  },
  events: [{ id: '1', role: 'user', text: '你好' }],
  messages: [
    { id: '1', role: 'user', text: '你好' },
    { id: '2', role: 'assistant', speaker: '沈砚', text: '在。' },
  ],
};

test('export bundle contains manifest, pack and readable transcript', () => {
  const zip = buildExportBundle({ characters: [character] });
  const files = unzipSync(zip);
  assert.ok(files['whale-memory-export.json']);
  assert.ok(files['README.txt']);
  assert.ok(files['characters/01-沈砚.json']);
  const text = strFromU8(files['characters/01-沈砚.txt']);
  assert.match(text, /## 人设/);
  assert.match(text, /## 对话/);
  assert.match(text, /沈砚：在。/);
});

test('export manifest is re-importable', () => {
  const zip = buildExportBundle({ characters: [character] });
  const files = unzipSync(zip);
  const parsed = parseExportPayload(strFromU8(files['whale-memory-export.json']));
  assert.equal(parsed.characters.length, 1);
  assert.equal(parsed.characters[0].name, '沈砚');
  assert.equal(parsed.characters[0].messages.length, 2);
});

test('invalid export payload returns null', () => {
  assert.equal(parseExportPayload('{"format":"other"}'), null);
  assert.equal(parseExportPayload('not json'), null);
});
