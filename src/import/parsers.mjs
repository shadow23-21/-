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

function fragmentsToText(fragments, role) {
  const preferred = role === 'user' ? 'REQUEST' : 'RESPONSE';
  const picked = fragments.filter((fragment) => fragment && fragment.type === preferred);
  const fallback = fragments.filter((fragment) => fragment && fragment.type !== 'THINK');
  return (picked.length > 0 ? picked : fallback)
    .map((fragment) => String(fragment.content ?? ''))
    .filter(Boolean)
    .join('\n');
}

function fragmentsToThinking(fragments) {
  return fragments
    .filter((fragment) => fragment && fragment.type === 'THINK')
    .map((fragment) => String(fragment.content ?? ''))
    .filter(Boolean)
    .join('\n');
}

function longestPath(rootId, byId, children) {
  let best = [];
  const stack = [[rootId, [rootId]]];
  while (stack.length > 0) {
    const [id, path] = stack.pop();
    if (path.length > best.length) best = path;
    for (const childId of children.get(id) ?? []) {
      if (!path.includes(childId)) {
        stack.push([childId, [...path, childId]]);
      }
    }
  }
  return best;
}

function collectRawSessions(value, out = [], seen = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return out;

  if (Array.isArray(value)) {
    for (const item of value) collectRawSessions(item, out, seen, depth + 1);
    return out;
  }

  if (value.data && typeof value.data === 'object') {
    collectRawSessions(value.data, out, seen, depth + 1);
    return out;
  }

  if (value.biz_data && typeof value.biz_data === 'object') {
    collectRawSessions(value.biz_data, out, seen, depth + 1);
    return out;
  }

  if (value.chat_session && Array.isArray(value.chat_messages)) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
    return out;
  }

  if (Array.isArray(value.conversations)) {
    for (const item of value.conversations) {
      collectRawSessions(item, out, seen, depth + 1);
    }
    return out;
  }

  for (const item of Object.values(value)) {
    if (item && typeof item === 'object') collectRawSessions(item, out, seen, depth + 1);
  }
  return out;
}

/**
 * Parse DeepSeek's RAW conversation shape:
 * { data: { biz_data: { chat_session, chat_messages } } }
 * or an array/map of the same shape (official export conversation.json).
 */
export function parseDeepSeekRaw(input) {
  const sessions = collectRawSessions(input);
  const events = [];

  for (const session of sessions) {
    const info = session.chat_session ?? {};
    const conversationId = String(info.id ?? `deepseek-raw-${events.length}`);
    const messages = Array.isArray(session.chat_messages) ? session.chat_messages : [];
    const byId = new Map(
      messages.map((message) => [String(message.message_id), message]),
    );
    const children = new Map();

    for (const message of messages) {
      const parentId =
        message.parent_id === null || message.parent_id === undefined
          ? null
          : String(message.parent_id);
      if (parentId && byId.has(parentId)) {
        if (!children.has(parentId)) children.set(parentId, []);
        children.get(parentId).push(String(message.message_id));
      }
    }

    const roots = messages.filter((message) => {
      const parentId =
        message.parent_id === null || message.parent_id === undefined
          ? null
          : String(message.parent_id);
      return !parentId || !byId.has(parentId);
    });

    const selected = new Set();
    const currentId =
      info.current_message_id !== null && info.current_message_id !== undefined
        ? String(info.current_message_id)
        : null;

    let currentRootId = null;
    if (currentId && byId.has(currentId)) {
      let cursor = currentId;
      const path = [];
      const seen = new Set();
      while (cursor && byId.has(cursor) && !seen.has(cursor)) {
        seen.add(cursor);
        path.push(cursor);
        const node = byId.get(cursor);
        cursor =
          node.parent_id === null || node.parent_id === undefined
            ? null
            : String(node.parent_id);
      }
      for (const id of path) selected.add(id);
      currentRootId = path[path.length - 1];
    }

    for (const root of roots) {
      const rootId = String(root.message_id);
      if (rootId === currentRootId) continue;
      for (const id of longestPath(rootId, byId, children)) selected.add(id);
    }

    for (const message of messages) {
      const id = String(message.message_id);
      const role = normalizeRole(message.role);
      const fragments = Array.isArray(message.fragments) ? message.fragments : [];
      const text = fragmentsToText(fragments, role);
      const thinking = fragmentsToThinking(fragments);

      events.push({
        id,
        conversationId,
        parentId:
          message.parent_id === null || message.parent_id === undefined
            ? undefined
            : String(message.parent_id),
        role,
        speaker: message.speaker ?? message.name ?? undefined,
        text,
        thinking: thinking || undefined,
        createdAt: toIso(message.inserted_at ?? message.created_at, events.length),
        selected: selected.has(id),
        source: 'deepseek-raw',
        model: message.model || undefined,
        title: info.title ?? undefined,
      });
    }
  }

  return events;
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
