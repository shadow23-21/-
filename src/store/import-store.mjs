/**
 * Persist one imported conversation into SQLite.
 * Re-importing the same conversation replaces its events, FTS rows and
 * character placeholders, while keeping the schema additive.
 */
export function storeImport(db, result, options = {}) {
  const events = result.events;
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('No events to store');
  }

  const conversations = new Map();
  for (const event of events) {
    const id = String(event.conversationId ?? 'default');
    if (!conversations.has(id)) {
      conversations.set(id, {
        id,
        title: options.title ?? event.title ?? id,
        source: event.source,
        times: [],
      });
    }
    const conversation = conversations.get(id);
    if (!conversation.title && event.title) conversation.title = event.title;
    conversation.times.push(event.createdAt);
  }

  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const conversation of conversations.values()) {
      conversation.times.sort();
      const created = conversation.times[0] ?? now;
      const updated = conversation.times[conversation.times.length - 1] ?? now;
      db.prepare(
        `INSERT INTO conversations (id, title, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           source = excluded.source,
           updated_at = excluded.updated_at`,
      ).run(conversation.id, conversation.title, conversation.source, created, updated);

      db.prepare('DELETE FROM events WHERE conversation_id = ?').run(conversation.id);
    }

    const insertEvent = db.prepare(
      `INSERT INTO events (
         conversation_id, id, parent_id, role, speaker, text, thinking,
         created_at, selected, source, model, title
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const event of events) {
      insertEvent.run(
        String(event.conversationId ?? 'default'),
        String(event.id),
        event.parentId ?? null,
        event.role,
        event.speaker ?? null,
        event.text,
        event.thinking ?? null,
        event.createdAt,
        event.selected === false ? 0 : 1,
        event.source,
        event.model ?? null,
        event.title ?? null,
      );
    }

    const names = new Set(
      result.selected
        .filter((event) => event.role === 'assistant' && event.speaker)
        .map((event) => event.speaker),
    );

    for (const conversation of conversations.values()) {
      for (const name of names) {
        db.prepare(
          `INSERT INTO characters (id, conversation_id, name, persona_json, created_at)
           VALUES (?, ?, ?, NULL, ?)
           ON CONFLICT(id) DO NOTHING`,
        ).run(`${conversation.id}:${name}`, conversation.id, name, now);
      }
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    conversations: conversations.size,
    events: events.length,
    selected: result.selected.length,
    archived: events.length - result.selected.length,
    characters: db.prepare('SELECT COUNT(*) AS n FROM characters').get().n,
  };
}
