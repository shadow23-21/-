# whale-memory（工作名）

手机优先、本地优先的长期角色扮演记忆应用。把用户在 DeepSeek 里聊了几个月的记录搬进来，重建人设、story bible 和可检索记忆，之后用兑换码额度继续聊。

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
- [x] 多角色列表 + 切换；导入新角色不覆盖旧角色；角色搜索 / 改名
- [x] 官方 `.zip` 直接导入（自动读 `conversation.json`）
- [x] 新建空白角色（不导入也能直接聊）
- [x] 消息「记住」+ 记忆页编辑/删除；手动记忆会进后续上下文
- [x] 检索改为 BM25（IDF + 长度归一化 + 重要性兜底）
- [x] 上下文 token 预算（默认 1500，可调；超预算先裁往事/记忆/旧对话）
- [x] 角色包导出/导入（`.json`，含 story bible + 消息）
- [x] App 名称「鲸忆」+ 自定义图标
- [x] 角色列表排序（最近 / 名字 / 记忆数）
- [x] PWA：manifest + 安装到桌面 + service worker 离线壳
- [x] 签名 release APK + AAB（v2/v3，keystore 已生成）
- [x] 消费端只保留兑换码/额度；隐藏模型、API key、直连等技术设置
- [x] 新建角色完整字段：别名/年龄/外貌/性格/习惯/关系/称呼/边界/初始记忆/未结束的线
- [x] 删除消息里的 `（第X天）` 前缀
- [x] 消息复制/删除、回到底部
- [x] 语音输入：Android 系统语音引擎 + 浏览器 Web Speech 兜底
- [x] Dockerfile + docker-compose，一键部 gateway
- [x] 商店素材包 + 上架/合规清单（`store/`）
- [x] 变现方案：BYOK + 托管额度，先兑换码后支付/IAP（`docs/monetization.md`）
- [x] 托管额度：SQLite 账户/兑换码/扣费 + App 兑换/余额/免 key 聊天（`docs/managed-mode.md`）
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
- 上下文 = 人设 + story bible + 检索到的往事 + 最近 6 轮；页面会显示估算 tokens / 成本。
- 设置页只保留「鲸忆额度」和「关于」：兑换码、剩余次数；模型、API key、直连等技术项不再暴露。
- 主界面是纯聊天：只有角色名、消息流和输入框；「记忆」和「设置」是独立页面；左上角 ☰ 进入角色列表。
- 角色列表：每个角色独立的 story bible / 消息 / 记忆；支持搜索、排序（最近/名字/记忆数）、改名；「导入新角色」追加，不覆盖当前角色。
- 支持安装到桌面：manifest + standalone + service worker；Chrome/Edge 角色页会出现「安装」，iOS Safari 用分享 → 添加到主屏幕。
- 每条消息右上角「复制 / 记住 / 删除」；长聊天有「↓ 最新」回到底部。
- 输入框右侧麦克风：语音转文字追加到输入框；首次用 Android 系统语音引擎会弹一次授权。
- 语音回复（TTS）暂未接；声线偏好和 TTS 方案见 [docs/voice.md](docs/voice.md)。
- 新建角色可填别名、年龄、外貌、性格、习惯、背景、角色定位、双方称呼、边界、未解决矛盾、初始长期记忆、未结束的线和开场白。
- 导入/历史消息里的 `（第X天）` 前缀会在加载时自动去掉。
- 记忆页「导出」把当前角色打成 `.json` 角色包（story bible + events + messages）；「导入新角色」会自动识别角色包。
- 上下文预算固定在代码内（默认 1500）；超预算时先裁往事，再裁长期记忆，最后裁旧对话。
- App 名「鲸忆」，Android 图标是蓝紫渐变 + 鲸字。
- 「导入新角色」在角色列表；支持 **DeepSeek 官方 `.zip` 直接导入**（自动找 `conversation.json`），也支持 `.json` / `.jsonl` / `.txt`。导入会调 `/api/extract` 生成 story bible，并存 IndexedDB，刷新不丢。
- 「新建角色」不导入也能用：填角色名、人设、关系、开场白，直接开始聊。
- 抽取默认走 DeepSeek `deepseek-flash`，智谱 `glm-4.7-flash` 作为 fallback；智谱 429 时自动切换。
- 默认省流：最近 6 轮 + 最多 4 条往事 + 6 条长期记忆 + 输出 ≤500 tokens；用户只看到「剩余次数」。
- 托管 E2E：生成码后 `CODE=WHALE-... node web/scripts/e2e.mjs`（需要本地 gateway + Edge；先兑换再跑导入/聊天/记忆/持久化）。
- 额度 E2E：`CODE=WHALE-... node web/scripts/e2e-managed.mjs`（兑换/余额/免 key 聊天/扣次）。

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

## 托管额度（免 API key）

```powershell
# 生成兑换码
node scripts/codes.mjs create --credits 500 --count 10

# 换服务器/换 DB 时，把码导入生产库
node scripts/codes.mjs import --file release/codes-3000.txt --credits 3000

# 启动 gateway（本地）
node server/gateway.mjs

# Web 构建时指向 gateway
cd web
$env:VITE_DIRECT_DEEPSEEK='false'
$env:VITE_API_BASE='http://127.0.0.1:8787'
npm.cmd run build
```

用户：设置 → 鲸忆额度 → 输入兑换码 → 保存 → 聊天。每轮扣 1 次；上游失败自动退回。
完整部署/卖码/限流清单见 [docs/managed-mode.md](docs/managed-mode.md)；公网部署（Railway/Zeabur/VPS/Docker）见 [docs/deploy.md](docs/deploy.md)。

```bash
# VPS 最简：Docker + 反向代理
docker compose up -d
```

## 签名发布（可直接发给别人）

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1 -GatewayUrl https://你的gateway域名
```

产物：

- `release/whale-memory-1.0.0.apk`：已签名，直接安装；启动后输入兑换码才能聊天。
- `release/whale-memory-1.0.0.aab`：Google Play 上传。
- `release/keystore-backup/`：签名密钥 + 密码；**立刻离线备份，丢了无法更新**。

注意：

- 必须传公网 HTTPS gateway；App 不再提供 API key/model 设置。
- 当前 `release/` 里的旧 APK 是上一版 BYOK 构建，不能用于新的兑换码流程；用上面的命令重建。
- debug 和 release 签名不同，手机装过 debug 要先卸载，不能覆盖安装。
- 商店素材、隐私政策模板、Google Play / App Store / 国内商店清单在 `store/`。
- 当前 release 尚未补举报/屏蔽/年龄门/未成年人模式；正式上架前必须做。

- Redmi/Xiaomi 如果报 `INSTALL_FAILED_USER_RESTRICTED`：开发者选项里打开 **USB 安装**、**USB 调试（安全设置）**，再重试。
- `androidScheme: http` + `cleartext: true` 只为本地调试；正式版换 HTTPS。
- 手机 `127.0.0.1:8787` 由 `adb reverse` 映射到电脑 gateway。

## 计划技术栈

- Client: React + Vite + Capacitor, SQLite
- Gateway: LiteLLM（MIT）或 Fastify，OpenAI 兼容
- Chat: DeepSeek V4.1 Flash（空闲 + 缓存）
- Extraction: GLM-4.7-Flash / qwen-flash
- Memory: SQLite FTS5 + jieba BM25；向量二期

## 变现

- 方案与成本：[docs/monetization.md](docs/monetization.md)
- 建议零售价：[store/pricing.md](store/pricing.md)
- 结论：BYOK 免费 + 托管额度收费；先卖兑换码（爱发电/微店），有量后再接微信/支付宝/Google Play Billing/Apple IAP。
- 不卖原始 API key；用户拿到的是应用内额度和 account token。

## 数据安全

- `fixtures/` 里的样本全部是合成数据
- 真实导出放 `fixtures/private/`，已在 `.gitignore`
- 不要提交 API key、聊天记录、手机号、QQ 号
