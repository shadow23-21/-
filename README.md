# whale-memory（工作名）

手机优先、本地优先的长期角色扮演记忆应用。把用户在 DeepSeek 里聊了几个月的记录搬进来，重建人设、story bible 和可检索记忆，之后用 BYOK 低成本继续聊。

> 工作名，正式品牌未定。仓库默认私有。

## 目标

- 一键导入 DeepSeek 官方导出（以及 ChatGPT / SillyTavern / 纯文本兜底）
- 本地 SQLite 存原文、事件、人设、story bible、记忆
- 每条消息只组装 20–40k 上下文：稳定前缀 + 检索 + 最近 N 轮
- 一人一库、多角色按 `character_id` 隔离，不串人
- 手机端：React + Vite + Capacitor；先 Web/PWA，再 Android

## 当前状态

- [x] 仓库骨架
- [x] 6 份导入 fixture（覆盖 DeepSeek RAW/官方假设/树/ChatGPT/SillyTavern/纯文本）
- [x] DeepSeek 官方导出真实 schema 已用公开 RAW 样本验证（11 条消息，8 条选中，3 条分支归档）
- [x] 导入 CLI：`node scripts/import-demo.mjs <file>`
- [x] SQLite schema + 导入入库（`whale.db`，含 FTS5 索引）
- [x] story bible 抽取（GLM-4.7-Flash，关闭思考；失败可降级确定性摘要）
- [x] 本地 HTML demo（`index.html`，可直接打开）
- [x] PWA 聊天 + BYOK + 检索上下文（本地 gateway，流式输出）
- [x] 浏览器导入 + IndexedDB 持久化 + `/api/extract` 生成 story bible
- [x] 浏览器 E2E：上传 fixture → 导入 → 聊天（`web/scripts/e2e.mjs`）
- [x] Android 工程 + debug APK 构建通过（`web/android`）
- [x] Redmi M332BF 安装/启动验证；主界面纯聊天，记忆/设置独立页面
- [x] 默认省流：6 轮上下文 / 4 条往事 / 6 条长期记忆 / 输出 ≤500 tokens
- [x] 聊天记录持久化到 IndexedDB（刷新/重启恢复导入 + 后续对话）
- [x] 多角色列表 + 切换；导入新角色不覆盖旧角色
- [x] 消息「记住」+ 记忆页删除；手动记忆会进后续上下文
- [x] App 名称「鲸忆」+ 自定义图标
- [x] 手机端 ADB 输入/发送 + force-stop 重启恢复验证（242 条会话）

## 目录

```
docs/       设计与格式说明
fixtures/   合成测试数据（不含真实用户数据）
scripts/    开发脚本
src/        应用代码（待开始）
```

## 已跑通

```bash
# 导入 + 入库 + 抽取 + 生成 demo
node scripts/build-memory.mjs fixtures/deepseek-official.json \
  --out out/demo --title "和沈砚的一百二十天"

# 不调用模型，纯离线
node scripts/build-memory.mjs fixtures/deepseek-raw.json \
  --out out/offline --no-llm
```

输出：

- `whale.db`：SQLite，含 `conversations / events / characters / memories / story_bible`
- `story-bible.json`：人设、关系、时间线、记忆、语气样本
- `persona.md`：可直接读的角色卡
- `report.md`：导入统计 + 记忆摘要
- `events.jsonl`：归一化主线消息
- `index.html`：本地静态 demo（聊天 + 记忆面板）

抽取用 `glm-4.7-flash`，请求里带 `thinking: { type: "disabled" }`，否则它会把 token 全花在思考上、正文为空。

## 本地 Web MVP

```bash
# 1. 生成 demo 数据（来自 out/official-demo4）
node scripts/export-web-data.mjs out/official-demo4 web/public/demo-data.json

# 2. 装依赖 + 构建
cd web
npm.cmd install
npm.cmd run build
cd ..

# 3. 启动本地 gateway
node server/gateway.mjs
# 打开 http://127.0.0.1:8787
```

- gateway 只监听 `127.0.0.1`，`/api/chat` 透传 DeepSeek / 智谱；默认用 `.env` 的 key，也能在设置里填自己的 key。
- 请求统一带 `thinking: { type: "disabled" }`：DeepSeek V4 和 GLM 默认思考，不关会只出 reasoning、正文为空。
- 上下文 = 人设 + story bible + 检索到的往事 + 最近 8 轮；页面会显示估算 tokens / 成本。
- 设置面板可切 DeepSeek / 智谱、改模型、填 key；key 只在本机 localStorage（勾选“记住”时）。
- 主界面是纯聊天：只有角色名、消息流和输入框；「记忆」和「设置」是独立页面；左上角 ☰ 进入角色列表。
- 角色列表：每个角色独立的 story bible / 消息 / 记忆；「导入新角色」追加，不覆盖当前角色。
- 每条消息右上角「记住」：把这句话写进长期记忆，下一轮就会注入；记忆页可逐条删除。
- App 名「鲸忆」，Android 图标是蓝紫渐变 + 鲸字。
- 「导入」在「记忆」页；支持 `.json` / `.jsonl` / `.txt`，DeepSeek 官方 zip 先解压，选里面的 `conversation.json`。导入会调 `/api/extract` 生成 story bible，并存 IndexedDB，刷新不丢。
- 抽取默认走 DeepSeek `deepseek-flash`，智谱 `glm-4.7-flash` 作为 fallback；智谱 429 时自动切换。
- 默认省流：最近 6 轮 + 最多 4 条往事 + 6 条长期记忆 + 输出 ≤500 tokens；输入框上方显示本轮估算成本。
- 浏览器 E2E：`cd web && node scripts/e2e.mjs`（需要 gateway 已启动 + Edge；会验证导入、聊天、记忆页、设置页）。

## Android

```bash
cd web
# Android WebView 通过 adb reverse 访问电脑上的 gateway
$env:VITE_API_BASE='http://127.0.0.1:8787'
npm.cmd run build
npx.cmd cap sync android

cd android
$env:JAVA_HOME='C:\dev\jdk21'
$env:ANDROID_HOME='C:\dev\android-sdk'
.\gradlew.bat assembleDebug
```

APK：`web/android/app/build/outputs/apk/debug/app-debug.apk`

```bash
adb reverse tcp:8787 tcp:8787
adb install -r web/android/app/build/outputs/apk/debug/app-debug.apk
```

- Redmi/Xiaomi 如果报 `INSTALL_FAILED_USER_RESTRICTED`：开发者选项里打开 **USB 安装**、**USB 调试（安全设置）**，再重试。
- `androidScheme: http` + `cleartext: true` 只为本地调试；正式版换 HTTPS。
- 手机 `127.0.0.1:8787` 由 `adb reverse` 映射到电脑 gateway。

## 计划技术栈

- Client: React + Vite + Capacitor, SQLite
- Gateway: LiteLLM（MIT）或 Fastify，OpenAI 兼容
- Chat: DeepSeek V4.1 Flash（空闲 + 缓存）
- Extraction: GLM-4.7-Flash / qwen-flash
- Memory: SQLite FTS5 + jieba BM25；向量二期

## 数据安全

- `fixtures/` 里的样本全部是合成数据
- 真实导出放 `fixtures/private/`，已在 `.gitignore`
- 不要提交 API key、聊天记录、手机号、QQ 号
