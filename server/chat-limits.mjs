export const CHAT_LIMITS = {
  maxMessages: 12,
  maxMessageChars: 2400,
  maxTotalChars: 6000,
  maxOutputTokens: 500,
};

const MODELS = {
  deepseek: new Set(['deepseek-flash']),
  zhipu: new Set(['glm-4.7-flash']),
};

export function normalizeChatRequest(payload, provider = 'deepseek') {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: '请求格式错误' };
  }

  const kind = provider === 'zhipu' ? 'zhipu' : 'deepseek';
  const defaultModel = kind === 'zhipu' ? 'glm-4.7-flash' : 'deepseek-flash';
  const requestedModel =
    typeof payload.model === 'string' && payload.model.trim()
      ? payload.model.trim()
      : defaultModel;

  if (!MODELS[kind].has(requestedModel)) {
    return { ok: false, error: '不支持这个模型' };
  }

  const rawMessages = payload.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return { ok: false, error: '消息不能为空' };
  }
  if (rawMessages.length > CHAT_LIMITS.maxMessages) {
    return { ok: false, error: `一次最多 ${CHAT_LIMITS.maxMessages} 条消息` };
  }

  let totalChars = 0;
  const messages = [];
  for (const raw of rawMessages) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: '消息格式错误' };
    }
    const role = ['system', 'user', 'assistant'].includes(raw.role)
      ? raw.role
      : 'user';
    const content = String(raw.content ?? '');
    if (!content.trim()) {
      return { ok: false, error: '消息不能为空' };
    }
    if (content.length > CHAT_LIMITS.maxMessageChars) {
      return {
        ok: false,
        error: `单条消息最多 ${CHAT_LIMITS.maxMessageChars} 字，请分段发送`,
      };
    }
    totalChars += content.length;
    messages.push({ role, content });
  }

  if (totalChars > CHAT_LIMITS.maxTotalChars) {
    return {
      ok: false,
      error: `上下文最多 ${CHAT_LIMITS.maxTotalChars} 字，请精简后重试`,
    };
  }

  const requestedMax = Number(payload.maxTokens);
  const maxTokens = Math.min(
    CHAT_LIMITS.maxOutputTokens,
    Math.max(1, Number.isFinite(requestedMax) && requestedMax > 0 ? requestedMax : 400),
  );
  const requestedTemp = Number(payload.temperature);
  const temperature = Math.min(
    2,
    Math.max(0, Number.isFinite(requestedTemp) ? requestedTemp : 0.9),
  );

  return { ok: true, messages, model: requestedModel, maxTokens, temperature };
}
