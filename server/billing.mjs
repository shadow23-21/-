import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { DatabaseSync } from 'node:sqlite';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DAY_MS = 24 * 60 * 60 * 1000;

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

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
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
    CREATE TABLE IF NOT EXISTS grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      credits INTEGER NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS codes (
      code TEXT PRIMARY KEY,
      credits INTEGER NOT NULL,
      days INTEGER NOT NULL DEFAULT 0,
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
    CREATE INDEX IF NOT EXISTS idx_grants_account ON grants(account_id);
  `);

  if (!tableColumns(db, 'codes').includes('days')) {
    db.exec('ALTER TABLE codes ADD COLUMN days INTEGER NOT NULL DEFAULT 0');
  }

  // Migrate old accounts.credits balances into non-expiring grants once.
  const legacy = db
    .prepare('SELECT id, credits FROM accounts WHERE credits > 0')
    .all();
  for (const account of legacy) {
    const hasGrant = db
      .prepare('SELECT COUNT(*) AS n FROM grants WHERE account_id = ?')
      .get(account.id).n;
    if (hasGrant === 0) {
      db.prepare(
        'INSERT INTO grants (account_id, credits, expires_at, created_at) VALUES (?, ?, NULL, ?)',
      ).run(account.id, account.credits, now());
    }
    db.prepare('UPDATE accounts SET credits = 0 WHERE id = ?').run(account.id);
  }

  return db;
}

export function createCodes(db, credits = 500, count = 1, days = 0) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO codes (code, credits, days, created_at) VALUES (?, ?, ?, ?)',
  );
  const created = [];
  const stamp = now();
  const value = Math.max(1, Number(credits) || 1);
  const duration = Math.max(0, Number(days) || 0);
  while (created.length < count) {
    const code = makeCode();
    const result = insert.run(code, value, duration, stamp);
    if (result.changes > 0) created.push(code);
  }
  return created;
}

export function importCodes(db, codes, credits = 500, days = 0) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO codes (code, credits, days, created_at) VALUES (?, ?, ?, ?)',
  );
  let inserted = 0;
  const stamp = now();
  const value = Math.max(1, Number(credits) || 1);
  const duration = Math.max(0, Number(days) || 0);
  for (const raw of codes) {
    const code = normalizeCode(raw);
    if (!code) continue;
    const result = insert.run(code, value, duration, stamp);
    if (result.changes > 0) inserted += 1;
  }
  return inserted;
}

function balance(db, accountId) {
  return (
    db
      .prepare(
        'SELECT COALESCE(SUM(credits), 0) AS n FROM grants WHERE account_id = ? AND (expires_at IS NULL OR expires_at > ?)',
      )
      .get(accountId, now()).n ?? 0
  );
}

function nextExpiry(db, accountId) {
  return (
    db
      .prepare(
        'SELECT MIN(expires_at) AS at FROM grants WHERE account_id = ? AND credits > 0 AND expires_at IS NOT NULL AND expires_at > ?',
      )
      .get(accountId, now()).at ?? null
  );
}

export function redeemCode(db, rawCode, existingAccountId = null) {
  const code = normalizeCode(rawCode);
  if (!code) return null;

  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db
      .prepare('SELECT code, credits, days, used_by FROM codes WHERE code = ?')
      .get(code);
    if (!row || row.used_by) {
      db.exec('ROLLBACK');
      return null;
    }

    const stamp = now();
    let accountId = existingAccountId;
    let token = null;

    if (!accountId) {
      token = makeToken();
      const account = db
        .prepare(
          'INSERT INTO accounts (token_hash, credits, created_at, updated_at) VALUES (?, 0, ?, ?)',
        )
        .run(hashToken(token), stamp, stamp);
      accountId = Number(account.lastInsertRowid);
    }

    const expiresAt =
      row.days > 0 ? new Date(Date.now() + row.days * DAY_MS).toISOString() : null;
    db.prepare(
      'INSERT INTO grants (account_id, credits, expires_at, created_at) VALUES (?, ?, ?, ?)',
    ).run(accountId, row.credits, expiresAt, stamp);
    db.prepare('UPDATE codes SET used_by = ?, used_at = ? WHERE code = ?').run(
      accountId,
      stamp,
      code,
    );
    db.prepare('UPDATE accounts SET updated_at = ? WHERE id = ?').run(stamp, accountId);

    const result = {
      token,
      credits: balance(db, accountId),
      expiresAt: nextExpiry(db, accountId),
      accountId,
    };
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getAccount(db, token) {
  if (!token) return null;
  const account = db
    .prepare('SELECT id, created_at, updated_at FROM accounts WHERE token_hash = ?')
    .get(hashToken(token));
  if (!account) return null;
  return {
    id: account.id,
    credits: balance(db, account.id),
    expiresAt: nextExpiry(db, account.id),
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}

export function consumeCredit(db, accountId, amount = 1) {
  const value = Math.max(1, Number(amount) || 1);
  db.exec('BEGIN IMMEDIATE');
  try {
    const stamp = now();
    const grants = db
      .prepare(
        `SELECT id, credits FROM grants
         WHERE account_id = ? AND credits > 0
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, id ASC`,
      )
      .all(accountId, stamp);

    let remaining = value;
    for (const grant of grants) {
      if (remaining <= 0) break;
      const use = Math.min(remaining, grant.credits);
      db.prepare('UPDATE grants SET credits = credits - ? WHERE id = ?').run(
        use,
        grant.id,
      );
      remaining -= use;
    }
    if (remaining > 0) {
      db.exec('ROLLBACK');
      return false;
    }

    db.prepare(
      'INSERT INTO usage (account_id, credits, created_at) VALUES (?, ?, ?)',
    ).run(accountId, value, stamp);
    db.prepare('UPDATE accounts SET updated_at = ? WHERE id = ?').run(stamp, accountId);
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function refundCredit(db, accountId, amount = 1) {
  const value = Math.max(1, Number(amount) || 1);
  const stamp = now();
  db.prepare(
    'INSERT INTO grants (account_id, credits, expires_at, created_at) VALUES (?, ?, NULL, ?)',
  ).run(accountId, value, stamp);
  db.prepare(
    'INSERT INTO usage (account_id, credits, created_at) VALUES (?, ?, ?)',
  ).run(accountId, -value, stamp);
}

export function addCreditsByToken(db, token, amount, days = 0) {
  const account = getAccount(db, token);
  if (!account) return false;
  const value = Number(amount) || 0;
  if (!value) return false;
  const expiresAt =
    days > 0 ? new Date(Date.now() + Number(days) * DAY_MS).toISOString() : null;
  db.prepare(
    'INSERT INTO grants (account_id, credits, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(account.id, value, expiresAt, now());
  return true;
}

export function verifyCodes(db, codes, credits = 500, days = 0) {
  const expectedCredits = Math.max(1, Number(credits) || 1);
  const expectedDays = Math.max(0, Number(days) || 0);
  const missing = [];
  const used = [];
  const mismatch = [];

  for (const raw of codes) {
    const code = normalizeCode(raw);
    if (!code) continue;
    const row = db
      .prepare('SELECT code, credits, days, used_by FROM codes WHERE code = ?')
      .get(code);
    if (!row) {
      missing.push(code);
    } else if (row.used_by) {
      used.push(code);
    } else if (row.credits !== expectedCredits || row.days !== expectedDays) {
      mismatch.push({
        code,
        expectedCredits,
        actualCredits: row.credits,
        expectedDays,
        actualDays: row.days,
      });
    }
  }

  return {
    total: codes.filter((code) => normalizeCode(code)).length,
    ok: missing.length === 0 && used.length === 0 && mismatch.length === 0,
    missing,
    used,
    mismatch,
  };
}

export function billingStats(db) {
  const accounts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
  const credits = db
    .prepare(
      'SELECT COALESCE(SUM(credits), 0) AS n FROM grants WHERE expires_at IS NULL OR expires_at > ?',
    )
    .get(now()).n;
  const codes = db.prepare('SELECT COUNT(*) AS n FROM codes').get().n;
  const used = db.prepare('SELECT COUNT(*) AS n FROM codes WHERE used_by IS NOT NULL').get().n;
  return { accounts, credits, codes, used };
}

export function listCodes(db, limit = 50) {
  return db
    .prepare(
      'SELECT code, credits, days, used_by, used_at, created_at FROM codes ORDER BY created_at DESC LIMIT ?',
    )
    .all(Number(limit) || 50);
}
