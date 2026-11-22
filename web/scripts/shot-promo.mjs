import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'out');
const code = fs
  .readFileSync(path.join(ROOT, 'release', 'codes-promo.txt'), 'utf8')
  .split(/\r?\n/)[0]
  .trim();

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
  await page.goto('http://localhost:8787/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.topbar');

  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '设置')
      ?.click();
  });
  await page.waitForSelector('.managed-redeem input');
  await page.type('.managed-redeem input', code);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '兑换')
      ?.click();
  });
  await page.waitForFunction(
    () => Number(document.querySelector('.managed-balance strong')?.innerText) > 0,
    { timeout: 20000 },
  );
  await page.screenshot({ path: path.join(OUT, 'promo-credits.png') });
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
  await page.type('.composer textarea', '你还记得那把伞吗？');
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '发送')
      ?.click();
  });
  await page.waitForFunction(
    (previous) => {
      const nodes = [...document.querySelectorAll('.message.assistant')];
      const last = nodes.at(-1);
      const text = last?.querySelector('.message-text')?.innerText.trim() ?? '';
      return (
        text.length > 0 &&
        text !== previous &&
        !last?.querySelector('.cursor') &&
        !document.body.innerText.includes('生成中…')
      );
    },
    { timeout: 120000 },
    beforeLast,
  );
  await page.evaluate(() => {
    document.querySelector('.chat-scroll')?.scrollTo(0, 0);
  });
  await page.screenshot({ path: path.join(OUT, 'promo-chat.png') });

  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '记忆')
      ?.click();
  });
  await page.waitForSelector('.page-card');
  await page.screenshot({ path: path.join(OUT, 'promo-memory.png') });

  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '←')
      ?.click();
  });
  await page.waitForSelector('.composer textarea');
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '☰')
      ?.click();
  });
  await page.waitForSelector('.character-card');
  await page.screenshot({ path: path.join(OUT, 'promo-characters.png') });
  console.log('promo screenshots: ok');
} finally {
  await browser.close();
}
