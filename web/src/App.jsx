import { useEffect, useMemo, useRef, useState } from 'react';

import { buildContext } from './lib/context.js';

// Empty for the local gateway; set VITE_API_BASE for the Android WebView
// (e.g. http://127.0.0.1:8787 with `adb reverse tcp:8787 tcp:8787`).
const API_BASE = import.meta.env.VITE_API_BASE || '';

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

const loadSettings = () => {
  try {
    return JSON.parse(localStorage.getItem('whale-settings') || '{}');
  } catch {
    return {};
  }
};

export default function App() {
  const [data, setData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [context, setContext] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const [draftSettings, setDraftSettings] = useState(settings);
  const [showAll, setShowAll] = useState(false);

  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const listRef = useRef(null);

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

  useEffect(() => {
    fetch('/demo-data.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        setData(payload);
        setMessages(
          payload.events.map((event) => ({
            ...event,
            imported: true,
          })),
        );
      })
      .catch((loadError) => setError(`加载 demo 数据失败：${loadError.message}`));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, streaming]);

  const visibleMessages = showAll ? messages : messages.slice(-60);
  const importedCount = messages.filter((message) => message.imported).length;

  const saveSettings = (next) => {
    setSettings(next);
    const persisted = { ...next };
    if (!next.remember) delete persisted.apiKey;
    localStorage.setItem('whale-settings', JSON.stringify(persisted));
    setSettingsOpen(false);
    setError('');
  };

  const openSettings = () => {
    setDraftSettings(settings);
    setSettingsOpen(true);
  };

  const stop = () => {
    abortRef.current?.abort();
  };

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

    // Build context from the messages *before* this user message, then append it.
    const ctx = buildContext({
      bible: data,
      events: data.events,
      messages,
      userText: text,
    });
    setContext(ctx);

    const assistantId = uid();
    setMessages((previous) => [
      ...previous,
      userMessage,
      {
        id: assistantId,
        role: 'assistant',
        speaker: data.persona.name,
        text: '',
        createdAt: new Date().toISOString(),
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
          temperature: 0.9,
          maxTokens: 800,
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
              setMessages((previous) =>
                previous.map((message) =>
                  message.id === assistantId
                    ? { ...message, text: message.text + delta, pending: false }
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
      setStreaming(false);
      abortRef.current = null;
    }
  };

  if (error && !data) {
    return (
      <main className="boot-error">
        <h1>whale-memory</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="boot-error">
        <h1>whale-memory</h1>
        <p>正在加载本地 demo 数据…</p>
      </main>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="eyebrow">WHALE MEMORY · LOCAL MVP</div>
          <h1>{data.title}</h1>
          <div className="sub">
            <span className="persona-dot" />
            {data.persona.name} · {importedCount} 条导入消息 · 语气样本{' '}
            {data.style_samples.length} 条
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`status ${streaming ? 'live' : ''}`}>
            {streaming ? '生成中…' : '本地 · BYOK'}
          </span>
          <button className="ghost" onClick={openSettings}>
            设置
          </button>
        </div>
      </header>

      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button className="ghost small" onClick={() => setError('')}>
            关闭
          </button>
        </div>
      )}

      <main className="layout">
        <section className="panel chat-panel">
          <div className="chat-toolbar">
            <div className="chat-title">
              <strong>{data.persona.name}</strong>
              <span>
                {context
                  ? `上一轮上下文 ≈ ${context.estimatedInputTokens} tokens · ≈¥${context.estimatedCostCNY.toFixed(3)}`
                  : '本地记忆已载入'}
              </span>
            </div>
            <button className="ghost small" onClick={() => setShowAll((value) => !value)}>
              {showAll ? '只看最近 60 条' : `显示全部 ${messages.length} 条`}
            </button>
          </div>

          <div className="messages" ref={listRef}>
            {!showAll && messages.length > 60 && (
              <div className="older-hint">已折叠较早的 {messages.length - 60} 条</div>
            )}
            {visibleMessages.map((message) => (
              <article
                key={message.id}
                className={`message ${message.role === 'user' ? 'user' : 'assistant'}`}
              >
                <div className="message-meta">
                  <span>{message.role === 'user' ? '你' : message.speaker || data.persona.name}</span>
                  <span>{timeLabel(message.createdAt)}</span>
                  {message.imported && <span className="chip">导入</span>}
                </div>
                <div className="message-text">
                  {message.text}
                  {message.pending && <span className="cursor">▋</span>}
                </div>
              </article>
            ))}
            <div ref={bottomRef} />
          </div>

          {context && (
            <details className="context-box">
              <summary>
                本轮记忆 · {context.memories.length} 条长期记忆 + {context.retrieved.length} 条往事
                <span className="context-cost">≈ ¥{context.estimatedCostCNY.toFixed(3)}</span>
              </summary>
              <div className="context-columns">
                <div>
                  <h4>长期记忆</h4>
                  <ul>
                    {context.memories.map((memory, index) => (
                      <li key={`${memory.text}-${index}`}>
                        <span className="kind">{memory.kind}</span>
                        {memory.text}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>相关往事</h4>
                  <ul>
                    {context.retrieved.map((event) => (
                      <li key={event.id}>
                        <span className="kind">
                          {event.role === 'user' ? '你' : event.speaker || data.persona.name}
                        </span>
                        {event.text.slice(0, 140)}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </details>
          )}

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
              placeholder={`以「${data.persona.name}」的身份继续聊…（Enter 发送，Shift+Enter 换行）`}
              rows={3}
            />
            <div className="composer-actions">
              <span className="hint">
                {config.provider} / {config.model}
                {config.useServerKey ? ' · 用本地 .env key' : ' · 用自己的 key'}
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
        </section>

        <aside className="panel memory-panel">
          <div className="memory-card">
            <div className="memory-name">{data.persona.name}</div>
            <div className="chips">
              {data.persona.personality.map((trait) => (
                <span className="chip" key={trait}>
                  {trait}
                </span>
              ))}
            </div>
            <dl>
              <dt>阶段</dt>
              <dd>{data.relationship.stage}</dd>
              <dt>角色→用户</dt>
              <dd>{data.relationship.address_terms?.user?.join('、') || '你'}</dd>
              <dt>用户→角色</dt>
              <dd>
                {data.relationship.address_terms?.character?.join('、') ||
                  data.persona.name}
              </dd>
              <dt>说话</dt>
              <dd>{data.persona.speech_style}</dd>
            </dl>
          </div>

          <section className="memory-section">
            <h2>长期记忆</h2>
            <ul className="memory-list">
              {data.memories.slice(0, 10).map((memory, index) => (
                <li key={`${memory.text}-${index}`}>
                  <span className="kind">{memory.kind}</span>
                  {memory.text}
                </li>
              ))}
            </ul>
          </section>

          <section className="memory-section">
            <h2>未结束的线</h2>
            <ul className="memory-list">
              {(data.open_threads.length > 0 ? data.open_threads : ['暂无']).map(
                (thread, index) => (
                  <li key={`${thread}-${index}`}>{thread}</li>
                ),
              )}
            </ul>
          </section>

          <section className="memory-section">
            <h2>时间线（最近）</h2>
            <ul className="memory-list">
              {data.timeline.slice(-8).map((item, index) => (
                <li key={`${item.event}-${index}`}>
                  <span className="kind">{item.when}</span>
                  {item.event}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </main>

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>模型设置</h2>
            <p className="modal-note">
              本地演示默认走服务器 <code>.env</code> 里的 key；也可以填自己的 key。
              key 只存在浏览器 localStorage（勾选“记住”时）。
            </p>

            <label>
              供应商
              <select
                value={draftSettings.provider || 'deepseek'}
                onChange={(event) =>
                  setDraftSettings((previous) => ({
                    ...previous,
                    provider: event.target.value,
                    model:
                      event.target.value === 'zhipu'
                        ? 'glm-4.7-flash'
                        : 'deepseek-flash',
                  }))
                }
              >
                <option value="deepseek">DeepSeek</option>
                <option value="zhipu">智谱 BigModel</option>
              </select>
            </label>

            <label>
              模型
              <input
                value={draftSettings.model || config.model}
                onChange={(event) =>
                  setDraftSettings((previous) => ({
                    ...previous,
                    model: event.target.value,
                  }))
                }
              />
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={draftSettings.useServerKey !== false}
                onChange={(event) =>
                  setDraftSettings((previous) => ({
                    ...previous,
                    useServerKey: event.target.checked,
                  }))
                }
              />
              使用服务器 .env 里的 key（仅本地）
            </label>

            <label>
              API key
              <input
                type="password"
                placeholder="sk-... / id.secret"
                value={draftSettings.apiKey || ''}
                onChange={(event) =>
                  setDraftSettings((previous) => ({
                    ...previous,
                    apiKey: event.target.value,
                  }))
                }
                disabled={draftSettings.useServerKey !== false}
              />
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(draftSettings.remember)}
                onChange={(event) =>
                  setDraftSettings((previous) => ({
                    ...previous,
                    remember: event.target.checked,
                  }))
                }
              />
              记住 key（只存本机 localStorage）
            </label>

            <div className="modal-actions">
              <button className="ghost" onClick={() => setSettingsOpen(false)}>
                取消
              </button>
              <button className="primary" onClick={() => saveSettings(draftSettings)}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
