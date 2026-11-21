const bulletList = (items, empty = '未知') =>
  items && items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `- ${empty}`;

export function renderPersonaMarkdown(bible) {
  const { persona, relationship, timeline, memories, style_samples, open_threads } = bible;

  const sections = [
    `# ${persona.name}`,
    '',
    `> ${bible.title}`,
    '',
    '## 人设',
    `- 别名：${persona.aliases.join('、') || '未知'}`,
    `- 年龄：${persona.age}`,
    `- 外貌：${persona.appearance}`,
    `- 性格：${persona.personality.join('、') || '未知'}`,
    `- 说话风格：${persona.speech_style}`,
    `- 背景：${persona.background}`,
    `- 习惯：${persona.habits.join('、') || '未知'}`,
    '',
    '## 关系',
    `- 阶段：${relationship.stage}`,
    `- 用户角色：${relationship.user_name}`,
    `- 角色定位：${relationship.character_role}`,
    `- 角色怎么称呼用户：${relationship.address_terms.user.join('、') || '未知'}`,
    `- 用户怎么称呼角色：${relationship.address_terms.character.join('、') || '未知'}`,
    '',
    '### 边界',
    bulletList(relationship.boundaries),
    '',
    '### 未解决的矛盾',
    bulletList(relationship.tensions),
    '',
    '## 时间线',
    timeline.length > 0
      ? timeline
          .map(
            (item) =>
              `- ${item.when}：${item.event}（重要度 ${item.importance.toFixed(2)}）`,
          )
          .join('\n')
      : '- 未知',
    '',
    '## 记忆',
    memories.length > 0
      ? memories
          .map(
            (item) =>
              `- [${item.kind}] ${item.text}（重要度 ${item.importance.toFixed(2)}）`,
          )
          .join('\n')
      : '- 未知',
    '',
    '## 语气样本',
    style_samples.length > 0
      ? style_samples.map((sample) => `> ${sample.replace(/\n/g, ' ')}`).join('\n>\n')
      : '> 未知',
    '',
    '## 未结束的线',
    bulletList(open_threads),
    '',
  ];

  return sections.join('\n');
}

export function renderReportMarkdown({ bible, stats, files }) {
  const lines = [
    `# 导入报告：${bible.title}`,
    '',
    '## 统计',
    `- 来源格式：${stats.format}`,
    `- 消息总数：${stats.events}`,
    `- 主线消息：${stats.selected}`,
    `- 分支归档：${stats.archived}`,
    `- 角色名：${bible.persona.name}`,
    `- 记忆条数：${bible.memories.length}`,
    `- 时间线条数：${bible.timeline.length}`,
    `- 生成方式：${bible.meta?.source ?? 'unknown'}`,
    '',
    '## 记忆摘要',
    ...bible.memories
      .slice(0, 8)
      .map(
        (item) =>
          `- [${item.kind}] ${item.text}（重要度 ${item.importance.toFixed(2)}）`,
      ),
    '',
    '## 文件',
    ...files.map((file) => `- ${file}`),
    '',
  ];
  return lines.join('\n');
}
