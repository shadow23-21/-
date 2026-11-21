import fs from 'node:fs';

import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://localhost:8787/';

const env = Object.fromEntries(
  fs
    .readFileSync('../.env', 'utf8')
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);

if (!env.DEEPSEEK_API_KEY) {
  throw new Error('DEEPSEEK_API_KEY missing from .env');
}

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
  page.on('requestfailed', (request) => {
    console.log('REQFAIL', request.url(), request.failure()?.errorText);
  });

  await page.evaluateOnNewDocument((apiKey) => {
    localStorage.setItem(
      'whale-settings',
      JSON.stringify({
        provider: 'deepseek',
        model: 'deepseek-flash',
        apiKey,
        useServerKey: false,
        directDeepseek: true,
        remember: false,
        maxRecent: 6,
        retrievalLimit: 4,
        memoryLimit: 6,
        contextBudgetTokens: 1500,
        maxOutputTokens: 300,
        temperature: 0.8,
      }),
    );
  }, env.DEEPSEEK_API_KEY);

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.composer textarea');
  const beforeLast = await page.$$eval(
    '.message.assistant .message-text',
    (nodes) => nodes.at(-1)?.innerText.trim() ?? '',
  );

  await page.type('.composer textarea', 'hello');
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '发送')
      ?.click();
  });

  try {
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
      { timeout: 30000 },
      beforeLast,
    );
  } catch (waitError) {
    const errorBar = await page
      .$eval('.error-bar', (node) => node.innerText)
      .catch(() => '(no error bar)');
    const tail = await page.$$eval('.message.assistant .message-text', (nodes) =>
      nodes
        .slice(-2)
        .map((node) => node.innerText.trim())
        .join(' | '),
    );
    console.log('DEBUG before:', beforeLast);
    console.log('DEBUG error bar:', errorBar);
    console.log('DEBUG tail:', tail);
    console.log('DEBUG sending:', await page.$eval('.composer .hint', (n) => n.innerText).catch(() => ''));
    const lastInfo = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.message.assistant')];
      const last = nodes.at(-1);
      return {
        count: nodes.length,
        cursor: Boolean(last?.querySelector('.cursor')),
        text: last?.querySelector('.message-text')?.innerText.trim(),
        html: last?.outerHTML.slice(-420),
        status: document.querySelector('.status')?.innerText,
      };
    });
    console.log('DEBUG last:', JSON.stringify(lastInfo));
    await page.screenshot({ path: '../out/web-demo/direct-debug.png' });
    throw waitError;
  }

  const error = await page.$eval('.error-bar', (node) => node.innerText).catch(() => '');
  if (error) throw new Error(error);

  const reply = await page.$$eval('.message.assistant .message-text', (nodes) =>
    nodes.at(-1)?.innerText.trim(),
  );
  console.log('direct reply:', reply.slice(0, 160));
  await page.screenshot({ path: '../out/web-demo/direct.png' });
  console.log('direct: ok');
} finally {
  await browser.close();
}
