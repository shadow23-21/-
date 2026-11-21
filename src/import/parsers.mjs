const ROLE_MAP = new Map([
  ['user', 'user'],
  ['human', 'user'],
  ['assistant', 'assistant'],
  ['ai', 'assistant'],
  ['bot', 'assistant'],
  ['system', 'system'],
  ['narrator', 'narrator'],
]);

export function normalizeRole(value, fallback = 'assistant') {
  if (typeof value !== 'string') return fallback;
  return ROLE_MAP.get(value.toLowerCase()) ?? fallback;
}

const FALLBACK_START = Date.UTC(2026, 0, 1, 0, 0, 0);

export function toIso(value, index = 0) {
  if (value === null || value === undefined || value === '') {
    return new Date(FALLBACK_START + index * 1000).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date(FALLBACK_START + index * 1000).toISOString();
  }
  return date.toISOString();
}

function contentToText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => (typeof part === 'string' ? part : part?.text ?? ''))
      .join('\n');
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.parts)) return value.parts.map(String).join('\n');
    if (typeof value.text === 'string') return value.text;
  }
  return String(value);
}

export function parseDeepSeekOfficial(data) {
  const events = [];
  const conversations = Array.isArray(data?.conversations) ? data.conversations : [];

  for (const conversation of conversations) {
    const conversationId = String(
      conversation.id ?? conversation.conversation_id ?? `conversation-${events.length}`,
    );
    const messages = conversation.messages ?? conversation.chat_messages ?? [];

    for (const message of messages) {
      const id = String(message.message_id ?? message.id ?? `official-${events.length + 1}`);
      events.push({
        id,
        conversationId,
        parentId:
          message.parent_id !== undefined && message.parent_id !== null
            ? String(message.parent_id)
            : undefined,
        role: normalizeRole(message.role),
        speaker: message.speaker ?? message.name ?? undefined,
        text: contentToText(message.content ?? message.text),
        createdAt: toIso(message.created_at ?? message.createdAt, events.length),
        branchId: message.branch_group ?? message.branchId ?? undefined,
        selected: message.selected !== false,
        source: 'deepseek-official',
      });
    }
  }

  return events;
}

export function parseDeepSeekTree(data) {
  const conversationId = String(data?.chat_session?.id ?? 'deepseek-tree');
  const messages = Array.isArray(data?.chat_messages) ? data.chat_messages : [];
  const nodes = messages.map((message, index) => ({
    ...message,
    id: String(message.message_id ?? message.id ?? `tree-${index + 1}`),
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selected = new Set();

  const hasExplicitSelection = nodes.some((node) => typeof node.selected === 'boolean');
  if (hasExplicitSelection) {
    for (const node of nodes) {
      if (node.selected !== false) selected.add(node.id);
    }
  } else {
    const roots = nodes.filter(
      (node) => !node.parent_id || !byId.has(String(node.parent_id)),
    );
    for (const root of roots) {
      let current = root;
      const seen = new Set();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        selected.add(current.id);
        const children = (current.children ?? []).map(String);
        current = children.length ? byId.get(children[children.length - 1]) : null;
      }
    }
  }

  return nodes.map((node, index) => ({
    id: node.id,
    conversationId,
    parentId:
      node.parent_id !== undefined && node.parent_id !== null
        ? String(node.parent_id)
        : undefined,
    role: normalizeRole(node.role),
    speaker: node.speaker ?? node.name ?? undefined,
    text: contentToText(node.content ?? node.text),
    createdAt: toIso(node.created_at ?? node.createdAt, index),
    selected: selected.has(node.id),
    source: 'deepseek-tree',
  }));
}

export function parseChatGPT(data) {
  const events = [];

  for (const [conversationId, conversation] of Object.entries(data ?? {})) {
    const mapping = conversation?.mapping;
    if (!mapping || typeof mapping !== 'object') continue;

    const nodes = Object.entries(mapping).map(([id, node]) => ({ id, node }));
    const byId = new Map(nodes.map((entry) => [entry.id, entry]));
    const selected = new Set();
    const currentNode = conversation.current_node;

    if (currentNode && byId.has(currentNode)) {
      let cursor = currentNode;
      while (cursor && byId.has(cursor)) {
        selected.add(cursor);
        cursor = byId.get(cursor).node.parent;
      }
    } else {
      const roots = nodes.filter(
        ({ node }) => !node.parent || !byId.has(node.parent),
      );
      for (const root of roots) {
        let cursor = root.id;
        while (cursor && byId.has(cursor)) {
          selected.add(cursor);
          const children = byId.get(cursor).node.children ?? [];
          cursor = children[0];
        }
      }
    }

    for (const { id, node } of nodes) {
      const message = node.message;
      if (!message) continue;
      events.push({
        id,
        conversationId: String(conversationId),
        parentId: node.parent ? String(node.parent) : undefined,
        role: normalizeRole(message.author?.role),
        speaker: message.author?.name ?? undefined,
        text: contentToText(message.content),
        createdAt: toIso(message.create_time, events.length),
        selected: selected.has(id),
        source: 'chatgpt',
      });
    }
  }

  return events;
}

export function parseSillyTavern(input) {
  const rows = Array.isArray(input)
    ? input
    : String(input)
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

  let parentId;
  return rows.map((row, index) => {
    const id = String(row.id ?? `st-${index + 1}`);
    const event = {
      id,
      conversationId: String(row.chat_id ?? 'sillytavern'),
      parentId,
      role: row.is_user === true ? 'user' : normalizeRole(row.role ?? 'assistant'),
      speaker: row.name ?? undefined,
      text: contentToText(row.mes ?? row.message ?? row.text),
      createdAt: toIso(row.send_date ?? row.createdAt, index),
      selected: true,
      source: 'sillytavern',
    };
    parentId = id;
    return event;
  });
}

export function parsePlainText(text, options = {}) {
  const userNames = new Set(
    options.userNames ?? ['我', '林晚', '用户', 'User', 'user'],
  );
  const lines = String(text).split(/\r?\n/);

  // Plain text has no schema: infer the main speakers from line-prefix counts
  // so an embedded line like "顾青：..." inside an assistant paragraph does not
  // become a separate message.
  const counts = new Map();
  for (const line of lines) {
    const match = line.match(/^([^：:]{1,24})[：:]\s*/);
    if (!match) continue;
    const name = match[1].trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const maxCount = Math.max(0, ...counts.values());
  const threshold = Math.max(2, maxCount * 0.2);
  const known = new Set(options.speakers ?? []);
  if (known.size === 0) {
    for (const [name, count] of counts) {
      if (count >= threshold) known.add(name);
    }
    if (known.size === 0) {
      for (const name of counts.keys()) known.add(name);
    }
  }
  for (const name of userNames) known.add(name);

  const events = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^([^：:]{1,24})[：:]\s*(.*)$/);
    if (match && known.has(match[1].trim())) {
      const speaker = match[1].trim();
      const event = {
        id: `pt-${events.length + 1}`,
        conversationId: 'plaintext',
        parentId: events.length ? events[events.length - 1].id : undefined,
        role: userNames.has(speaker) ? 'user' : 'assistant',
        speaker,
        text: match[2],
        createdAt: toIso(null, events.length),
        selected: true,
        source: 'plaintext',
      };
      events.push(event);
      current = event;
    } else if (current && line.trim()) {
      current.text += `\n${line}`;
    }
  }

  if (events.length === 0) {
    throw new Error('No "Name: text" lines found in plain text');
  }

  return events;
}
