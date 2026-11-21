export const CHARACTER_PACK_FORMAT = 'whale-memory-character';

export function createCharacterPack({ character, name, title, source }) {
  return {
    format: CHARACTER_PACK_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    character: {
      name: name ?? character.name,
      title: title ?? character.title,
      source: source ?? character.source,
      bible: character.bible,
      events: character.events ?? [],
      messages: (character.messages ?? []).map(({ pending, ...message }) => message),
    },
  };
}

export function parseCharacterPack(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (payload?.format !== CHARACTER_PACK_FORMAT || !payload.character?.bible) {
    return null;
  }
  const character = payload.character;
  return {
    name: String(character.name ?? character.bible?.persona?.name ?? '角色'),
    title: String(character.title ?? character.bible?.title ?? '未命名故事'),
    source: String(character.source ?? 'imported'),
    bible: character.bible,
    events: Array.isArray(character.events) ? character.events : [],
    messages: Array.isArray(character.messages) ? character.messages : [],
  };
}

export function downloadCharacterPack(pack, filename) {
  const blob = new Blob([`${JSON.stringify(pack, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
