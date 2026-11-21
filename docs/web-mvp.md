# Web MVP

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
2. **system（动态）**：长期记忆 8 条 + 检索到的往事 6 条
3. **最近 8 轮**对话
4. 当前用户消息

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

## 当前限制

- demo 数据来自合成 fixture，浏览器端还没有做“上传导出文件 → 解析 → IndexedDB”。
- 记忆存在内存里，刷新回到 demo 初始状态；下一步接 IndexedDB / Capacitor SQLite。
- 移动端访问需要 `adb reverse` 或 Capacitor 内嵌，暂不把 gateway 暴露到局域网。
- 流式只渲染 `delta.content`；`reasoning_content` 已通过关闭思考避免。
- 没有多角色切换 UI；`character_id` 隔离在 SQLite 层已留好。
