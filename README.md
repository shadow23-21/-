# whale-memory（工作名）

手机优先、本地优先的长期角色扮演记忆应用。把用户在 DeepSeek 里聊了几个月的记录搬进来，重建人设、story bible 和可检索记忆，之后用 BYOK 低成本继续聊。

> 工作名，正式品牌未定。仓库默认私有。

## 目标

- 一键导入 DeepSeek 官方导出（以及 ChatGPT / SillyTavern / 纯文本兜底）
- 本地 SQLite 存原文、事件、人设、story bible、记忆
- 每条消息只组装 20–40k 上下文：稳定前缀 + 检索 + 最近 N 轮
- 一人一库、多角色按 `character_id` 隔离，不串人
- 手机端：React + Vite + Capacitor；先 Web/PWA，再 Android

## 当前状态（Day 0）

- [x] 仓库骨架
- [x] 5 份合成导入 fixture（覆盖官方/树/ChatGPT/SillyTavern/纯文本）
- [ ] DeepSeek 官方导出真实样本 → 解析器
- [ ] SQLite schema + story bible
- [ ] PWA 聊天 + BYOK
- [ ] Android 包

## 目录

```
docs/       设计与格式说明
fixtures/   合成测试数据（不含真实用户数据）
scripts/    开发脚本
src/        应用代码（待开始）
```

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
