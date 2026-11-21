import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  addCreditsByToken,
  billingStats,
  createCodes,
  listCodes,
  openBilling,
} from '../server/billing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.BILLING_DB || path.join(ROOT, 'data', 'billing.db');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const command = process.argv[2] || 'stats';
const db = openBilling(DB);

try {
  if (command === 'create') {
    const credits = Number(arg('credits', 500));
    const count = Number(arg('count', 10));
    const codes = createCodes(db, credits, count);
    const out = arg('out', '');
    if (out) {
      fs.writeFileSync(out, `${codes.join('\n')}\n`, 'utf8');
      console.log(`wrote ${codes.length} codes to ${out}`);
    } else {
      console.log(codes.join('\n'));
    }
    console.log(`credits per code: ${credits}`);
  } else if (command === 'stats') {
    console.log(JSON.stringify(billingStats(db), null, 2));
  } else if (command === 'list') {
    console.table(listCodes(db, Number(arg('limit', 50))));
  } else if (command === 'add') {
    const token = arg('token', '');
    const credits = Number(arg('credits', 0));
    if (!token || !credits) {
      throw new Error('usage: node scripts/codes.mjs add --token whale_... --credits 100');
    }
    console.log(addCreditsByToken(db, token, credits) ? 'ok' : 'account not found');
  } else {
    console.log(`commands:
  create --credits 500 --count 20 [--out codes.txt]
  stats
  list [--limit 50]
  add --token whale_... --credits 100`);
  }
} finally {
  db.close();
}
