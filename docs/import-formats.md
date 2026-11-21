# 导入格式与归一化

## 优先级

1. DeepSeek 官方导出（主路径）
2. DeepSeek tree JSON（ceyaima 导出器）
3. ChatGPT `conversations.json`
4. SillyTavern JSONL
5. 纯文本 / Markdown

## 官方导出

路径：DeepSeek 网页 → 设置 → 数据管理 → 导出所有历史对话。下载链接 7 天有效。

官方没有公开 schema；`fixtures/deepseek-official.json` 是按“账号 + conversations + messages”假设的合成样本，**必须用一份真实脱敏导出替换/校验**。

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
  createdAt: string; // ISO 8601
  branchId?: string;
  selected?: boolean;
  source: 'deepseek-official' | 'deepseek-tree' | 'chatgpt' | 'sillytavern' | 'plaintext';
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
