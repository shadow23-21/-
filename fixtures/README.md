# Fixtures

这里的全部是**合成数据**，不含任何真实用户聊天、手机号、QQ 号或账号信息。

| 文件 | 形状 | 用途 |
|---|---|---|
| `deepseek-raw.json` | 真实官方导出的 RAW 形状（`data.biz_data.chat_session/chat_messages` + `fragments`） | 主解析器（已用公开真实样本验证） |
| `deepseek-official.json` | 账号 + conversations + messages（假设形状，兼容用） | 旧版/兜底 |
| `deepseek-tree.json` | `chat_session` + `chat_messages` 树（ceyaima 导出器风格） | 分支/重新生成解析 |
| `chatgpt-conversations.json` | ChatGPT `mapping` 形状 | 跨平台导入 |
| `sillytavern-chat.jsonl` | 一行一条消息 | 酒馆用户导入 |
| `plain-text.md` | `角色：文本` | 复制粘贴兜底 |
| `deepseek-export.zip` | 官方导出形状：zip 内 `conversation.json` | 验证浏览器 zip 导入 |

重新生成：

```bash
node scripts/make-fixtures.mjs
```

真实导出请放 `fixtures/private/`（已在 `.gitignore`），不要提交。
