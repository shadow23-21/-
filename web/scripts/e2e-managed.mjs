import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:8787/';
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'out',
);
const code = process.env.CODE;

if (!code) throw new Error('Set CODE to a fresh redeem code');

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('PAGE ERROR:', message.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.topbar');

  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '设置')
      ?.click();
  });
  await page.waitForFunction(() =>
    document.body.innerText.toLowerCase().includes('鲸忆额度'),
  );

  await page.waitForSelector('.managed-redeem input');
  await page.type('.managed-redeem input', code);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '兑换')
      ?.click();
  });
  await page.waitForFunction(
    () => {
      const node = document.querySelector('.managed-balance strong');
      return node && node.innerText.trim() !== '—';
    },
    { timeout: 20000 },
  );
  const credits = await page.$eval('.managed-balance strong', (node) =>
    node.innerText.trim(),
  );
  console.log('redeemed credits:', credits);

  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '←')
      ?.click();
  });
  await page.waitForSelector('.composer textarea');

  const beforeLast = await page.$$eval(
    '.message.assistant .message-text',
    (nodes) => nodes.at(-1)?.innerText.trim() ?? '',
  );
  await page.type('.composer textarea', '你好，简单回一句');
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '发送')
      ?.click();
  });
  await page.waitForFunction(
    (previousLast) => {
      const nodes = [...document.querySelectorAll('.message.assistant')];
      const last = nodes.at(-1);
      const text = last?.querySelector('.message-text')?.innerText.trim() ?? '';
      return (
        text.length > 0 &&
        text !== previousLast &&
        !last?.querySelector('.cursor') &&
        !document.body.innerText.includes('生成中…')
      );
    },
    { timeout: 120000 },
    beforeLast,
  );

  const error = await page.$eval('.error-bar', (node) => node.innerText).catch(() => '');
  if (error) throw new Error(error);

  const reply = await page.$$eval('.message.assistant .message-text', (nodes) =>
    nodes.at(-1)?.innerText.trim(),
  );
  const hint = await page.$eval('.composer .hint', (node) => node.innerText.trim());
  console.log('managed reply:', reply.slice(0, 120));
  console.log('hint:', hint);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'web-managed.png') });

  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '设置')
      ?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('剩余'));
  const after = await page.$eval('.managed-balance strong', (node) =>
    node.innerText.trim(),
  );
  console.log('credits after chat:', after);
  console.log('managed: ok');
} finally {
  await browser.close();
}
