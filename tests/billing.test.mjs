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
  openBilling,
  redeemCode,
  refundCredit,
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
