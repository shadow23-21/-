const RULES = [
  {
    kind: '喜好',
    importance: 0.75,
    pattern:
      /(?:我|人家)(?:最)?(?:喜欢|爱|讨厌|不喜欢|害怕|受不了)([^。！？!?，,、；;\n]{2,24})/gu,
  },
  {
    kind: '设定',
    importance: 0.85,
    pattern: /(?:我叫|我的名字是|我姓|我的生日是|我是)([^。！？!?，,、；;\n]{1,24})/gu,
  },
  {
    kind: '约定',
    importance: 0.8,
    pattern: /(?:我们|你|他|她)?(?:约定|答应|说好|约好)([^。！？!?，,、；;\n]{2,40})/gu,
  },
  {
    kind: '事件',
    importance: 0.65,
    pattern: /(?:第一次|上次|那天|后来)([^。！？!?，,、；;\n]{4,50})/gu,
  },
];

function clean(value) {
  return String(value ?? '')
    .replace(/^[，,、：:\s]+/, '')
    .replace(/[，,、：:\s]+$/, '')
    .trim();
}

export function extractAutoMemories(text) {
  const source = String(text ?? '');
  const found = [];
  const seen = new Set();

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(source)) !== null) {
      const fragment = clean(match[1]);
      if (fragment.length < 2 || fragment.length > 60) continue;
      if (/^[你他她它这那]/.test(fragment) && fragment.length < 4) continue;
      const key = `${rule.kind}|${fragment}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        kind: rule.kind,
        text: fragment,
        importance: rule.importance,
        source: 'auto',
      });
    }
  }

  return found;
}

export function memoryExists(memories, candidate) {
  const text = String(candidate?.text ?? '').trim();
  if (!text) return true;
  return (memories ?? []).some((memory) => {
    const existing = String(memory.text ?? '').trim();
    return existing === text || existing.includes(text) || text.includes(existing);
  });
}
