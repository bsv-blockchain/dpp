/** Parses exact input without replacing its bytes. Rejects malformed UTF-8, duplicate keys and nesting deeper than 64 before interpretation, under a 1 MiB limit. */
export function parseStrictJsonBytes(bytes: Uint8Array): unknown {
  if (bytes.byteLength > 1_048_576) throw new Error('Credential exceeds the 1 MiB profile limit');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text);
  let index = 0;
  const whitespace = () => { while (/\s/.test(text[index] ?? '') && index < text.length) index++; };
  const string = (): string => { const start = index++; while (index < text.length) { if (text[index] === '\\') index += 2; else if (text[index++] === '"') return JSON.parse(text.slice(start, index)); } throw new Error('Unterminated string'); };
  const visit = (depth: number): void => {
    if (depth > 64) throw new Error('JSON nesting exceeds the profile limit');
    whitespace();
    if (text[index] === '{') {
      index++; whitespace(); const keys = new Set<string>();
      while (text[index] !== '}') { const key = string(); if (keys.has(key)) throw new Error(`Duplicate JSON key: ${key}`); keys.add(key); whitespace(); index++; visit(depth + 1); whitespace(); if (text[index] !== ',') break; index++; whitespace(); }
      index++;
    } else if (text[index] === '[') {
      index++; whitespace(); while (text[index] !== ']') { visit(depth + 1); whitespace(); if (text[index] !== ',') break; index++; } index++;
    } else if (text[index] === '"') string();
    else { while (index < text.length && !/[\s,\]}]/.test(text[index])) index++; }
  };
  visit(0);
  return value;
}
