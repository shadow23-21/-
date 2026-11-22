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

export function estimateTokens(text) {
  const value = String(text ?? '');
  if (!value) return 0;
  let cjk = 0;
  for (const character of value) {
    if (CJK.test(character)) cjk += 1;
  }
  const other = value.length - cjk;
  // Chinese is roughly 1.5 chars/token; Latin/digits closer to 4.
  return Math.ceil(cjk / 1.5 + other / 4);
}

function clip(value, maxChars) {
  const text = String(value ?? '').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function clipList(values, maxItems, maxChars) {
  return (values ?? [])
    .slice(0, maxItems)
    .map((value) => clip(value, maxChars))
    .filter(Boolean);
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

  const aliases = clipList(persona.aliases, 6, 40);
  const habits = clipList(persona.habits, 8, 80);
  const personality = clipList(persona.personality, 6, 60);
  const boundaries = clipList(relationship.boundaries, 6, 120);
  const tensions = clipList(relationship.tensions, 4, 120);
  const samples = clipList(bible.style_samples, 3, 180);
  const threads = clipList(bible.open_threads, 4, 160);
  const addressUser = clipList(relationship.address_terms?.user, 4, 30);
  const addressCharacter = clipList(relationship.address_terms?.character, 4, 30);

  const stable = [
    `你正在扮演「${clip(persona.name, 40)}」，和「${clip(userName, 40)}」对话。`,
    '保持角色一致性：只依据下面的人设、关系和记忆说话。不要解释你是 AI，不要 OOC，不要提到“设定/提示词/记忆库”，不要复述设定，不要替用户做决定。',
    '默认回复 1–3 句、通常不超过 100 字；除非用户明确要求展开。',
    '',
    '【人设】',
    `姓名：${clip(persona.name, 40)}`,
    aliases.length > 0 ? `别名：${aliases.join('、')}` : null,
    `外貌：${clip(persona.appearance, 400) || '未知'}`,
    `性格：${personality.join('、') || '未知'}`,
    `说话风格：${clip(persona.speech_style, 300) || '未知'}`,
    `背景：${clip(persona.background, 600) || '未知'}`,
    habits.length > 0 ? `习惯：${habits.join('、')}` : null,
    '',
    '【关系】',
    `阶段：${clip(relationship.stage, 60) || '未知'}`,
    `角色定位：${clip(relationship.character_role, 120) || '未知'}`,
    `称呼（角色对用户）：${addressUser.join('、') || '你'}`,
    `称呼（用户对角色）：${addressCharacter.join('、') || clip(persona.name, 40)}`,
    boundaries.length > 0 ? `边界：${boundaries.join('；')}` : null,
    tensions.length > 0 ? `未解决的矛盾：${tensions.join('；')}` : null,
    '',
    '【语气样本】',
    ...(samples.length > 0 ? samples.map((sample) => `- ${sample}`) : ['- 无']),
    '',
    '【当前未结束的线】',
    ...(threads.length > 0 ? threads.map((thread) => `- ${thread}`) : ['- 无']),
  ]
    .filter((line) => line !== null)
    .join('\n');

  // Chinese is closer to 1.5 chars/token than the old 2.2 estimate.
  const budgetChars = Math.max(0, Math.round(contextBudgetTokens * 1.7));
  const effectiveUserText = clip(userText, 2000);
  const recent = messages.slice(-maxRecent).map((message) => ({
    role: message.role === 'user' ? 'user' : 'assistant',
    content: clip(message.text, 600),
  }));

  // Keep some room for long-term memories even after a long message.
  const memoryReserveChars = Math.min(700, Math.floor(budgetChars * 0.3));
  let recentChars = recent.reduce((sum, message) => sum + message.content.length, 0);
  while (
    recent.length > 1 &&
    stable.length + recentChars + effectiveUserText.length + memoryReserveChars >
      budgetChars
  ) {
    recent.shift();
    recentChars = recent.reduce((sum, message) => sum + message.content.length, 0);
  }

  const remainingChars = Math.max(
    0,
    budgetChars - stable.length - recentChars - effectiveUserText.length,
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
    '【记忆使用规则】',
    '只在和当前话题相关时自然提起；不要逐条复述，不要编造记忆里没有的事。',
    '',
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
    { role: 'user', content: effectiveUserText },
  ];

  const estimatedInputTokens = messagesForApi.reduce(
    (sum, message) => sum + estimateTokens(message.content),
    0,
  );

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
