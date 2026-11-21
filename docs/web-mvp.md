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

- 中文 bigram + 单字 + 英文词；单字权重 0.3，bigram/英文词权重 1
- BM25：IDF + 文档长度归一化（k1=1.2, b=0.75）+ 轻微时间衰减
- 候选池排除最近 6 条；最多 4 条、约 4.5k 字
- 长期记忆：查询命中的排前面，再补最多 3 条 importance 最高的核心记忆
- 查不到就返回空，不拿最近消息凑数（最近消息本来就在上下文里）

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

- 「导入新角色」接受 **`.zip`**（官方导出直接传，浏览器用 fflate 解压并自动找 `conversation.json`），也接受 `.json` / `.jsonl` / `.txt`。
- 浏览器里直接调用 `src/import/index.mjs` 的 `importChat()`；支持 DeepSeek RAW、官方假设形状、tree、ChatGPT、SillyTavern、纯文本。
- 解析后把主线消息 POST 到 `/api/extract`，生成 story bible。
- 结果作为新角色存 IndexedDB（`whale-memory` / `session` / `library` / `characters`）；刷新自动载入。
- 角色列表可切换角色、搜索、改名、新建 demo 角色；删除当前角色会移除它的聊天记录。

## 新建角色

- 角色列表「新建角色」：填角色名、故事标题、你的名字、关系阶段、性格、说话风格、背景、开场白。
- 不导入任何记录也能直接聊；开场白会作为第一条角色消息。
- 创建后仍是普通角色：可记住、编辑记忆、改名、删除。

## 角色与手动记忆

- 每个角色有独立的 `bible / events / messages / source`，切换角色不会串记忆。
- 消息右上角「记住」：把该句写进长期记忆，下一轮就会注入。
- 记忆页每条长期记忆可编辑 `kind / 文本 / importance`，右侧 `×` 删除；「改名」改当前角色名。

## 当前限制

- zip 必须包含 `conversation.json`（官方导出解压后就是这个结构）；缺这个文件会报错。
- 多角色切换、搜索、改名、新建已做；排序、批量管理还没做。
- 移动端访问需要 `adb reverse` 或 Capacitor 内嵌，暂不把 gateway 暴露到局域网。
- 流式只渲染 `delta.content`；`reasoning_content` 已通过关闭思考避免。
- 聊天记录已写入 IndexedDB：刷新/重启恢复导入的 story bible、主线消息和后续对话。
