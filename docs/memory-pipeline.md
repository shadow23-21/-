# Memory pipeline

## 流程

```
DeepSeek export
  → importChat()        归一化 Event[]
  → storeImport()       SQLite：conversations / events / characters
  → chunkEvents()       8–12k 字一块
  → extractStoryBible() GLM-4.7-Flash（thinking disabled）
  → mergeBibles()       多块合并去重
  → story_bible / memories 入库
  → persona.md + report.md + index.html
```

## SQLite

| 表 | 作用 |
|---|---|
| `conversations` | 会话标题、来源、时间范围 |
| `events` | 原文消息、parent、role、speaker、thinking、selected |
| `characters` | 角色名 + persona JSON |
| `memories` | 结构化记忆（kind / text / importance） |
| `story_bible` | 整份 story bible JSON |
| `events_fts` | FTS5 全文索引（触发器同步） |

## 抽取契约

`extractStoryBible` 输出：

- `persona`：name / aliases / age / appearance / personality / speech_style / background / habits
- `relationship`：stage / user_name / character_role / address_terms / boundaries / tensions
- `timeline`：when / event / importance
- `memories`：kind / text / importance
- `style_samples`：原文语气样本
- `open_threads`：未结束的线

后处理会清洗称呼：

- `address_terms.user` 去掉角色自己的名字
- `address_terms.character` 去掉“她/他/我/你”等代词；为空时回填角色名

## 模型参数

| 角色 | provider | 模型 |
|---|---|---|
| 主抽取 | `deepseek` | `deepseek-flash` |
| fallback | `zhipu` | `glm-4.7-flash` |

- `thinking: { type: "disabled" }`：必须，否则 DeepSeek/GLM 会先把 token 花在 reasoning 上。
- `temperature: 0.2`，`max_tokens: 3000`。
- 429 / 5xx 自动重试 + 切 fallback；都失败时 CLI 降级确定性摘要，浏览器导入会返回错误。
- JSON 解析：去 ```json 围栏 + 取第一个 `{` 到最后一个 `}`。

## 已知限制

- 称呼/用户真名需要模型从上下文推断；6 条消息的短样本会不准，长日志会好很多。
- 时间线可能超过 prompt 要求的 15 条，暂不强制裁剪。
- FTS5 对中文分词一般，后续换 jieba 或 bigram 检索。
- 大日志按字符切块；块间不做跨块实体消歧，靠 merge 去重。
