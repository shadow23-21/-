import path from 'node:path';

import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:8787/';
const fixture = path.resolve('../fixtures/deepseek-export.zip');

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
  page.on('response', async (response) => {
    if (response.status() >= 400) {
      let body = '';
      try {
        body = await response.text();
      } catch {}
      console.log('HTTP', response.status(), response.url(), body.slice(0, 500));
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[type=file]', { state: 'attached' });

  const fileInput = await page.$('input[type=file]');
  await fileInput.uploadFile(fixture);

  await page.waitForFunction(
    () => document.body.innerText.includes('导入完成'),
    { timeout: 120000 },
  );
  await page.screenshot({ path: '../out/web-demo/imported.png' });
  console.log('import: ok');

  const assistantCount = await page.$$eval(
    '.message.assistant',
    (nodes) => nodes.length,
  );

  const textarea = await page.$('textarea');
  await textarea.type('你还记得那把伞吗？');
  await page.keyboard.press('Enter');

  await page.waitForFunction(
    (count) => {
      const nodes = [...document.querySelectorAll('.message.assistant .message-text')];
      const last = nodes.at(-1);
      return (
        nodes.length > count &&
        last &&
        last.textContent.trim().length > 10 &&
        !document.querySelector('.cursor') &&
        !document.body.innerText.includes('生成中…')
      );
    },
    { timeout: 120000 },
    assistantCount,
  );

  await page.screenshot({ path: '../out/web-demo/chat.png' });
  const reply = await page.$$eval(
    '.message.assistant .message-text',
    (nodes) => nodes.at(-1)?.textContent ?? '',
  );
  console.log('chat reply:', reply.slice(0, 120));
  console.log('chat: ok');

  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '☰')
      ?.click();
  });
  await page.waitForSelector('.character-card');
  const characterCount = await page.$$eval('.character-card', (nodes) => nodes.length);
  console.log('characters:', characterCount);
  await page.screenshot({ path: '../out/web-demo/characters.png' });

  await page.type('.character-search', '雨夜');
  await page.waitForFunction(() => document.querySelectorAll('.character-card').length === 1);
  console.log('character search: ok');
  await page.$eval('.character-search', (input) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.character-card').length === 2);

  await page.evaluate(() => document.querySelector('.character-card')?.click());
  await page.waitForSelector('.composer textarea');

  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.remember-btn')];
    buttons.at(-1)?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('已加入长期记忆'));
  await page.screenshot({ path: '../out/web-demo/remembered.png' });
  console.log('remember: ok');

  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '记忆')
      ?.click();
  });
  await page.waitForSelector('.page-card');

  page.once('dialog', async (dialog) => {
    await dialog.accept('沈砚·改');
  });
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '改名')
      ?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('沈砚·改'));
  console.log('rename: ok');

  await page.evaluate(() => document.querySelector('.memory-edit-btn')?.click());
  await page.waitForSelector('.memory-edit textarea');
  await page.$eval('.memory-edit textarea', (textarea) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    ).set;
    setter.call(textarea, '');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.type('.memory-edit textarea', '手动编辑的记忆');
  await page.evaluate(() => document.querySelector('.memory-edit .primary')?.click());
  await page.waitForFunction(() => document.body.innerText.includes('手动编辑的记忆'));
  console.log('memory edit: ok');

  await page.screenshot({ path: '../out/web-demo/memory.png' });
  console.log('memory page: ok');

  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '设置')
      ?.click();
  });
  await page.waitForSelector('.field-grid');
  await page.screenshot({ path: '../out/web-demo/settings.png' });
  console.log('settings page: ok');

  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.message');
  const restoredCount = await page.$$eval('.message', (nodes) => nodes.length);
  const restoredHasQuestion = await page.evaluate(() =>
    document.body.innerText.includes('你还记得那把伞吗'),
  );
  console.log('persistence:', restoredCount, restoredHasQuestion);
  await page.screenshot({ path: '../out/web-demo/restored.png' });

  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '☰')
      ?.click();
  });
  await page.waitForSelector('.character-card');
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '新建角色')
      ?.click();
  });
  await page.waitForSelector('input[placeholder="比如：沈砚"]');
  await page.type('input[placeholder="比如：沈砚"]', '顾青');
  await page.type('input[placeholder="初识 / 暧昧 / 已在一起…"]', '初识');
  await page.type(
    'textarea[placeholder*="他是谁"]',
    '顾青是隔壁花店的老板，笑起来很暖。',
  );
  await page.type('textarea[placeholder*="创建后"]', '“今天也要买花吗？”');
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === '创建角色')
      ?.click();
  });
  await page.waitForFunction(
    () =>
      document.body.innerText.includes('顾青') &&
      document.body.innerText.includes('今天也要买花吗'),
  );
  await page.screenshot({ path: '../out/web-demo/created.png' });
  console.log('create character: ok');
} finally {
  await browser.close();
}
