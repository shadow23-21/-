# Web MVP

## 界面

- **聊天页**：只有角色名、消息流、输入框；不显示人设/记忆侧栏。
- **记忆页**：上一轮注入、人设、关系、长期记忆、时间线、语气样本、未结束的线；删除当前角色也在这里。
- **角色页**：左上角 ☰ 进入；角色卡片列表、搜索、排序（最近/名字/记忆数）、新建角色、导入新角色、使用 demo 角色。
- **设置页**：只剩「鲸忆额度」和「关于」；用户只看到兑换码、剩余次数，不再暴露模型/API key/直连/省流参数。

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

省流参数固定在代码里；消费端只显示「剩余次数」，不显示 tokens、金额或预算。

默认 `contextBudgetTokens = 1500`。超出预算时按顺序裁：先削相关往事，再削长期记忆，最后从最旧的对话开始丢；人设稳定前缀不裁。

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

## DeepSeek 直连（开发/旧构建）

- 构建参数：`VITE_DIRECT_DEEPSEEK=true`、`VITE_API_BASE=''`。
- 浏览器/WebView 直接 `fetch https://api.deepseek.com/chat/completions`，带用户自己的 key。
- DeepSeek 的 CORS 会反射 `http://localhost` 等本地 Origin；已用 `http://localhost:8787` 实测流式成功。
- 请求体加 `thinking: { type: "disabled" }`，避免只返回 reasoning。
- SSE 解析遇到 `[DONE]` 主动结束并 `reader.cancel()`，避免直连 keep-alive 导致消息一直 pending。
- 智谱没有可用 CORS，仍走 gateway。
- 这样 release APK 安装后填 key 即可聊，不需要电脑上的 gateway。

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

## 安装到桌面

- `public/manifest.webmanifest`：`display: standalone`、`theme_color #0b1020`、192/512 图标。
- `public/sw.js`：network-first，GET 请求成功后写缓存；`/api/*` 不缓存。断网时回退已缓存页面。
- Chrome/Edge 触发 `beforeinstallprompt` 后，角色页显示「安装」按钮。
- iOS Safari 不支持该事件：用分享 → 添加到主屏幕。
- Android 仍走 Capacitor 的「鲸忆」APK。

## 角色包

- 记忆页「导出」生成 `鲸忆角色.json`：`format: whale-memory-character` + `bible / events / messages`。
- 角色列表「导入新角色」先尝试按角色包解析；命中就直接建角色，不走 `/api/extract`。
- 同一份包可以在另一台设备/另一个浏览器恢复，不依赖 SQLite。

## 托管额度

- 设置页「鲸忆额度」：输入 `WHALE-...` 兑换码，拿到 account token，显示剩余次数。
- 托管聊天请求 `POST /api/chat`，带 `Authorization: Bearer whale_...` 和 `managed: true`；gateway 扣 1 次后用 master key 调模型。
- `/api/redeem` 兑换、`/api/balance` 查余额；兑换码/账户/用量在 `data/billing.db`。
- 上游失败会自动退回 1 次；流式中途断开照常扣费。
- release APK 当前是直连 BYOK；托管版需要构建时把 `VITE_API_BASE` 指到公网 gateway，见 `docs/managed-mode.md`。

## 当前限制

- zip 必须包含 `conversation.json`（官方导出解压后就是这个结构）；缺这个文件会报错。
- 多角色切换、搜索、排序、改名、新建已做；批量管理还没做。
- 移动端访问需要 `adb reverse` 或 Capacitor 内嵌，暂不把 gateway 暴露到局域网。
- 流式只渲染 `delta.content`；`reasoning_content` 已通过关闭思考避免。
- 聊天记录已写入 IndexedDB：刷新/重启恢复导入的 story bible、主线消息和后续对话。
