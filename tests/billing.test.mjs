import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addCreditsByToken,
  billingStats,
  consumeCredit,
  createCodes,
  getAccount,
  importCodes,
  openBilling,
  redeemCode,
  refundCredit,
  verifyCodes,
} from '../server/billing.mjs';

test('redeem, consume, refund and stats', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-billing-'));
  const file = path.join(dir, 'billing.db');
  const db = openBilling(file);

  try {
    const [code, second] = createCodes(db, 500, 2);
    assert.match(code, /^WHALE-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.notEqual(code, second);

    const redeemed = redeemCode(db, code);
    assert.ok(redeemed.token.startsWith('whale_'));
    assert.equal(redeemed.credits, 500);
    assert.equal(redeemCode(db, code), null);

    const account = getAccount(db, redeemed.token);
    assert.equal(account.credits, 500);

    assert.equal(consumeCredit(db, account.id, 1), true);
    assert.equal(getAccount(db, redeemed.token).credits, 499);
    assert.equal(consumeCredit(db, account.id, 499), true);
    assert.equal(getAccount(db, redeemed.token).credits, 0);
    assert.equal(consumeCredit(db, account.id, 1), false);

    refundCredit(db, account.id, 1);
    assert.equal(getAccount(db, redeemed.token).credits, 1);

    assert.equal(addCreditsByToken(db, redeemed.token, 100), true);
    assert.equal(getAccount(db, redeemed.token).credits, 101);

    const toppedUp = redeemCode(db, second, account.id);
    assert.equal(toppedUp.token, null);
    assert.equal(toppedUp.credits, 601);
    assert.equal(getAccount(db, redeemed.token).credits, 601);

    assert.deepEqual(billingStats(db), {
      accounts: 1,
      credits: 601,
      codes: 2,
      used: 2,
    });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyCodes catches missing, used and mismatched codes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-billing-verify-'));
  const db = openBilling(path.join(dir, 'billing.db'));

  try {
    const [first, second] = createCodes(db, 1200, 2, 30);
    const good = verifyCodes(db, [first, second], 1200, 30);
    assert.equal(good.ok, true);
    assert.equal(good.total, 2);

    redeemCode(db, first);
    const afterUse = verifyCodes(db, [first, second], 1200, 30);
    assert.equal(afterUse.ok, false);
    assert.deepEqual(afterUse.used, [first]);

    const wrong = verifyCodes(db, [second], 3000, 30);
    assert.equal(wrong.ok, false);
    assert.equal(wrong.mismatch.length, 1);

    const missing = verifyCodes(db, ['WHALE-NOTF-OUND-XXXX'], 1200, 30);
    assert.equal(missing.ok, false);
    assert.equal(missing.missing.length, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('monthly grants expire and stop being consumable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-billing-expiry-'));
  const db = openBilling(path.join(dir, 'billing.db'));

  try {
    const [code] = createCodes(db, 1200, 1, 30);
    const redeemed = redeemCode(db, code);
    assert.ok(redeemed.expiresAt);
    assert.equal(redeemed.credits, 1200);

    db.prepare('UPDATE grants SET expires_at = ? WHERE account_id = ?').run(
      '2000-01-01T00:00:00.000Z',
      redeemed.accountId,
    );
    assert.equal(getAccount(db, redeemed.token).credits, 0);
    assert.equal(consumeCredit(db, redeemed.accountId, 1), false);
    assert.deepEqual(billingStats(db), {
      accounts: 1,
      credits: 0,
      codes: 1,
      used: 1,
    });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('importCodes imports a portable code list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-billing-import-'));
  const db = openBilling(path.join(dir, 'billing.db'));

  try {
    const inserted = importCodes(
      db,
      ['WHALE-AAAA-BBBB-CCCC', 'whale-dddd-eeee-ffff', ''],
      3000,
    );
    assert.equal(inserted, 2);
    const redeemed = redeemCode(db, 'WHALE-AAAA-BBBB-CCCC');
    assert.equal(redeemed.credits, 3000);
    assert.equal(redeemCode(db, 'WHALE-DDDD-EEEE-FFFF').credits, 3000);
    assert.equal(importCodes(db, ['WHALE-AAAA-BBBB-CCCC'], 3000), 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
