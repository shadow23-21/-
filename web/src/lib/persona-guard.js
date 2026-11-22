const OOC_PATTERNS = [
  /作为(?:一个)?(?:AI|人工智能|语言模型|大模型|程序|助手|机器人)/iu,
  /我只是(?:一个)?(?:AI|人工智能|语言模型|程序|助手|机器人)/iu,
  /我是(?:一个)?(?:AI|人工智能|语言模型|程序|助手|机器人)/iu,
  /(?:OpenAI|ChatGPT|DeepSeek|Anthropic|Claude)/iu,
  /(?:无法|不能)(?:继续)?(?:扮演|进行角色扮演|以.{0,8}身份)/u,
  /(?:系统提示|提示词|prompt|系统指令)/iu,
  /(?:出戏|OOC)/u,
  /抱歉[，,].{0,8}(?:不能|无法).{0,8}(?:扮演|角色)/u,
];

export function isOutOfCharacter(text) {
  const value = String(text ?? '');
  return OOC_PATTERNS.some((pattern) => pattern.test(value));
}

export function repairInstruction(name) {
  return [
    `你刚才的回复出戏了。现在完全以「${name}」的身份重写上一条回复。`,
    '不要解释、不要道歉、不要提及 AI、模型、程序、助手、系统、设定、提示词。',
    '只写角色的台词、动作和必要旁白，1–3 句，保持原场景和关系。',
  ].join('');
}

export function sanitizeOoc(text) {
  const sentences = String(text ?? '')
    .split(/(?<=[。！？!?])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => !isOutOfCharacter(sentence));
  return sentences.join('');
}
