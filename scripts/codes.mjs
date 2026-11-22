import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  addCreditsByToken,
  billingStats,
  createCodes,
  importCodes,
  listCodes,
  openBilling,
  verifyCodes,
} from '../server/billing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.BILLING_DB || path.join(ROOT, 'data', 'billing.db');

const PLANS = {
  monthly9: { credits: 1200, days: 30, price: 9.9 },
  monthly19: { credits: 3000, days: 30, price: 19.9 },
  monthly29: { credits: 5000, days: 30, price: 29.9 },
  // Deliberately poor value per credit; for people who refuse a monthly cap.
  topup: { credits: 300, days: 0, price: 9.9 },
};

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const command = process.argv[2] || 'stats';
const db = openBilling(DB);

try {
  if (command === 'create') {
    const planName = arg('plan', '');
    const plan = planName ? PLANS[planName] : null;
    if (planName && !plan) {
      throw new Error(`unknown plan: ${planName}. Use ${Object.keys(PLANS).join(', ')}`);
    }
    const credits = Number(arg('credits', plan?.credits ?? 500));
    const days = Number(arg('days', plan?.days ?? 0));
    const count = Number(arg('count', 10));
    const codes = createCodes(db, credits, count, days);
    const out = arg('out', '');
    if (out) {
      fs.writeFileSync(out, `${codes.join('\n')}\n`, 'utf8');
      console.log(`wrote ${codes.length} codes to ${out}`);
    } else {
      console.log(codes.join('\n'));
    }
    console.log(`credits per code: ${credits}, days: ${days || 'no expiry'}`);
    if (plan) console.log(`plan: ${planName} (¥${plan.price})`);
  } else if (command === 'import') {
    const file = arg('file', '');
    const credits = Number(arg('credits', 500));
    const days = Number(arg('days', 0));
    if (!file) throw new Error('usage: node scripts/codes.mjs import --file codes.txt --credits 3000 [--days 30]');
    const codes = fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const inserted = importCodes(db, codes, credits, days);
    console.log(`imported ${inserted}/${codes.length} codes (days: ${days || 'no expiry'})`);
  } else if (command === 'verify') {
    const file = arg('file', '');
    const credits = Number(arg('credits', 500));
    const days = Number(arg('days', 0));
    if (!file) throw new Error('usage: node scripts/codes.mjs verify --file codes.txt --credits 1200 --days 30');
    const codes = fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const result = verifyCodes(db, codes, credits, days);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } else if (command === 'plans') {
    console.table(
      Object.entries(PLANS).map(([name, plan]) => ({
        plan: name,
        price: `¥${plan.price}`,
        credits: plan.credits,
        days: plan.days || '永久',
      })),
    );
  } else if (command === 'stats') {
    console.log(JSON.stringify(billingStats(db), null, 2));
  } else if (command === 'list') {
    console.table(listCodes(db, Number(arg('limit', 50))));
  } else if (command === 'add') {
    const token = arg('token', '');
    const credits = Number(arg('credits', 0));
    const days = Number(arg('days', 0));
    if (!token || !credits) {
      throw new Error('usage: node scripts/codes.mjs add --token whale_... --credits 100 [--days 30]');
    }
    console.log(addCreditsByToken(db, token, credits, days) ? 'ok' : 'account not found');
  } else {
    console.log(`commands:
  create --credits 500 --count 20 [--days 30] [--out codes.txt]
  create --plan monthly19 --count 20 [--out codes.txt]
  import --file codes.txt --credits 3000 [--days 30]
  verify --file codes.txt --credits 1200 --days 30
  plans
  stats
  list [--limit 50]
  add --token whale_... --credits 100`);
  }
} finally {
  db.close();
}
