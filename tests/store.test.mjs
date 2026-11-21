import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { importChat } from '../src/import/index.mjs';
import { openDb, getSelectedEvents, searchEvents } from '../src/store/db.mjs';
import { storeImport } from '../src/store/import-store.mjs';

const loadJson = (name) =>
  JSON.parse(fs.readFileSync(path.join('fixtures', name), 'utf8'));

test('store import persists events, branches and search', () => {
  const result = importChat(loadJson('deepseek-raw.json'));
  const db = openDb(':memory:');

  const stats = storeImport(db, result, { title: '和沈砚的雨夜' });
  assert.equal(stats.events, 6);
  assert.equal(stats.selected, 4);
  assert.equal(stats.archived, 2);

  const selected = getSelectedEvents(db, 'raw-demo-001');
  assert.deepEqual(
    selected.map((row) => row.id),
    ['1', '2', '4', '6'],
  );

  const hits = searchEvents(db, '伞');
  assert.ok(hits.length >= 1);
  assert.ok(hits.some((row) => row.text.includes('伞')));

  // Re-import replaces rows instead of duplicating them.
  storeImport(db, result, { title: '和沈砚的雨夜' });
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM events').get().n,
    6,
  );

  db.close();
});
