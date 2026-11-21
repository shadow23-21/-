const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Detect the import format of a parsed JSON value or a raw text payload.
 * @param {unknown} input
 * @returns {'deepseek-official'|'deepseek-tree'|'chatgpt'|'sillytavern'|'plaintext'}
 */
export function detectFormat(input) {
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) throw new Error('Empty input');

    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return detectFormat(JSON.parse(text));
      } catch {
        // Not JSON; fall through to line-based formats.
      }
    }

    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (
      lines.length > 0 &&
      lines.every((line) => {
        try {
          return isObject(JSON.parse(line));
        } catch {
          return false;
        }
      })
    ) {
      return 'sillytavern';
    }

    return 'plaintext';
  }

  if (Array.isArray(input)) {
    if (
      input.every(
        (row) => isObject(row) && ('mes' in row || 'is_user' in row || 'message' in row),
      )
    ) {
      return 'sillytavern';
    }
    throw new Error('Unsupported array input');
  }

  if (isObject(input)) {
    if (Array.isArray(input.conversations)) return 'deepseek-official';
    if (input.chat_session && Array.isArray(input.chat_messages)) return 'deepseek-tree';
    if (Object.values(input).some((value) => isObject(value) && isObject(value.mapping))) {
      return 'chatgpt';
    }
    if (Array.isArray(input.messages)) return 'generic-messages';
  }

  throw new Error('Unknown import format');
}
