import fs from 'node:fs';

const SYSTEM_PROMPT = `你是一个长期角色扮演记忆整理器。你会读到一段用户与 AI 角色的对话记录，需要提取成可复用的 JSON 记忆。

只输出一个 JSON 对象，不要 markdown，不要解释。结构如下：
{
  "title": "故事标题",
  "persona": {
    "name": "角色名",
    "aliases": ["别名或称呼"],
    "age": "年龄或未知",
    "appearance": "外貌",
    "personality": ["性格关键词"],
    "speech_style": "说话风格",
    "background": "背景",
    "habits": ["习惯或口头禅"]
  },
  "relationship": {
    "stage": "关系阶段",
    "user_name": "用户角色名",
    "character_role": "角色在关系里的定位",
    "address_terms": {
      "user": ["角色怎么称呼用户"],
      "character": ["用户怎么称呼角色"]
    },
    "boundaries": ["雷区或禁忌"],
    "tensions": ["未解决的矛盾"]
  },
  "timeline": [
    { "when": "第几天或时间", "event": "发生了什么", "importance": 0.5 }
  ],
  "memories": [
    { "kind": "约定|称呼|心事|事件|喜好|禁忌|梗", "text": "要记住的事", "importance": 0.5 }
  ],
  "style_samples": ["最能代表角色语气的原文短句"],
  "open_threads": ["还没结束的线"]
}

要求：
- 只写对话里出现过的信息；不确定就写“未知”，不要编。
- memories 8-20 条，timeline 5-15 条，style_samples 3-8 条。
- importance 取 0-1。
- address_terms.user 是“角色对用户的称呼”，只填“你 / 林晚 / 宝贝”等，不要填角色自己的名字。
- address_terms.character 是“用户对角色的称呼”，只填“沈砚 / 沈医生”等，不要填“她 / 他 / 我”。
- 用中文输出。`;

export function loadEnv(file = '.env') {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

export function buildTranscript(events) {
  return events
    .map((event) => {
      const label =
        event.role === 'user' ? '用户' : event.speaker || event.role || '角色';
      return `${label}：${event.text}`;
    })
    .join('\n\n');
}

export function chunkEvents(events, maxChars = 12000) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const event of events) {
    const length = String(event.text ?? '').length;
    if (current.length > 0 && size + length > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(event);
    size += length;
    if (size >= maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function buildMessages(events, options = {}) {
  const title = options.title ?? '未命名故事';
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `标题：${title}\n\n对话记录：\n${buildTranscript(events)}`,
    },
  ];
}

export function parseJsonObject(text) {
  const cleaned = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('No JSON object in model output');
  }
}

const asArray = (value) =>
  Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
const asString = (value) =>
  typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
const asImportance = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0.5;
};
const uniqueStrings = (values) => [
  ...new Set(values.map((value) => String(value).trim()).filter(Boolean)),
];

export function normalizeBible(raw, options = {}) {
  const persona = raw?.persona ?? {};
  const relationship = raw?.relationship ?? {};
  const address = relationship.address_terms ?? {};
  const name = asString(persona.name) || '未知';
  const userTerms = uniqueStrings(asArray(address.user)).filter((term) => term !== name);
  const pronouns = new Set(['她', '他', '你', '我', '角色', '用户']);
  const characterTerms = uniqueStrings(asArray(address.character)).filter(
    (term) => !pronouns.has(term),
  );
  if (characterTerms.length === 0 && name !== '未知') characterTerms.push(name);

  return {
    title: asString(raw?.title) || options.title || '未命名故事',
    persona: {
      name,
      aliases: uniqueStrings(asArray(persona.aliases)),
      age: asString(persona.age) || '未知',
      appearance: asString(persona.appearance) || '未知',
      personality: uniqueStrings(asArray(persona.personality)),
      speech_style: asString(persona.speech_style) || '未知',
      background: asString(persona.background) || '未知',
      habits: uniqueStrings(asArray(persona.habits)),
    },
    relationship: {
      stage: asString(relationship.stage) || '未知',
      user_name: asString(relationship.user_name) || '未知',
      character_role: asString(relationship.character_role) || '未知',
      address_terms: {
        user: userTerms,
        character: characterTerms,
      },
      boundaries: uniqueStrings(asArray(relationship.boundaries)),
      tensions: uniqueStrings(asArray(relationship.tensions)),
    },
    timeline: asArray(raw?.timeline)
      .map((item) => ({
        when: asString(item?.when) || '未知时间',
        event: asString(item?.event),
        importance: asImportance(item?.importance),
      }))
      .filter((item) => item.event),
    memories: asArray(raw?.memories)
      .map((item) => ({
        kind: asString(item?.kind) || '事件',
        text: asString(item?.text),
        importance: asImportance(item?.importance),
      }))
      .filter((item) => item.text),
    style_samples: uniqueStrings(asArray(raw?.style_samples)).slice(0, 8),
    open_threads: uniqueStrings(asArray(raw?.open_threads)),
  };
}

function mergeUniqueObjects(left, right, key) {
  const seen = new Set(left.map((item) => item[key]));
  const merged = [...left];
  for (const item of right) {
    if (!seen.has(item[key])) {
      seen.add(item[key]);
      merged.push(item);
    }
  }
  return merged;
}

export function mergeBibles(bibles) {
  if (bibles.length === 0) throw new Error('No story bibles to merge');
  const merged = structuredClone(bibles[0]);

  for (const next of bibles.slice(1)) {
    if (!merged.title || merged.title === '未命名故事') merged.title = next.title;

    merged.persona.name =
      merged.persona.name !== '未知' ? merged.persona.name : next.persona.name;
    merged.persona.aliases = uniqueStrings([
      ...merged.persona.aliases,
      ...next.persona.aliases,
    ]);
    merged.persona.personality = uniqueStrings([
      ...merged.persona.personality,
      ...next.persona.personality,
    ]);
    merged.persona.habits = uniqueStrings([
      ...merged.persona.habits,
      ...next.persona.habits,
    ]);
    for (const field of ['age', 'appearance', 'speech_style', 'background']) {
      if (merged.persona[field] === '未知' && next.persona[field] !== '未知') {
        merged.persona[field] = next.persona[field];
      }
    }

    if (next.relationship.stage !== '未知') {
      merged.relationship.stage = next.relationship.stage;
    }
    if (merged.relationship.user_name === '未知' && next.relationship.user_name !== '未知') {
      merged.relationship.user_name = next.relationship.user_name;
    }
    if (
      merged.relationship.character_role === '未知' &&
      next.relationship.character_role !== '未知'
    ) {
      merged.relationship.character_role = next.relationship.character_role;
    }
    merged.relationship.address_terms.user = uniqueStrings([
      ...merged.relationship.address_terms.user,
      ...next.relationship.address_terms.user,
    ]);
    merged.relationship.address_terms.character = uniqueStrings([
      ...merged.relationship.address_terms.character,
      ...next.relationship.address_terms.character,
    ]);
    merged.relationship.boundaries = uniqueStrings([
      ...merged.relationship.boundaries,
      ...next.relationship.boundaries,
    ]);
    merged.relationship.tensions = uniqueStrings([
      ...merged.relationship.tensions,
      ...next.relationship.tensions,
    ]);

    merged.timeline = mergeUniqueObjects(merged.timeline, next.timeline, 'event');
    merged.memories = mergeUniqueObjects(merged.memories, next.memories, 'text');
    merged.style_samples = uniqueStrings([
      ...merged.style_samples,
      ...next.style_samples,
    ]).slice(0, 8);
    merged.open_threads = uniqueStrings([
      ...merged.open_threads,
      ...next.open_threads,
    ]);
  }

  return merged;
}

export function deterministicBible(events, options = {}) {
  const assistants = events.filter((event) => event.role === 'assistant');
  const counts = new Map();
  for (const event of assistants) {
    if (event.speaker) counts.set(event.speaker, (counts.get(event.speaker) ?? 0) + 1);
  }
  const name =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '角色';

  const keyword =
    /约定|答应|喜欢|讨厌|害怕|秘密|等你|对不起|谢谢|想你|别走|回来|第一次|以后/;
  const memories = [];
  for (const event of events) {
    if (memories.length >= 12) break;
    if (keyword.test(event.text)) {
      memories.push({
        kind: '事件',
        text: event.text.slice(0, 120),
        importance: 0.5,
      });
    }
  }

  const first = events[0];
  const last = events[events.length - 1];
  const bible = normalizeBible(
    {
      title: options.title ?? first?.title ?? '未命名故事',
      persona: {
        name,
        personality: [],
        speech_style: '未知',
        background: '未知',
      },
      relationship: { stage: '未知', user_name: '未知' },
      timeline: [
        {
          when: (first?.createdAt ?? first?.created_at ?? '').slice(0, 10),
          event: String(first?.text ?? '').slice(0, 80),
          importance: 0.5,
        },
        {
          when: (last?.createdAt ?? last?.created_at ?? '').slice(0, 10),
          event: String(last?.text ?? '').slice(0, 80),
          importance: 0.6,
        },
      ],
      memories,
      style_samples: assistants.slice(0, 3).map((event) => event.text.slice(0, 120)),
      open_threads: [],
    },
    options,
  );
  bible.meta = {
    source: 'deterministic',
    generatedAt: new Date().toISOString(),
  };
  return bible;
}

const PROVIDERS = {
  deepseek: {
    url: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-flash',
    envKey: 'DEEPSEEK_API_KEY',
  },
  zhipu: {
    url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4.7-flash',
    envKey: 'ZHIPU_API_KEY',
  },
};

async function callModel(messages, options = {}) {
  const provider = options.provider ?? 'deepseek';
  const config = PROVIDERS[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  const env = options.env ?? loadEnv(options.envFile ?? '.env');
  const apiKey = options.apiKey ?? process.env[config.envKey] ?? env[config.envKey];
  if (!apiKey) throw new Error(`${config.envKey} is missing`);

  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model ?? config.model,
      messages,
      max_tokens: options.maxTokens ?? 3000,
      temperature: 0.2,
      thinking: { type: 'disabled' },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${provider} ${response.status}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text);
  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) {
    const finish = data.choices?.[0]?.finish_reason;
    throw new Error(`${provider} returned empty content (finish=${finish})`);
  }
  return content;
}

async function callWithFallback(messages, options = {}) {
  const primary = options.provider ?? 'deepseek';
  const fallback =
    options.fallbackProvider ?? (primary === 'deepseek' ? 'zhipu' : 'deepseek');
  const providers = [...new Set([primary, fallback])];
  const env = loadEnv(options.envFile ?? '.env');
  let lastError;

  for (const provider of providers) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await callModel(messages, { ...options, provider, env });
      } catch (error) {
        lastError = error;
        // Only retry rate limits / upstream 5xx; missing key or bad request
        // should move straight to the fallback provider.
        if (!/\b(429|5\d\d)\b/.test(error.message)) break;
        await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

export async function extractStoryBible(events, options = {}) {
  if (events.length === 0) throw new Error('No events to extract');
  if (options.noLlm) return deterministicBible(events, options);

  const provider = options.provider ?? 'deepseek';
  const model = options.model ?? PROVIDERS[provider]?.model;
  const title = options.title ?? events[0]?.title ?? '未命名故事';
  const chunks = chunkEvents(events, options.maxChars ?? 12000);
  const bibles = [];

  for (const chunk of chunks) {
    const content = await callWithFallback(buildMessages(chunk, { title }), {
      ...options,
      provider,
    });
    bibles.push(normalizeBible(parseJsonObject(content), { title }));
  }

  const merged = mergeBibles(bibles);
  merged.meta = {
    source: 'llm',
    provider,
    model,
    chunks: chunks.length,
    generatedAt: new Date().toISOString(),
  };
  return merged;
}
