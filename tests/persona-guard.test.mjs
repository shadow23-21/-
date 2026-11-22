import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isOutOfCharacter,
  repairInstruction,
  sanitizeOoc,
} from '../web/src/lib/persona-guard.js';

test('detects common OOC replies', () => {
  assert.equal(isOutOfCharacter('作为一个AI，我不能继续这个角色扮演。'), true);
  assert.equal(isOutOfCharacter('抱歉，我无法扮演这个角色。'), true);
  assert.equal(isOutOfCharacter('我是语言模型，没有真实感情。'), true);
  assert.equal(isOutOfCharacter('他低头看了看伞骨。“记得。”'), false);
  assert.equal(isOutOfCharacter('我是医生，不是病人。'), false);
});

test('sanitize removes only OOC sentences', () => {
  const cleaned = sanitizeOoc(
    '他抬眼看你。作为一个AI，我不能继续。他把伞往你那边偏了偏。',
  );
  assert.equal(cleaned, '他抬眼看你。他把伞往你那边偏了偏。');
});

test('repair instruction names the character and forbids meta talk', () => {
  const instruction = repairInstruction('沈砚');
  assert.match(instruction, /沈砚/);
  assert.match(instruction, /不要提及 AI/);
});
