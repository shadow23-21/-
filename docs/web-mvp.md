# Web MVP

## 界面

- **聊天页**：只有角色名、消息流、输入框；不显示人设/记忆侧栏。
- **记忆页**：上一轮注入、人设、关系、长期记忆、时间线、语气样本、未结束的线；删除当前角色也在这里。
- **角色页**：左上角 ☰ 进入；角色卡片列表、导入新角色、使用 demo 角色。
- **设置页**：模型、key、省流参数（上下文轮数/往事条数/记忆条数/输出 tokens/温度）。

## 组成

```
web/                 React + Vite PWA
  src/App.jsx        聊天 UI、设置、流式渲染、上下文面板
  src/lib/context.js 检索 + prompt 组装 + 成本估算
server/gateway.mjs   本地 gateway：静态文件 + /api/chat 透传
```

## 上下文组装

每条用户消息只发：

1. **system（稳定前缀）**：人设、关系、边界、说话风格、语气样本、未结束的线
2. **system（动态）**：长期记忆（默认最多 6 条）+ 检索到的往事（默认最多 4 条）
3. **最近 6 轮**对话
4. 当前用户消息

默认省流参数在设置页可改；输入框上方会显示本轮估算 tokens 和金额。

稳定前缀在前，动态块在后，方便上游做 prefix cache。

检索（`web/src/lib/context.js`）：

- 中文 bigram + 单字 + 英文词
- 候选池排除最近 8 条
- 分数 = 词重叠 / sqrt(事件词数) + 轻微时间衰减
- 最多 6 条、约 4.5k 字
- 查不到时回退最近 3 条

成本估算按 DeepSeek V4.1 Flash 空闲价（¥1.56/M 输入、¥4.69/M 输出），只用于 UI 提示。

## Gateway

`POST /api/chat`

```json
{
  "provider": "deepseek",
  "model": "deepseek-flash",
  "apiKey": "optional; falls back to .env",
  "messages": [],
  "temperature": 0.9,
  "maxTokens": 800
}
```

- 上游：DeepSeek `https://api.deepseek.com/chat/completions` 或 智谱 `https://open.bigmodel.cn/api/paas/v4/chat/completions`
- 统一加 `thinking: { type: "disabled" }`
- SSE 原样转发；不记录请求体/聊天内容
- 只监听 `127.0.0.1`

## 导入

- 「导入」按钮接受 `.json` / `.jsonl` / `.txt`。
- 浏览器里直接调用 `src/import/index.mjs` 的 `importChat()`；支持 DeepSeek RAW、官方假设形状、tree、ChatGPT、SillyTavern、纯文本。
- 解析后把主线消息 POST 到 `/api/extract`，生成 story bible。
- 结果作为新角色存 IndexedDB（`whale-memory` / `session` / `library` / `characters`）；刷新自动载入。
- 角色列表可切换角色、新建 demo 角色；删除当前角色会移除它的聊天记录。

## 角色与手动记忆

- 每个角色有独立的 `bible / events / messages / source`，切换角色不会串记忆。
- 消息右上角「记住」：把该句写进长期记忆，下一轮就会注入。
- 记忆页每条长期记忆右侧有 `×`，可删除。

## 当前限制

- DeepSeek 官方导出是 zip，浏览器暂不解压；先手动解压，选 `conversation.json`。
- 多角色切换已做；重命名、排序、搜索还没做。
- 移动端访问需要 `adb reverse` 或 Capacitor 内嵌，暂不把 gateway 暴露到局域网。
- 流式只渲染 `delta.content`；`reasoning_content` 已通过关闭思考避免。
- 聊天记录已写入 IndexedDB：刷新/重启恢复导入的 story bible、主线消息和后续对话。
