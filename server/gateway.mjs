import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deterministicBible,
  extractStoryBible,
} from '../src/memory/extract.mjs';
import {
  consumeCredit,
  getAccount,
  openBilling,
  redeemCode,
  refundCredit,
} from './billing.mjs';
import { normalizeChatRequest } from './chat-limits.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'web', 'dist');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const BILLING_DB = process.env.BILLING_DB || path.join(ROOT, 'data', 'billing.db');
const billing = openBilling(BILLING_DB);

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
]);

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    out[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return out;
}

const env = loadEnv(path.join(ROOT, '.env'));
// Docker/Railway inject secrets as process env; local dev uses .env.
if (process.env.DEEPSEEK_API_KEY) env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
if (process.env.ZHIPU_API_KEY) env.ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  response.end(body);
}

function bearerToken(request) {
  const header = request.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(DIST, relative);

  if (!resolved.startsWith(`${DIST}${path.sep}`) && resolved !== DIST) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  let file = resolved;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }

  if (!fs.existsSync(file)) {
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('web/dist 还没构建：先运行 cd web && npm run build');
    return;
  }

  const extension = path.extname(file);
  response.writeHead(200, {
    'Content-Type': MIME.get(extension) ?? 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(file).pipe(response);
}

async function handleExtract(request, response) {
  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch (error) {
    sendJson(response, 400, { error: `Invalid JSON: ${error.message}` });
    return;
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length === 0) {
    sendJson(response, 400, { error: 'No events to extract' });
    return;
  }

  try {
    const title = payload.title ?? '未命名故事';
    try {
      const bible = await extractStoryBible(events, {
        title,
        envFile: path.join(ROOT, '.env'),
        maxChars: Number(payload.maxChars ?? 12000),
        maxChunks: Number(payload.maxChunks ?? 12),
        provider: payload.provider ?? 'deepseek',
        fallbackProvider: payload.fallbackProvider ?? 'zhipu',
      });
      sendJson(response, 200, bible);
    } catch (error) {
      // A giant log should still be importable even if the LLM extraction
      // times out or gets rate-limited.
      const fallback = deterministicBible(events, { title });
      fallback.meta = {
        ...(fallback.meta ?? {}),
        fallback: true,
        fallbackReason: error.message,
      };
      sendJson(response, 200, fallback);
    }
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

async function handleRedeem(request, response) {
  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch (error) {
    sendJson(response, 400, { error: `Invalid JSON: ${error.message}` });
    return;
  }

  const token = bearerToken(request);
  const account = token ? getAccount(billing, token) : null;
  const result = redeemCode(billing, payload.code, account?.id ?? null);
  if (!result) {
    sendJson(response, 400, { error: '兑换码无效或已使用' });
    return;
  }
  sendJson(response, 200, {
    ...result,
    token: account ? token : result.token,
  });
}

function handleBalance(request, response) {
  const token = bearerToken(request);
  const account = getAccount(billing, token);
  if (!account) {
    sendJson(response, 401, { error: '账号 token 无效，请重新兑换' });
    return;
  }
  sendJson(response, 200, {
    credits: account.credits,
    expiresAt: account.expiresAt,
  });
}

async function handleChat(request, response) {
  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch (error) {
    sendJson(response, 400, { error: `Invalid JSON: ${error.message}` });
    return;
  }

  const managed = payload.managed === true;
  let account = null;
  if (managed) {
    const token = bearerToken(request) || payload.accountToken;
    account = getAccount(billing, token);
    if (!account) {
      sendJson(response, 401, { error: '账号 token 无效，请重新兑换' });
      return;
    }
    if (account.credits < 1) {
      sendJson(response, 402, { error: '额度不足，请先兑换', credits: 0 });
      return;
    }
  }

  const provider = payload.provider === 'zhipu' ? 'zhipu' : 'deepseek';
  // Non-managed requests must bring their own key; never fall back to the
  // server key, otherwise anyone can use our balance for free.
  const apiKey = managed
    ? provider === 'zhipu'
      ? env.ZHIPU_API_KEY
      : env.DEEPSEEK_API_KEY
    : payload.apiKey;
  if (!apiKey) {
    sendJson(response, managed ? 500 : 400, {
      error: `Missing API key for ${provider}. Put it in .env or the settings panel.`,
    });
    return;
  }

  const normalized = normalizeChatRequest(payload, provider);
  if (!normalized.ok) {
    sendJson(response, 400, { error: normalized.error });
    return;
  }

  let reserved = false;
  if (managed) {
    if (!consumeCredit(billing, account.id, 1)) {
      sendJson(response, 402, { error: '额度不足，请先兑换', credits: 0 });
      return;
    }
    reserved = true;
  }

  const upstreamUrl =
    provider === 'zhipu'
      ? 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
      : 'https://api.deepseek.com/chat/completions';

  const upstreamBody = {
    model: normalized.model,
    messages: normalized.messages,
    stream: true,
    temperature: normalized.temperature,
    max_tokens: normalized.maxTokens,
  };
  // Both DeepSeek V4+ and GLM default to thinking mode. For roleplay chat we
  // want the final answer, not a long reasoning trace.
  upstreamBody.thinking = { type: 'disabled' };

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (error) {
    if (reserved) refundCredit(billing, account.id, 1);
    sendJson(response, 502, { error: `Upstream fetch failed: ${error.message}` });
    return;
  }

  if (!upstream.ok) {
    const detail = await upstream.text();
    if (reserved) refundCredit(billing, account.id, 1);
    sendJson(response, upstream.status, { error: detail.slice(0, 1000) });
    return;
  }

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  response.flushHeaders?.();

  const reader = upstream.body.getReader();
  request.on('close', () => {
    reader.cancel().catch(() => {});
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      response.write(Buffer.from(value));
    }
  } catch {
    // Client disconnected or upstream aborted.
  } finally {
    response.end();
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    response.end();
    return;
  }

  if (url.pathname === '/api/health') {
    sendJson(response, 200, {
      ok: true,
      dist: fs.existsSync(DIST),
      provider: env.DEEPSEEK_API_KEY ? 'deepseek' : null,
      billing: fs.existsSync(BILLING_DB),
    });
    return;
  }

  if (url.pathname === '/api/redeem') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'POST required' });
      return;
    }
    await handleRedeem(request, response);
    return;
  }

  if (url.pathname === '/api/balance') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'GET required' });
      return;
    }
    handleBalance(request, response);
    return;
  }

  if (url.pathname === '/api/chat') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'POST required' });
      return;
    }
    await handleChat(request, response);
    return;
  }

  if (url.pathname === '/api/extract') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'POST required' });
      return;
    }
    await handleExtract(request, response);
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  serveStatic(request, response);
});

server.listen(PORT, HOST, () => {
  console.log(`whale-memory gateway: http://${HOST}:${PORT}`);
  console.log(`static: ${DIST}`);
});
