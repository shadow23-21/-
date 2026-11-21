# 导入格式与归一化

## 优先级

1. **DeepSeek RAW / 官方导出**（真实 schema，已验证）
2. DeepSeek tree JSON（ceyaima 导出器）
3. ChatGPT `conversations.json`
4. SillyTavern JSONL
5. 纯文本 / Markdown

## DeepSeek RAW（官方导出）

官方导出：网页 → 设置 → 数据管理 → 导出所有历史对话 → 下载 zip；解压得到 `conversation.json` + `user.json`。

`conversation.json` 里的会话是 DeepSeek 内部 RAW 形状：

```json
{
  "data": {
    "biz_data": {
      "chat_session": {
        "id": "...",
        "title": "...",
        "current_message_id": 11,
        "inserted_at": 1763826110.639
      },
      "chat_messages": [
        {
          "message_id": 1,
          "parent_id": null,
          "role": "USER",
          "inserted_at": 1763826114.569,
          "fragments": [
            { "type": "REQUEST", "content": "..." }
          ]
        }
      ]
    }
  }
}
```

要点：

- `fragments[].type`：`REQUEST`（用户输入）、`RESPONSE`（助手正文）、`THINK`（思考）。导入时 `THINK` 存 `thinking`，不混进正文。
- `parent_id` 还原分支；`chat_session.current_message_id` 指向当前选中的叶子，沿 `parent_id` 走到根就是主线，其他分支归档。
- `inserted_at` 是 Unix 秒（float）。
- 解析器同时接受：`data.biz_data` 包装、裸 `{chat_session, chat_messages}`、数组、`{conversations:[...]}`。
- 真实样本：[ceyaima/deepseek-exporter samples](https://github.com/ceyaima/deepseek-exporter/tree/main/samples)；官方导出说明：[博客](https://www.cnblogs.com/windin/p/20106238)。

## 归一化事件

```ts
export type Role = 'user' | 'assistant' | 'system' | 'narrator';

export interface Event {
  id: string;
  conversationId: string;
  parentId?: string;
  role: Role;
  speaker?: string;
  text: string;
  thinking?: string;
  createdAt: string; // ISO 8601
  branchId?: string;
  selected?: boolean;
  source: 'deepseek-raw' | 'deepseek-official' | 'deepseek-tree' | 'chatgpt' | 'sillytavern' | 'plaintext';
  model?: string;
  title?: string;
}
```

## 管线

1. 识别格式
2. 解析成 `Event[]`
3. 处理分支：保留 `selected` 路径，备选归档
4. 按角色/会话切分
5. 按场景切块 8–12k 字
6. 并行抽取（便宜模型）
7. 合并/去重/冲突标注
8. 用户确认后入库

## 边界情况

- 分支/重新生成：只把选中路径当主线，另一版存 `branch`，不重复进时间线
- 多角色：每条消息带 `speaker`，记忆按 `character_id` 分区
- 时间戳/时区：统一 ISO，保留原时区
- 图片/附件：只存引用，不送抽取
- 编辑/删除：保留 `edited` / `deleted` 标记
- 超长日志：流式解析 + Web Worker，避免卡 UI
