import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { DatabaseSync } from 'node:sqlite';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function now() {
  return new Date().toISOString();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function makeToken() {
  return `whale_${crypto.randomBytes(32).toString('hex')}`;
}

export function makeCode() {
  const block = () =>
    Array.from(
      { length: 4 },
      () => CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)],
    ).join('');
  return `WHALE-${block()}-${block()}-${block()}`;
}

export function normalizeCode(code) {
  return String(code ?? '')
    .trim()
    .toUpperCase();
}

export function openBilling(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      credits INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS codes (
      code TEXT PRIMARY KEY,
      credits INTEGER NOT NULL,
      used_by INTEGER,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      credits INTEGER NOT NULL,
      model TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

export function createCodes(db, credits = 500, count = 1) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO codes (code, credits, created_at) VALUES (?, ?, ?)',
  );
  const created = [];
  const stamp = now();
  while (created.length < count) {
    const code = makeCode();
    const result = insert.run(code, Math.max(1, Number(credits) || 1), stamp);
    if (result.changes > 0) created.push(code);
  }
  return created;
}

export function redeemCode(db, rawCode, existingAccountId = null) {
  const code = normalizeCode(rawCode);
  if (!code) return null;

  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db
      .prepare('SELECT code, credits, used_by FROM codes WHERE code = ?')
      .get(code);
    if (!row || row.used_by) {
      db.exec('ROLLBACK');
      return null;
    }

    const stamp = now();
    if (existingAccountId) {
      db.prepare(
        'UPDATE accounts SET credits = credits + ?, updated_at = ? WHERE id = ?',
      ).run(row.credits, stamp, existingAccountId);
      db.prepare('UPDATE codes SET used_by = ?, used_at = ? WHERE code = ?').run(
        existingAccountId,
        stamp,
        code,
      );
      const account = db
        .prepare('SELECT credits FROM accounts WHERE id = ?')
        .get(existingAccountId);
      db.exec('COMMIT');
      return {
        token: null,
        credits: account?.credits ?? row.credits,
        accountId: existingAccountId,
      };
    }

    const token = makeToken();
    const account = db
      .prepare(
        'INSERT INTO accounts (token_hash, credits, created_at, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run(hashToken(token), row.credits, stamp, stamp);
    db.prepare('UPDATE codes SET used_by = ?, used_at = ? WHERE code = ?').run(
      Number(account.lastInsertRowid),
      stamp,
      code,
    );
    db.exec('COMMIT');
    return {
      token,
      credits: row.credits,
      accountId: Number(account.lastInsertRowid),
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getAccount(db, token) {
  if (!token) return null;
  return (
    db
      .prepare('SELECT id, credits, created_at, updated_at FROM accounts WHERE token_hash = ?')
      .get(hashToken(token)) ?? null
  );
}

export function consumeCredit(db, accountId, amount = 1) {
  const value = Math.max(1, Number(amount) || 1);
  const result = db
    .prepare(
      'UPDATE accounts SET credits = credits - ?, updated_at = ? WHERE id = ? AND credits >= ?',
    )
    .run(value, now(), accountId, value);
  if (result.changes > 0) {
    db.prepare('INSERT INTO usage (account_id, credits, created_at) VALUES (?, ?, ?)').run(
      accountId,
      value,
      now(),
    );
  }
  return result.changes > 0;
}

export function refundCredit(db, accountId, amount = 1) {
  const value = Math.max(1, Number(amount) || 1);
  db.prepare('UPDATE accounts SET credits = credits + ?, updated_at = ? WHERE id = ?').run(
    value,
    now(),
    accountId,
  );
  db.prepare(
    'INSERT INTO usage (account_id, credits, created_at) VALUES (?, ?, ?)',
  ).run(accountId, -value, now());
}

export function addCreditsByToken(db, token, amount) {
  const account = getAccount(db, token);
  if (!account) return false;
  const value = Number(amount) || 0;
  if (!value) return false;
  db.prepare('UPDATE accounts SET credits = credits + ?, updated_at = ? WHERE id = ?').run(
    value,
    now(),
    account.id,
  );
  return true;
}

export function billingStats(db) {
  const accounts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
  const credits = db
    .prepare('SELECT COALESCE(SUM(credits), 0) AS n FROM accounts')
    .get().n;
  const codes = db.prepare('SELECT COUNT(*) AS n FROM codes').get().n;
  const used = db.prepare('SELECT COUNT(*) AS n FROM codes WHERE used_by IS NOT NULL').get().n;
  return { accounts, credits, codes, used };
}

export function listCodes(db, limit = 50) {
  return db
    .prepare(
      'SELECT code, credits, used_by, used_at, created_at FROM codes ORDER BY created_at DESC LIMIT ?',
    )
    .all(Number(limit) || 50);
}
