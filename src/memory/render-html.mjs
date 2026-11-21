const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });

export function renderDemoHtml({ bible, events, stats }) {
  const payload = {
    title: bible.title,
    persona: bible.persona,
    relationship: bible.relationship,
    timeline: bible.timeline,
    memories: bible.memories,
    styleSamples: bible.style_samples,
    openThreads: bible.open_threads,
    stats,
    events: events.map((event) => ({
      id: event.id,
      role: event.role,
      speaker: event.speaker ?? null,
      text: event.text,
      thinking: event.thinking ?? null,
      createdAt: event.createdAt,
      selected: event.selected !== false,
    })),
  };

  const dataJson = JSON.stringify(payload).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(bible.title)} · whale-memory</title>
<style>
  :root {
    --bg: #0b1020;
    --panel: #121a2e;
    --panel-2: #17213a;
    --line: #26324f;
    --text: #e8eefc;
    --muted: #8fa0c4;
    --accent: #7cc7ff;
    --accent-2: #b8a1ff;
    --user: #2a3f66;
    --assistant: #1a2742;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: radial-gradient(1200px 600px at 20% -10%, #1b2b52 0%, var(--bg) 55%);
    color: var(--text);
    font: 15px/1.7 "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  }
  .top {
    display: flex; gap: 24px; justify-content: space-between; align-items: flex-end;
    padding: 28px 32px 20px; border-bottom: 1px solid var(--line);
  }
  .eyebrow { color: var(--accent); font-size: 11px; letter-spacing: .18em; }
  h1 { margin: 6px 0 4px; font-size: 28px; line-height: 1.2; }
  .sub { color: var(--muted); font-size: 13px; }
  .stats { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
  .stat {
    min-width: 96px; padding: 10px 12px; border: 1px solid var(--line);
    border-radius: 12px; background: rgba(18, 26, 46, .7);
  }
  .stat b { display: block; font-size: 20px; color: var(--accent); }
  .stat span { color: var(--muted); font-size: 11px; }
  .layout {
    display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(360px, .85fr);
    gap: 18px; padding: 18px 32px 28px; height: calc(100vh - 150px);
  }
  .panel {
    border: 1px solid var(--line); border-radius: 16px;
    background: linear-gradient(180deg, rgba(23, 33, 58, .92), rgba(18, 26, 46, .92));
    overflow: hidden; min-height: 0;
  }
  .chat-panel { display: flex; flex-direction: column; }
  .toolbar {
    display: flex; gap: 12px; align-items: center; padding: 12px 14px;
    border-bottom: 1px solid var(--line);
  }
  .toolbar input {
    flex: 1; background: #0d1528; color: var(--text); border: 1px solid var(--line);
    border-radius: 10px; padding: 9px 12px; outline: none;
  }
  .toolbar input:focus { border-color: var(--accent); }
  #count { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .messages { overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .msg {
    border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px;
    background: var(--assistant); max-width: 92%;
  }
  .msg.user { align-self: flex-end; background: var(--user); border-color: #38527f; }
  .msg.archived { opacity: .45; border-style: dashed; }
  .meta { color: var(--muted); font-size: 11px; margin-bottom: 6px; }
  .msg.user .meta { text-align: right; }
  .text { white-space: pre-wrap; word-break: break-word; }
  .think { margin-top: 10px; border-top: 1px dashed var(--line); padding-top: 8px; }
  .think summary { color: var(--accent-2); cursor: pointer; font-size: 12px; }
  .think div { color: var(--muted); font-size: 13px; white-space: pre-wrap; margin-top: 6px; }
  .memory-panel { overflow: auto; padding: 18px; }
  .mem-section { margin-bottom: 22px; }
  .mem-section h2 {
    margin: 0 0 10px; font-size: 12px; letter-spacing: .14em;
    color: var(--accent); text-transform: uppercase;
  }
  .name { font-size: 26px; font-weight: 700; margin-bottom: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 12px; }
  .chip {
    padding: 3px 9px; border-radius: 999px; background: #1d2a48;
    border: 1px solid #2e4066; color: #cfe2ff; font-size: 12px;
  }
  dl { display: grid; grid-template-columns: 86px 1fr; gap: 6px 12px; margin: 0; }
  dt { color: var(--muted); font-size: 12px; }
  dd { margin: 0; }
  .list { margin: 0; padding-left: 18px; }
  .list li { margin: 5px 0; }
  .memory-item { border-left: 2px solid var(--accent); padding-left: 10px; margin: 10px 0; }
  .memory-item .kind { color: var(--accent-2); font-size: 11px; margin-right: 6px; }
  blockquote {
    margin: 8px 0; padding: 8px 12px; border-left: 2px solid var(--accent);
    background: #0f1930; color: #d7e6ff; border-radius: 0 8px 8px 0;
  }
  footer {
    padding: 0 32px 18px; color: #64769b; font-size: 11px;
  }
  @media (max-width: 960px) {
    .top { padding: 20px; align-items: flex-start; flex-direction: column; }
    .layout { display: block; height: auto; padding: 14px 20px 24px; }
    .chat-panel { height: 70vh; margin-bottom: 16px; }
    .memory-panel { max-height: none; }
  }
</style>
</head>
<body>
<header class="top">
  <div>
    <div class="eyebrow">WHALE MEMORY · LOCAL DEMO</div>
    <h1>${escapeHtml(bible.title)}</h1>
    <div class="sub">${escapeHtml(bible.persona.name)} · ${stats.selected} 条主线 / ${stats.archived} 条归档 · 生成方式 ${escapeHtml(bible.meta?.source ?? 'unknown')}</div>
  </div>
  <div class="stats">
    <div class="stat"><b>${stats.events}</b><span>导入消息</span></div>
    <div class="stat"><b>${bible.memories.length}</b><span>记忆</span></div>
    <div class="stat"><b>${bible.timeline.length}</b><span>时间线</span></div>
    <div class="stat"><b>${bible.style_samples.length}</b><span>语气样本</span></div>
  </div>
</header>
<main class="layout">
  <section class="panel chat-panel">
    <div class="toolbar">
      <input id="search" placeholder="搜索对话、称呼、事件..." autocomplete="off">
      <span id="count"></span>
    </div>
    <div id="messages" class="messages"></div>
  </section>
  <aside class="panel memory-panel"><div id="memory"></div></aside>
</main>
<footer>本地静态 demo · 数据来自导入结果 · 不含真实聊天记录</footer>
<script>
const DATA = ${dataJson};

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => {
  switch (character) {
    case '&': return '&amp;';
    case '<': return '&lt;';
    case '>': return '&gt;';
    case '"': return '&quot;';
    default: return '&#39;';
  }
});
const chips = (items) => (items || []).map((item) => '<span class="chip">' + esc(item) + '</span>').join('');
const list = (items, empty) => {
  if (!items || items.length === 0) return '<p class="sub">' + esc(empty || '未知') + '</p>';
  return '<ul class="list">' + items.map((item) => '<li>' + esc(item) + '</li>').join('') + '</ul>';
};
const section = (title, body) => '<section class="mem-section"><h2>' + esc(title) + '</h2>' + body + '</section>';

function renderMemory() {
  const p = DATA.persona;
  const r = DATA.relationship;
  const address = r.address_terms || { user: [], character: [] };
  let html = '';

  html += section('人设',
    '<div class="name">' + esc(p.name) + '</div>' +
    '<div class="chips">' + chips(p.personality) + '</div>' +
    '<dl>' +
      '<dt>别名</dt><dd>' + esc((p.aliases || []).join('、') || '未知') + '</dd>' +
      '<dt>年龄</dt><dd>' + esc(p.age) + '</dd>' +
      '<dt>外貌</dt><dd>' + esc(p.appearance) + '</dd>' +
      '<dt>说话</dt><dd>' + esc(p.speech_style) + '</dd>' +
      '<dt>背景</dt><dd>' + esc(p.background) + '</dd>' +
      '<dt>习惯</dt><dd>' + esc((p.habits || []).join('、') || '未知') + '</dd>' +
    '</dl>'
  );

  html += section('关系',
    '<dl>' +
      '<dt>阶段</dt><dd>' + esc(r.stage) + '</dd>' +
      '<dt>用户</dt><dd>' + esc(r.user_name) + '</dd>' +
      '<dt>定位</dt><dd>' + esc(r.character_role) + '</dd>' +
      '<dt>角色→用户</dt><dd>' + esc((address.user || []).join('、') || '未知') + '</dd>' +
      '<dt>用户→角色</dt><dd>' + esc((address.character || []).join('、') || '未知') + '</dd>' +
    '</dl>' +
    '<h3 class="sub">边界</h3>' + list(r.boundaries) +
    '<h3 class="sub">未解决</h3>' + list(r.tensions)
  );

  html += section('时间线',
    '<ul class="list">' + DATA.timeline.map((item) =>
      '<li><b>' + esc(item.when) + '</b> · ' + esc(item.event) + '</li>'
    ).join('') + '</ul>'
  );

  html += section('记忆',
    DATA.memories.map((item) =>
      '<div class="memory-item"><span class="kind">' + esc(item.kind) + '</span>' + esc(item.text) + '</div>'
    ).join('')
  );

  html += section('语气样本',
    DATA.styleSamples.map((sample) => '<blockquote>' + esc(sample) + '</blockquote>').join('')
  );

  html += section('未结束的线', list(DATA.openThreads));

  $('memory').innerHTML = html;
}

function renderMessages(query) {
  const filter = String(query || '').trim().toLowerCase();
  let visible = 0;
  const html = DATA.events.map((event) => {
    const haystack = (event.text + ' ' + (event.speaker || '')).toLowerCase();
    if (filter && haystack.indexOf(filter) === -1) return '';
    visible += 1;
    const isUser = event.role === 'user';
    const meta = (isUser ? '你' : (event.speaker || DATA.persona.name || '角色')) + ' · ' +
      String(event.createdAt || '').slice(0, 16).replace('T', ' ') +
      (event.selected ? '' : ' · 归档');
    const think = event.thinking
      ? '<details class="think"><summary>思考</summary><div>' + esc(event.thinking) + '</div></details>'
      : '';
    return '<article class="msg ' + (isUser ? 'user' : 'assistant') +
      (event.selected ? '' : ' archived') + '">' +
      '<div class="meta">' + esc(meta) + '</div>' +
      '<div class="text">' + esc(event.text) + '</div>' + think + '</article>';
  }).join('');

  $('messages').innerHTML = html;
  $('count').textContent = visible + ' / ' + DATA.events.length + ' 条';
}

$('search').addEventListener('input', (event) => renderMessages(event.target.value));
renderMemory();
renderMessages('');
</script>
</body>
</html>
`;
}
