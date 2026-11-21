import { detectFormat } from './detect.mjs';
import {
  parseChatGPT,
  parseDeepSeekOfficial,
  parseDeepSeekTree,
  parsePlainText,
  parseSillyTavern,
} from './parsers.mjs';

/**
 * Import one payload into normalized events.
 *
 * @param {unknown} input Parsed JSON object/array, or raw JSONL / plain text string.
 * @param {{ format?: string, userNames?: string[] }} [options]
 * @returns {{ format: string, events: object[], selected: object[] }}
 */
export function importChat(input, options = {}) {
  const format = options.format ?? detectFormat(input);
  let events;

  switch (format) {
    case 'deepseek-official':
      events = parseDeepSeekOfficial(input);
      break;
    case 'deepseek-tree':
      events = parseDeepSeekTree(input);
      break;
    case 'chatgpt':
      events = parseChatGPT(input);
      break;
    case 'sillytavern':
      events = parseSillyTavern(input);
      break;
    case 'plaintext':
      events = parsePlainText(input, options);
      break;
    default:
      throw new Error(`Unsupported import format: ${format}`);
  }

  events.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const selected = events.filter((event) => event.selected !== false);

  return { format, events, selected };
}

export { detectFormat };
