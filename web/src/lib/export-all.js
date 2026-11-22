import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { strToU8, unzipSync, zipSync } from 'fflate';

import { createCharacterPack } from './character-pack.js';

export const EXPORT_FORMAT = 'whale-memory-export';

function safeName(value, fallback) {
  const name = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return name.slice(0, 40) || fallback;
}

function transcript(character) {
  const bible = character.bible ?? {};
  const persona = bible.persona ?? {};
  const relationship = bible.relationship ?? {};
  const lines = [
    `# ${character.name || persona.name || '角色'}`,
    character.title || bible.title || '',
    '',
    '## 人设',
    `别名：${(persona.aliases ?? []).join('、') || '无'}`,
    `年龄：${persona.age ?? '未知'}`,
    `外貌：${persona.appearance ?? '未知'}`,
    `性格：${(persona.personality ?? []).join('、') || '未知'}`,
    `说话：${persona.speech_style ?? '未知'}`,
    `背景：${persona.background ?? '未知'}`,
    `习惯：${(persona.habits ?? []).join('、') || '无'}`,
    '',
    '## 关系',
    `阶段：${relationship.stage ?? '未知'}`,
    `定位：${relationship.character_role ?? '未知'}`,
    `角色对你的称呼：${(relationship.address_terms?.user ?? []).join('、') || '你'}`,
    `你对角色的称呼：${(relationship.address_terms?.character ?? []).join('、') || '角色'}`,
    `边界：${(relationship.boundaries ?? []).join('；') || '无'}`,
    `未解决：${(relationship.tensions ?? []).join('；') || '无'}`,
    '',
    '## 长期记忆',
    ...(bible.memories ?? []).map((memory) => `- [${memory.kind}] ${memory.text}`),
    '',
    '## 对话',
    ...(character.messages ?? []).map((message) => {
      const who =
        message.role === 'user'
          ? relationship.user_name || '你'
          : message.speaker || character.name || '角色';
      const at = message.createdAt ? `[${message.createdAt}] ` : '';
      return `${at}${who}：${message.text}`;
    }),
    '',
  ];
  return lines.join('\n');
}

export function buildExportBundle({ characters, exportedAt = new Date().toISOString() }) {
  const files = {};
  const manifest = {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt,
    characters: characters.map((character) => ({
      name: character.name,
      title: character.title,
      source: character.source,
      bible: character.bible,
      events: character.events ?? [],
      messages: character.messages ?? [],
    })),
  };

  files['whale-memory-export.json'] = strToU8(
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  files['README.txt'] = strToU8(
    [
      '鲸忆全量导出',
      '',
      `导出时间：${exportedAt}`,
      `角色数：${characters.length}`,
      '',
      'whale-memory-export.json：完整数据，可以再导入鲸忆。',
      'characters/：每个角色一份 JSON 角色包 + 一份可读 txt 聊天记录。',
      '',
      '这个压缩包包含你的角色设定和聊天记录，请自己保管。',
      '',
    ].join('\n'),
  );

  characters.forEach((character, index) => {
    const base = `${String(index + 1).padStart(2, '0')}-${safeName(
      character.name,
      'character',
    )}`;
    files[`characters/${base}.json`] = strToU8(
      `${JSON.stringify(createCharacterPack({ character }), null, 2)}\n`,
    );
    files[`characters/${base}.txt`] = strToU8(transcript(character));
  });

  return zipSync(files, { level: 6 });
}

export function parseExportPayload(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (payload?.format !== EXPORT_FORMAT || !Array.isArray(payload.characters)) {
    return null;
  }
  return {
    exportedAt: payload.exportedAt,
    characters: payload.characters
      .filter((character) => character?.bible)
      .map((character) => ({
        name: String(character.name ?? character.bible?.persona?.name ?? '角色'),
        title: String(character.title ?? character.bible?.title ?? '未命名故事'),
        source: String(character.source ?? 'imported'),
        bible: character.bible,
        events: Array.isArray(character.events) ? character.events : [],
        messages: Array.isArray(character.messages) ? character.messages : [],
      })),
  };
}

export async function readExportBundle(file) {
  const name = String(file?.name ?? '').toLowerCase();
  if (name.endsWith('.zip') || file?.type === 'application/zip') {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const key = Object.keys(entries).find((entry) =>
      entry.endsWith('whale-memory-export.json'),
    );
    if (!key) return null;
    return parseExportPayload(new TextDecoder().decode(entries[key]));
  }

  const text = await file.text();
  return parseExportPayload(text);
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export async function downloadExportBundle(bytes, filename) {
  if (Capacitor.isNativePlatform()) {
    const result = await Filesystem.writeFile({
      path: filename,
      data: bytesToBase64(bytes),
      directory: Directory.Cache,
    });
    await Share.share({
      title: '鲸忆导出',
      text: '鲸忆全量导出',
      url: result.uri,
      dialogTitle: '保存或分享导出文件',
    });
    return;
  }

  const blob = new Blob([bytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
