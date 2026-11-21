import { importChat } from '../../../src/import/index.mjs';

import { API_BASE } from './config.js';

export async function parseImportFile(file) {
  const text = await file.text();
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    input = text;
  }
  return importChat(input);
}

export async function requestStoryBible(events, title) {
  const response = await fetch(`${API_BASE}/api/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events, title }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function importFile(file) {
  const result = await parseImportFile(file);
  if (result.selected.length === 0) {
    throw new Error('没有识别到选中的消息');
  }
  const title =
    result.selected[0]?.title || file.name.replace(/\.[^.]+$/, '') || '未命名故事';
  const bible = await requestStoryBible(result.selected, title);
  return { result, bible };
}
