import { useEffect, useMemo, useRef, useState } from 'react';

import { buildContext } from './lib/context.js';
import { API_BASE } from './lib/config.js';
import { importFile } from './lib/import-client.js';
import {
  clearLibrary,
  loadLegacySession,
  loadLibrary,
  saveLibrary,
} from './lib/storage.js';

const DEFAULT_SETTINGS = {
  provider: 'deepseek',
  model: 'deepseek-flash',
  apiKey: '',
  useServerKey: true,
  remember: false,
  maxRecent: 6,
  retrievalLimit: 4,
  memoryLimit: 6,
  maxOutputTokens: 500,
  temperature: 0.9,
};

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const timeLabel = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const firstChar = (name) => String(name || '?').slice(0, 1);

const loadSettings = () => {
  try {
    const stored = JSON.parse(localStorage.getItem('whale-settings') || '{}');
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

function normalizeMessages(character) {
  if (Array.isArray(character.messages) && character.messages.length > 0) {
    return character.messages;
  }
  return (character.events ?? []).map((event) => ({ ...event, imported: true }));
}

function makeCharacter({ id, bible, events, messages, source }) {
  const now = new Date().toISOString();
  return {
    id: id ?? `char-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: bible?.persona?.name ?? '角色',
    title: bible?.title ?? '未命名故事',
    source: source ?? 'imported',
    bible,
    events: events ?? [],
    messages: (messages ?? []).map(({ pending, ...message }) => message),
    createdAt: now,
    updatedAt: now,
  };
}

export default function App() {
  const [data, setData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [events, setEvents] = useState([]);
  const [library, setLibrary] = useState({
    version: 1,
    activeId: null,
    characters: [],
  });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [context, setContext] = useState(null);
  const [view, setView] = useState('chat');
  const [settings, setSettings] = useState(loadSettings);
  const [draftSettings, setDraftSettings] = useState(settings);
  const [showAll, setShowAll] = useState(false);
  const [source, setSource] = useState('demo');
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');

  const abortRef = useRef(null);
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);

  const config = useMemo(
    () => ({
      provider: settings.provider || 'deepseek',
      model:
        settings.model ||
        (settings.provider === 'zhipu' ? 'glm-4.7-flash' : 'deepseek-flash'),
      apiKey: settings.apiKey || '',
      useServerKey: settings.useServerKey !== false,
    }),
    [settings],
  );

  const chatOptions = useMemo(
    () => ({
      maxRecent: Number(settings.maxRecent) || 6,
      retrievalLimit: Number(settings.retrievalLimit) || 4,
      memoryLimit: Number(settings.memoryLimit) || 6,
      maxOutputTokens: Number(settings.maxOutputTokens) || 500,
      temperature: Number(settings.temperature) || 0.9,
    }),
    [settings],
  );

  const applyCharacter = (character) => {
    setData(character.bible);
    setEvents(character.events ?? []);
    setMessages(normalizeMessages(character));
    setSource(character.source ?? 'demo');
    setImportStatus('');
    setContext(null);
    setDraft('');
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stored = await loadLibrary();
        if (cancelled) return;

        if (stored?.characters?.length > 0) {
          const active =
            stored.characters.find((character) => character.id === stored.activeId) ??
            stored.characters[0];
          setLibrary({ ...stored, activeId: active.id });
          applyCharacter(active);
          return;
        }

        const legacy = await loadLegacySession();
        if (legacy?.bible) {
          const character = makeCharacter({
            bible: legacy.bible,
            events: legacy.events ?? [],
            messages: legacy.messages ?? [],
            source: legacy.source ?? 'imported',
          });
          const next = { version: 1, activeId: character.id, characters: [character] };
          await saveLibrary(next);
          if (cancelled) return;
          setLibrary(next);
          applyCharacter(character);
          return;
        }

        const response = await fetch('/demo-data.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const character = makeCharacter({
          id: 'demo',
          bible: payload,
          events: payload.events,
          messages: payload.events.map((event) => ({ ...event, imported: true })),
          source: 'demo',
        });
        const next = { version: 1, activeId: character.id, characters: [character] };
        await saveLibrary(next);
        if (cancelled) return;
        setLibrary(next);
        applyCharacter(character);
      } catch (loadError) {
        if (!cancelled) setError(`加载角色失败：${loadError.message}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (view !== 'chat') return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.text.length, view]);

  useEffect(() => {
    if (!data || !library.activeId) return;
    const timer = setTimeout(() => {
      setLibrary((previous) => {
        const characters = previous.characters.map((character) =>
          character.id === previous.activeId
            ? {
                ...character,
                name: data.persona.name,
                title: data.title,
                bible: data,
                events,
                messages: messages.map(({ pending, ...message }) => message),
                source,
                updatedAt: new Date().toISOString(),
              }
            : character,
        );
        const next = { ...previous, characters };
        saveLibrary(next).catch(() => {});
        return next;
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [data, events, messages, source, library.activeId]);

  const importedCount = messages.filter((message) => message.imported).length;
  const visibleMessages = showAll ? messages : messages.slice(-60);
  const activeCharacter =
    library.characters.find((character) => character.id === library.activeId) ?? null;

  const snapshotCharacters = () => {
    if (!data) return library.characters;
    return library.characters.map((character) =>
      character.id === library.activeId
        ? {
            ...character,
            name: data.persona.name,
            title: data.title,
            bible: data,
            events,
            messages: messages.map(({ pending, ...message }) => message),
            source,
            updatedAt: new Date().toISOString(),
          }
        : character,
    );
  };

  const switchCharacter = (id) => {
    const characters = snapshotCharacters();
    const character = characters.find((item) => item.id === id);
    if (!character) return;
    const next = { ...library, activeId: id, characters };
    setLibrary(next);
    saveLibrary(next).catch(() => {});
    applyCharacter(character);
    setView('chat');
  };

  const openDemoCharacter = async () => {
    let character = library.characters.find((item) => item.source === 'demo');
    if (!character) {
      const response = await fetch('/demo-data.json');
      const payload = await response.json();
      character = makeCharacter({
        id: `demo-${Date.now()}`,
        bible: payload,
        events: payload.events,
        messages: payload.events.map((event) => ({ ...event, imported: true })),
        source: 'demo',
      });
    }
    const characters = [character, ...snapshotCharacters().filter((item) => item.id !== character.id)];
    const next = { ...library, activeId: character.id, characters };
    setLibrary(next);
    await saveLibrary(next);
    applyCharacter(character);
    setView('chat');
  };

  const deleteActive = async () => {
    if (!window.confirm('删除当前角色？它的聊天记录也会删除。')) return;
    const remaining = library.characters.filter(
      (character) => character.id !== library.activeId,
    );
    if (remaining.length === 0) {
      await clearLibrary();
      window.location.reload();
      return;
    }
    const next = { version: 1, activeId: remaining[0].id, characters: remaining };
    setLibrary(next);
    await saveLibrary(next);
    applyCharacter(remaining[0]);
    setView('chat');
  };

  const saveSettingsForm = () => {
    const next = {
      ...DEFAULT_SETTINGS,
      ...draftSettings,
      maxRecent: Number(draftSettings.maxRecent) || 6,
      retrievalLimit: Number(draftSettings.retrievalLimit) || 0,
      memoryLimit: Number(draftSettings.memoryLimit) || 0,
      maxOutputTokens: Number(draftSettings.maxOutputTokens) || 500,
      temperature: Number(draftSettings.temperature) || 0.9,
    };
    setSettings(next);
    const persisted = { ...next };
    if (!next.remember) delete persisted.apiKey;
    localStorage.setItem('whale-settings', JSON.stringify(persisted));
    setError('');
    setView('chat');
  };

  const openSettings = () => {
    setDraftSettings(settings);
    setView('settings');
  };

  const handleFile = async (file) => {
    if (!file || importing) return;
    setImporting(true);
    setImportStatus('解析中…');
    setError('');

    try {
      const { result, bible } = await importFile(file);
      const selected = result.selected.map((event) => ({ ...event, imported: true }));
      const character = makeCharacter({
        bible,
        events: selected,
        messages: selected,
        source: 'imported',
      });
      const characters = [character, ...snapshotCharacters()];
      const next = { ...library, activeId: character.id, characters };
      setLibrary(next);
      await saveLibrary(next);
      applyCharacter(character);
      setImportStatus(`导入完成：${selected.length} 条主线`);
      setView('chat');
    } catch (importError) {
      setError(`导入失败：${importError.message}`);
      setImportStatus('');
    } finally {
      setImporting(false);
    }
  };

  const rememberMessage = (message) => {
    const text = String(message.text ?? '').trim().slice(0, 180);
    if (!text) return;
    setData((previous) => {
      if (!previous) return previous;
      const memories = previous.memories ?? [];
      if (memories.some((memory) => memory.text === text)) return previous;
      return {
        ...previous,
        memories: [...memories, { kind: '事件', text, importance: 0.8 }],
      };
    });
    setImportStatus('已加入长期记忆');
  };

  const removeMemory = (index) => {
    setData((previous) =>
      previous
        ? {
            ...previous,
            memories: previous.memories.filter((_, memoryIndex) => memoryIndex !== index),
          }
        : previous,
    );
    setImportStatus('已删除一条长期记忆');
  };

  const stop = () => abortRef.current?.abort();

  const send = async (textArg) => {
    const text = String(textArg ?? draft).trim();
    if (!text || streaming || !data) return;

    setError('');
    const userMessage = {
      id: uid(),
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };

    const ctx = buildContext({
      bible: data,
      events,
      messages,
      userText: text,
      maxRecent: chatOptions.maxRecent,
      retrievalLimit: chatOptions.retrievalLimit,
      memoryLimit: chatOptions.memoryLimit,
      estimatedOutputTokens: chatOptions.maxOutputTokens,
    });
    setContext(ctx);

    const assistantId = uid();
    const assistantCreatedAt = new Date().toISOString();
    let assistantText = '';
    setMessages((previous) => [
      ...previous,
      userMessage,
      {
        id: assistantId,
        role: 'assistant',
        speaker: data.persona.name,
        text: '',
        createdAt: assistantCreatedAt,
        pending: true,
      },
    ]);
    setDraft('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          provider: config.provider,
          model: config.model,
          apiKey: config.useServerKey ? undefined : config.apiKey,
          messages: ctx.messages,
          temperature: chatOptions.temperature,
          maxTokens: chatOptions.maxOutputTokens,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error('浏览器没有收到流式响应');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              assistantText += delta;
              setMessages((previous) =>
                previous.map((message) =>
                  message.id === assistantId
                    ? { ...message, text: message.text + delta }
                    : message,
                ),
              );
            }
          } catch {
            // Ignore keepalive / partial SSE payloads.
          }
        }
      }

      setMessages((previous) =>
        previous.map((message) =>
          message.id === assistantId ? { ...message, pending: false } : message,
        ),
      );
    } catch (sendError) {
      if (sendError.name === 'AbortError') {
        setError('已停止生成。');
      } else {
        setError(`生成失败：${sendError.message}`);
      }
      setMessages((previous) =>
        previous.filter(
          (message) => message.id !== assistantId || message.text.length > 0,
        ),
      );
    } finally {
      const finalMessages = assistantText
        ? [
            ...messages,
            userMessage,
            {
              id: assistantId,
              role: 'assistant',
              speaker: data.persona.name,
              text: assistantText,
              createdAt: assistantCreatedAt,
            },
          ]
        : [...messages, userMessage];
      const characters = snapshotCharacters().map((character) =>
        character.id === library.activeId
          ? {
              ...character,
              messages: finalMessages,
              updatedAt: new Date().toISOString(),
            }
          : character,
      );
      const next = { ...library, characters };
      setLibrary(next);
      await saveLibrary(next).catch(() => {});
      setStreaming(false);
      abortRef.current = null;
    }
  };

  if (error && !data) {
    return (
      <main className="boot-error">
        <h1>鲸忆</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="boot-error">
        <h1>鲸忆</h1>
        <p>正在加载本地角色…</p>
      </main>
    );
  }

  const headerTitle =
    view === 'chat'
      ? data.persona.name
      : view === 'characters'
        ? '角色'
        : view === 'memory'
          ? '记忆'
          : '设置';
  const headerSub =
    view === 'chat'
      ? `${data.memories.length} 条长期记忆 · ${importedCount} 条导入 · ${library.characters.length} 个角色`
      : view === 'characters'
        ? `${library.characters.length} 个角色`
        : view === 'memory'
          ? data.title
          : '模型、省流和成本';

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          {view === 'chat' && (
            <button
              className="icon-btn"
              onClick={() => setView('characters')}
              aria-label="角色列表"
            >
              ☰
            </button>
          )}
          {view !== 'chat' && view !== 'characters' && (
            <button className="icon-btn" onClick={() => setView('chat')} aria-label="返回">
              ←
            </button>
          )}
          <div className="avatar">{firstChar(data.persona.name)}</div>
          <div className="title-block">
            <h1>{headerTitle}</h1>
            <div className="sub">{headerSub}</div>
          </div>
        </div>
        <div className="topbar-actions">
          {view === 'chat' && (
            <>
              <button className="ghost" onClick={() => setView('memory')}>
                记忆
              </button>
              <button className="ghost" onClick={openSettings}>
                设置
              </button>
            </>
          )}
          {view === 'characters' && (
            <>
              <button
                className="ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                {importing ? '导入中…' : '导入'}
              </button>
              <button className="ghost" onClick={openSettings}>
                设置
              </button>
            </>
          )}
          {view === 'memory' && (
            <>
              <button className="ghost" onClick={deleteActive}>
                删除
              </button>
              <button className="ghost" onClick={openSettings}>
                设置
              </button>
            </>
          )}
          {view === 'settings' && (
            <>
              <button className="ghost" onClick={() => setView('chat')}>
                取消
              </button>
              <button className="primary" onClick={saveSettingsForm}>
                保存
              </button>
            </>
          )}
          <span className={`status ${streaming ? 'live' : ''}`}>
            {streaming ? '生成中…' : ''}
          </span>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.jsonl,.txt"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          handleFile(file);
        }}
      />

      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button className="ghost small" onClick={() => setError('')}>
            关闭
          </button>
        </div>
      )}

      {view === 'chat' && (
        <main className="chat-view">
          <div className="thread-bar">
            <button className="ghost small" onClick={() => setShowAll((value) => !value)}>
              {showAll ? '只看最近 60 条' : `显示全部 ${messages.length} 条`}
            </button>
            {importStatus && <span className="thread-note">{importStatus}</span>}
          </div>

          <div className="chat-scroll">
            <div className="chat-thread">
              {!showAll && messages.length > 60 && (
                <div className="older-hint">已折叠较早的 {messages.length - 60} 条</div>
              )}
              {visibleMessages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  personaName={data.persona.name}
                  onRemember={rememberMessage}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="composer-wrap">
            <div className="composer">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                placeholder={`给「${data.persona.name}」发消息…`}
                rows={1}
              />
              <div className="composer-row">
                <span className="hint">
                  {context
                    ? `≈ ${context.estimatedInputTokens} tokens · ≈ ¥${context.estimatedCostCNY.toFixed(3)}`
                    : `${config.provider} / ${config.model}`}
                </span>
                {streaming ? (
                  <button className="danger" onClick={stop}>
                    停止
                  </button>
                ) : (
                  <button className="primary" onClick={() => send()} disabled={!draft.trim()}>
                    发送
                  </button>
                )}
              </div>
            </div>
            <div className="composer-note">
              记忆 {data.memories.length} 条 · 回顾 {chatOptions.maxRecent} 轮 · 输出 ≤{' '}
              {chatOptions.maxOutputTokens} tokens
            </div>
          </div>
        </main>
      )}

      {view === 'characters' && (
        <main className="page">
          <div className="page-inner">
            <div className="character-grid">
              {library.characters.map((character) => (
                <button
                  key={character.id}
                  className={`character-card ${
                    character.id === library.activeId ? 'active' : ''
                  }`}
                  onClick={() => switchCharacter(character.id)}
                >
                  <span className="avatar">{firstChar(character.name)}</span>
                  <span className="character-info">
                    <strong>{character.name}</strong>
                    <span>{character.title}</span>
                    <small>
                      {character.bible?.memories?.length ?? 0} 条记忆 ·{' '}
                      {character.messages?.length ?? 0} 条消息
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <div className="page-actions">
              <button
                className="ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                {importing ? '导入中…' : '导入新角色'}
              </button>
              <button className="ghost" onClick={openDemoCharacter}>
                使用 demo 角色
              </button>
            </div>
          </div>
        </main>
      )}

      {view === 'memory' && (
        <MemoryPage
          data={data}
          chatOptions={chatOptions}
          context={context}
          onRemoveMemory={removeMemory}
        />
      )}

      {view === 'settings' && (
        <SettingsPage
          draftSettings={draftSettings}
          setDraftSettings={setDraftSettings}
        />
      )}
    </div>
  );
}

function Message({ message, personaName, onRemember }) {
  const isUser = message.role === 'user';
  return (
    <article className={`message ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-meta">
        <span>{isUser ? '你' : message.speaker || personaName}</span>
        <span>{timeLabel(message.createdAt)}</span>
        <button className="remember-btn" onClick={() => onRemember(message)}>
          记住
        </button>
      </div>
      <div className="message-text">
        {message.text}
        {message.pending && <span className="cursor">▋</span>}
      </div>
    </article>
  );
}

function InjectionSection({ context }) {
  if (!context) return null;
  return (
    <section className="page-card">
      <h3>
        上一轮注入
        <span className="page-badge">
          ≈ {context.estimatedInputTokens} tokens · ¥{context.estimatedCostCNY.toFixed(3)}
        </span>
      </h3>
      <div className="injection-grid">
        <div>
          <h4>长期记忆</h4>
          <ul className="memory-list">
            {(context.memories.length > 0 ? context.memories : [{ kind: '无', text: '暂无' }]).map(
              (memory, index) => (
                <li key={`${memory.text}-${index}`}>
                  <span className="kind">{memory.kind}</span>
                  {memory.text}
                </li>
              ),
            )}
          </ul>
        </div>
        <div>
          <h4>相关往事</h4>
          <ul className="memory-list">
            {(context.retrieved.length > 0
              ? context.retrieved
              : [{ id: 'none', role: 'assistant', text: '本轮没有额外检索到往事' }]
            ).map((event) => (
              <li key={event.id}>
                <span className="kind">
                  {event.role === 'user' ? '你' : event.speaker || '角色'}
                </span>
                {event.text.slice(0, 140)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function MemoryPage({ data, chatOptions, context, onRemoveMemory }) {
  const persona = data.persona;
  const relationship = data.relationship;

  return (
    <main className="page">
      <div className="page-inner">
        <section className="page-hero">
          <div className="avatar big">{firstChar(persona.name)}</div>
          <div>
            <h2>{persona.name}</h2>
            <p className="page-sub">{data.title}</p>
            <div className="chips">
              {persona.personality.map((trait) => (
                <span className="chip" key={trait}>
                  {trait}
                </span>
              ))}
            </div>
          </div>
        </section>

        <InjectionSection context={context} />

        <section className="page-card">
          <h3>人设</h3>
          <dl>
            <dt>别名</dt>
            <dd>{persona.aliases.join('、') || '未知'}</dd>
            <dt>年龄</dt>
            <dd>{persona.age}</dd>
            <dt>外貌</dt>
            <dd>{persona.appearance}</dd>
            <dt>说话</dt>
            <dd>{persona.speech_style}</dd>
            <dt>背景</dt>
            <dd>{persona.background}</dd>
            <dt>习惯</dt>
            <dd>{persona.habits.join('、') || '未知'}</dd>
          </dl>
        </section>

        <section className="page-card">
          <h3>关系</h3>
          <dl>
            <dt>阶段</dt>
            <dd>{relationship.stage}</dd>
            <dt>用户</dt>
            <dd>{relationship.user_name}</dd>
            <dt>定位</dt>
            <dd>{relationship.character_role}</dd>
            <dt>角色→用户</dt>
            <dd>{relationship.address_terms.user.join('、') || '你'}</dd>
            <dt>用户→角色</dt>
            <dd>{relationship.address_terms.character.join('、') || persona.name}</dd>
          </dl>
          <h4>边界</h4>
          <ul className="memory-list">
            {(relationship.boundaries.length > 0
              ? relationship.boundaries
              : ['暂无']
            ).map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
          <h4>未解决</h4>
          <ul className="memory-list">
            {(relationship.tensions.length > 0 ? relationship.tensions : ['暂无']).map(
              (item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ),
            )}
          </ul>
        </section>

        <section className="page-card">
          <h3>
            长期记忆 <span className="page-badge">{data.memories.length}</span>
          </h3>
          <ul className="memory-list">
            {data.memories.map((memory, index) => (
              <li key={`${memory.text}-${index}`}>
                <span className="kind">{memory.kind}</span>
                {memory.text}
                <span className="importance">{memory.importance.toFixed(2)}</span>
                <button
                  className="memory-remove"
                  onClick={() => onRemoveMemory(index)}
                  aria-label="删除记忆"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="page-card">
          <h3>时间线</h3>
          <ul className="memory-list">
            {data.timeline.map((item, index) => (
              <li key={`${item.event}-${index}`}>
                <span className="kind">{item.when}</span>
                {item.event}
              </li>
            ))}
          </ul>
        </section>

        <section className="page-card">
          <h3>语气样本</h3>
          {data.style_samples.map((sample, index) => (
            <blockquote key={`${sample}-${index}`}>{sample}</blockquote>
          ))}
        </section>

        <section className="page-card">
          <h3>未结束的线</h3>
          <ul className="memory-list">
            {(data.open_threads.length > 0 ? data.open_threads : ['暂无']).map(
              (thread, index) => (
                <li key={`${thread}-${index}`}>{thread}</li>
              ),
            )}
          </ul>
        </section>

        <p className="page-note">
          每轮只注入：长期记忆最多 {chatOptions.memoryLimit} 条 + 相关往事最多{' '}
          {chatOptions.retrievalLimit} 条 + 最近 {chatOptions.maxRecent} 轮。
        </p>
      </div>
    </main>
  );
}

function SettingsPage({ draftSettings, setDraftSettings }) {
  const update = (key, value) =>
    setDraftSettings((previous) => ({ ...previous, [key]: value }));

  return (
    <main className="page">
      <div className="page-inner">
        <section className="page-card">
          <h3>模型</h3>
          <label className="field">
            供应商
            <select
              value={draftSettings.provider || 'deepseek'}
              onChange={(event) => {
                const provider = event.target.value;
                setDraftSettings((previous) => ({
                  ...previous,
                  provider,
                  model: provider === 'zhipu' ? 'glm-4.7-flash' : 'deepseek-flash',
                }));
              }}
            >
              <option value="deepseek">DeepSeek</option>
              <option value="zhipu">智谱 BigModel</option>
            </select>
          </label>
          <label className="field">
            模型
            <input
              value={draftSettings.model || ''}
              onChange={(event) => update('model', event.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draftSettings.useServerKey !== false}
              onChange={(event) => update('useServerKey', event.target.checked)}
            />
            使用服务器 .env 里的 key（仅本地）
          </label>
          <label className="field">
            API key
            <input
              type="password"
              placeholder="sk-... / id.secret"
              value={draftSettings.apiKey || ''}
              disabled={draftSettings.useServerKey !== false}
              onChange={(event) => update('apiKey', event.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(draftSettings.remember)}
              onChange={(event) => update('remember', event.target.checked)}
            />
            记住 key（只存本机 localStorage）
          </label>
        </section>

        <section className="page-card">
          <h3>省流</h3>
          <p className="page-sub">
            默认就是低成本配置：少带历史、少带记忆、限制输出。DeepSeek 关闭 thinking 后不产生
            reasoning token。
          </p>
          <button
            className="ghost"
            onClick={() =>
              setDraftSettings((previous) => ({
                ...previous,
                maxRecent: 6,
                retrievalLimit: 4,
                memoryLimit: 6,
                maxOutputTokens: 500,
              }))
            }
          >
            套用省流预设
          </button>
          <div className="field-grid">
            <label className="field">
              最近对话轮数
              <input
                type="number"
                min="2"
                max="20"
                value={draftSettings.maxRecent ?? 6}
                onChange={(event) => update('maxRecent', event.target.value)}
              />
            </label>
            <label className="field">
              相关往事条数
              <input
                type="number"
                min="0"
                max="12"
                value={draftSettings.retrievalLimit ?? 4}
                onChange={(event) => update('retrievalLimit', event.target.value)}
              />
            </label>
            <label className="field">
              长期记忆条数
              <input
                type="number"
                min="0"
                max="20"
                value={draftSettings.memoryLimit ?? 6}
                onChange={(event) => update('memoryLimit', event.target.value)}
              />
            </label>
            <label className="field">
              最大输出 tokens
              <input
                type="number"
                min="200"
                max="2000"
                value={draftSettings.maxOutputTokens ?? 500}
                onChange={(event) => update('maxOutputTokens', event.target.value)}
              />
            </label>
            <label className="field">
              温度
              <input
                type="number"
                step="0.1"
                min="0"
                max="1.5"
                value={draftSettings.temperature ?? 0.9}
                onChange={(event) => update('temperature', event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="page-card">
          <h3>成本</h3>
          <p className="page-sub">
            估算按 DeepSeek V4.1 Flash 空闲价：输入 ¥1.56/M，输出 ¥4.69/M。实际以账单为准。
          </p>
        </section>
      </div>
    </main>
  );
}
