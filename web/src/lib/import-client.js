import { unzipSync } from 'fflate';

import { importChat } from '../../../src/import/index.mjs';

import { parseCharacterPack } from './character-pack.js';
import { API_BASE } from './config.js';

async function readInput(file) {
  const name = String(file.name ?? '').toLowerCase();

  if (name.endsWith('.zip') || file.type === 'application/zip') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = unzipSync(bytes);
    const conversationKey = Object.keys(entries).find((key) =>
      /(^|\/)(conversation|conversations)\.json$/i.test(key),
    );
    if (!conversationKey) {
      throw new Error('zip 里没有 conversation.json（官方导出解压后应有这个文件）');
    }
    const text = new TextDecoder().decode(entries[conversationKey]);
    return JSON.parse(text);
  }

  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function parseImportFile(file) {
  return importChat(await readInput(file));
}

export async function readCharacterPack(file) {
  const name = String(file.name ?? '').toLowerCase();
  if (name.endsWith('.zip')) return null;
  const text = await file.text();
  return parseCharacterPack(text);
}

export async function requestStoryBible(events, title, options = {}) {
  const response = await fetch(`${API_BASE}/api/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      events,
      title,
      maxChunks: Number(options.maxChunks ?? 12),
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function importFile(file, onStage = () => {}) {
  const result = await parseImportFile(file);
  if (result.selected.length === 0) {
    throw new Error('没有识别到选中的消息');
  }
  const title =
    result.selected[0]?.title || file.name.replace(/\.[^.]+$/, '') || '未命名故事';
  const chars = result.selected.reduce(
    (sum, event) => sum + String(event.text ?? '').length,
    0,
  );
  onStage({ stage: 'parsed', events: result.selected.length, chars });
  const bible = await requestStoryBible(result.selected, title, { maxChunks: 12 });
  onStage({ stage: 'extracted', events: result.selected.length, chars });
  return { result, bible };
}
