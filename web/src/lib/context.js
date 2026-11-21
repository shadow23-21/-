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

function termWeight(term) {
  // Single Chinese characters are useful for queries like "伞" but noisy.
  return term.length === 1 && CJK.test(term) ? 0.3 : 1;
}

export function retrieve(events, query, options = {}) {
  const excludeLast = options.excludeLast ?? 8;
  const limit = options.limit ?? 6;
  const maxChars = options.maxChars ?? 4500;
  const pool = events.slice(0, Math.max(0, events.length - excludeLast));
  const queryTerms = [...new Set(tokenize(query))];

  if (queryTerms.length === 0 || pool.length === 0) return [];

  const documents = pool.map((event) => ({
    event,
    terms: new Set(tokenize(event.text)),
  }));
  const documentFrequency = new Map();
  for (const document of documents) {
    for (const term of document.terms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const total = documents.length;
  const averageLength =
    documents.reduce((sum, document) => sum + document.terms.size, 0) / total;
  const k1 = 1.2;
  const b = 0.75;

  const scored = documents
    .map((document, index) => {
      let score = 0;
      let matched = 0;
      for (const term of queryTerms) {
        if (!document.terms.has(term)) continue;
        const df = documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
        const lengthRatio = document.terms.size / Math.max(1, averageLength);
        const denominator = 1 + k1 * (1 - b + b * lengthRatio);
        score += termWeight(term) * idf * ((k1 + 1) / denominator);
        matched += 1;
      }
      const recency = index / Math.max(1, total - 1);
      return {
        event: document.event,
        matched,
        score: score + recency * 0.05,
      };
    })
    .filter((item) => item.matched > 0)
    .sort((left, right) => right.score - left.score);

  const selected = [];
  let chars = 0;
  for (const item of scored) {
    if (selected.length >= limit) break;
    if (chars + item.event.text.length > maxChars && selected.length >= 2) break;
    selected.push(item.event);
    chars += item.event.text.length;
  }

  return selected;
}

export function memoryLines(bible, query, limit = 8) {
  const memories = bible.memories ?? [];
  const queryTerms = [...new Set(tokenize(query))];
  const scored = memories
    .map((memory, index) => {
      const terms = new Set(tokenize(`${memory.kind} ${memory.text}`));
      let overlap = 0;
      for (const term of queryTerms) {
        if (terms.has(term)) overlap += termWeight(term);
      }
      return {
        memory,
        overlap,
        score:
          overlap / Math.sqrt(terms.size + 1) +
          memory.importance * 0.8 +
          (index / Math.max(1, memories.length)) * 0.05,
      };
    })
    .sort((left, right) => right.score - left.score);

  // Query matches first, then the most important core memories, then the rest.
  const core = [...memories]
    .sort((left, right) => right.importance - left.importance)
    .slice(0, Math.min(3, limit));
  const matched = scored
    .filter((item) => item.overlap > 0)
    .map((item) => item.memory);
  const merged = [];

  for (const memory of [...matched, ...core, ...scored.map((item) => item.memory)]) {
    if (!merged.includes(memory)) merged.push(memory);
    if (merged.length >= limit) break;
  }

  return merged;
}

export function estimateCostCNY(inputTokens, outputTokens = 300) {
  // DeepSeek V4.1 Flash off-peak list price, CNY per 1M tokens.
  return (
    (inputTokens / 1_000_000) * 1.56 +
    (outputTokens / 1_000_000) * 4.69
  );
}

function fitByChars(items, maxChars, lengthOf) {
  const selected = [];
  let chars = 0;
  for (const item of items) {
    const length = lengthOf(item);
    if (selected.length > 0 && chars + length > maxChars) break;
    selected.push(item);
    chars += length;
  }
  return selected;
}

export function buildContext({
  bible,
  events,
  messages,
  userText,
  maxRecent = 8,
  retrievalLimit = 6,
  memoryLimit = 8,
  contextBudgetTokens = 1500,
  estimatedOutputTokens = 300,
}) {
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

  const budgetChars = Math.max(0, Math.round(contextBudgetTokens * 2.2));
  const recent = messages.slice(-maxRecent).map((message) => ({
    role: message.role === 'user' ? 'user' : 'assistant',
    content: String(message.text ?? ''),
  }));

  let recentChars = recent.reduce((sum, message) => sum + message.content.length, 0);
  while (
    recent.length > 1 &&
    stable.length + recentChars + userText.length > budgetChars
  ) {
    recent.shift();
    recentChars = recent.reduce((sum, message) => sum + message.content.length, 0);
  }

  const remainingChars = Math.max(
    0,
    budgetChars - stable.length - recentChars - userText.length,
  );
  const memoryBudgetChars = Math.floor(remainingChars * 0.45);
  const retrievalBudgetChars = remainingChars - memoryBudgetChars;

  const memories = fitByChars(
    memoryLines(bible, userText, memoryLimit),
    memoryBudgetChars,
    (memory) => `- [${memory.kind}] ${memory.text}`.length,
  );
  const retrieved = fitByChars(
    retrieve(events, userText, {
      excludeLast: maxRecent,
      limit: retrievalLimit,
    }),
    retrievalBudgetChars,
    (event) => Math.min(220, String(event.text ?? '').length),
  );

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
    estimatedCostCNY: estimateCostCNY(estimatedInputTokens, estimatedOutputTokens),
    budgetUsedPct: Math.min(
      100,
      Math.round((estimatedInputTokens / Math.max(1, contextBudgetTokens)) * 100),
    ),
    options: {
      maxRecent,
      retrievalLimit,
      memoryLimit,
      contextBudgetTokens,
      estimatedOutputTokens,
    },
  };
}
