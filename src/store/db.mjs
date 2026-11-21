import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  conversation_id TEXT NOT NULL,
  id TEXT NOT NULL,
  parent_id TEXT,
  role TEXT NOT NULL,
  speaker TEXT,
  text TEXT NOT NULL,
  thinking TEXT,
  created_at TEXT NOT NULL,
  selected INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  model TEXT,
  title TEXT,
  PRIMARY KEY (conversation_id, id)
);

CREATE INDEX IF NOT EXISTS idx_events_conv_time
  ON events(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_conv_selected
  ON events(conversation_id, selected);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  persona_json TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_conv_name
  ON characters(conversation_id, name);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  character_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  source_event_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_conv_kind
  ON memories(conversation_id, kind);

CREATE TABLE IF NOT EXISTS story_bible (
  conversation_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  text,
  speaker,
  content='events',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(rowid, text, speaker)
  VALUES (new.rowid, new.text, new.speaker);
END;

CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, text, speaker)
  VALUES ('delete', old.rowid, old.text, old.speaker);
END;

CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, text, speaker)
  VALUES ('delete', old.rowid, old.text, old.speaker);
  INSERT INTO events_fts(rowid, text, speaker)
  VALUES (new.rowid, new.text, new.speaker);
END;
`;

export function openDb(file = 'whale.db') {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function getSelectedEvents(db, conversationId) {
  return db
    .prepare(
      `SELECT * FROM events
       WHERE conversation_id = ? AND selected = 1
       ORDER BY created_at ASC`,
    )
    .all(conversationId);
}

export function searchEvents(db, query, limit = 20) {
  const like = `%${query}%`;
  return db
    .prepare(
      `SELECT * FROM events
       WHERE selected = 1 AND (text LIKE ? OR speaker LIKE ?)
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(like, like, limit);
}

export function closeDb(db) {
  db.close();
}
