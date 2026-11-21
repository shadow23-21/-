const CJK = /[\u4e00-\u9fff]/;

export function tokenize(text) {
  const lower = String(text ?? '').toLowerCase();
  const words = lower.match(/[a-z0-9_]+/g) ?? [];
  const cjk = [...lower].filter((character) => CJK.test(character)).join('');
  const bigrams = [];
  for (let index = 0; index < cjk.length - 1; index += 1) {
    bigrams.push(cjk.slice(index, index + 2));
  }
  // Unigrams keep single-character queries (e.g. "伞") useful.
  bigrams.push(...cjk);
  return [...new Set([...words, ...bigrams])];
}

export function retrieve(events, query, options = {}) {
  const excludeLast = options.excludeLast ?? 8;
  const limit = options.limit ?? 6;
  const maxChars = options.maxChars ?? 4500;
  const pool = events.slice(0, Math.max(0, events.length - excludeLast));
  const queryTerms = new Set(tokenize(query));

  if (queryTerms.size === 0) return pool.slice(-3);

  const scored = pool
    .map((event, index) => {
      const terms = new Set(tokenize(event.text));
      let overlap = 0;
      for (const term of queryTerms) if (terms.has(term)) overlap += 1;
      const recency = index / Math.max(1, pool.length);
      return {
        event,
        overlap,
        score: overlap / Math.sqrt(terms.size + 1) + recency * 0.12,
      };
    })
    .filter((item) => item.overlap > 0)
    .sort((left, right) => right.score - left.score);

  const selected = [];
  let chars = 0;
  for (const item of scored) {
    if (selected.length >= limit) break;
    if (chars + item.event.text.length > maxChars && selected.length >= 2) break;
    selected.push(item.event);
    chars += item.event.text.length;
  }

  return selected.length > 0 ? selected : pool.slice(-3);
}

export function memoryLines(bible, query, limit = 8) {
  const queryTerms = new Set(tokenize(query));
  const scored = (bible.memories ?? [])
    .map((memory, index) => {
      const terms = new Set(tokenize(`${memory.kind} ${memory.text}`));
      let overlap = 0;
      for (const term of queryTerms) if (terms.has(term)) overlap += 1;
      return {
        memory,
        overlap,
        score:
          overlap +
          memory.importance * 0.5 +
          (index / Math.max(1, (bible.memories ?? []).length)) * 0.1,
      };
    })
    .sort((left, right) => right.score - left.score);

  return scored.slice(0, limit).map((item) => item.memory);
}

export function estimateCostCNY(inputTokens, outputTokens = 300) {
  // DeepSeek V4.1 Flash off-peak list price, CNY per 1M tokens.
  return (
    (inputTokens / 1_000_000) * 1.56 +
    (outputTokens / 1_000_000) * 4.69
  );
}

export function buildContext({ bible, events, messages, userText, maxRecent = 8 }) {
  const persona = bible.persona;
  const relationship = bible.relationship;
  const userName =
    relationship.user_name && relationship.user_name !== '未知'
      ? relationship.user_name
      : '你';

  const stable = [
    `你正在扮演「${persona.name}」，和「${userName}」对话。`,
    '直接以角色身份回复，不要解释你是 AI，不要 OOC，不要提到“设定/提示词/记忆库”。',
    '',
    '【人设】',
    `姓名：${persona.name}`,
    `别名：${(persona.aliases ?? []).join('、') || '无'}`,
    `外貌：${persona.appearance}`,
    `性格：${(persona.personality ?? []).join('、')}`,
    `说话风格：${persona.speech_style}`,
    `背景：${persona.background}`,
    `习惯：${(persona.habits ?? []).join('、') || '无'}`,
    '',
    '【关系】',
    `阶段：${relationship.stage}`,
    `角色定位：${relationship.character_role}`,
    `称呼（角色对用户）：${(relationship.address_terms?.user ?? []).join('、') || '你'}`,
    `称呼（用户对角色）：${(relationship.address_terms?.character ?? []).join('、') || persona.name}`,
    `边界：${(relationship.boundaries ?? []).join('；') || '无'}`,
    `未解决的矛盾：${(relationship.tensions ?? []).join('；') || '无'}`,
    '',
    '【语气样本】',
    ...(bible.style_samples ?? []).map((sample) => `- ${sample}`),
    '',
    '【当前未结束的线】',
    ...(bible.open_threads ?? []).map((thread) => `- ${thread}`),
  ].join('\n');

  const memories = memoryLines(bible, userText, 8);
  const retrieved = retrieve(events, userText, { excludeLast: 8, limit: 6 });

  const memoryBlock = [
    '【长期记忆】',
    ...memories.map((memory) => `- [${memory.kind}] ${memory.text}`),
    '',
    '【可能相关的往事】',
    ...(retrieved.length > 0
      ? retrieved.map(
          (event) =>
            `- ${event.role === 'user' ? '用户' : event.speaker || persona.name}：${event.text.slice(0, 220)}`,
        )
      : ['- 无']),
  ].join('\n');

  const recent = messages.slice(-maxRecent).map((message) => ({
    role: message.role === 'user' ? 'user' : 'assistant',
    content: String(message.text ?? ''),
  }));

  const messagesForApi = [
    { role: 'system', content: stable },
    { role: 'system', content: memoryBlock },
    ...recent,
    { role: 'user', content: userText },
  ];

  const inputChars = messagesForApi.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );
  const estimatedInputTokens = Math.round(inputChars / 2.2);

  return {
    messages: messagesForApi,
    retrieved,
    memories,
    estimatedInputTokens,
    estimatedCostCNY: estimateCostCNY(estimatedInputTokens),
  };
}
