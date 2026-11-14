/**
 * JSON read strictly: the text must be JSON, and no object in it may carry
 * the same member name twice. RFC 8259 leaves a repeated name undefined, and
 * parsers disagree on which value survives, so two readers of one signed
 * payload could check different documents. Refusing the payload is the only
 * answer on which every reader agrees.
 */

/** Deeper than any profile document; a limit so hostile nesting is refused, not recursed into. */
const MAX_DEPTH = 64

export type StrictJsonResult = { ok: true; value: unknown } | { ok: false; detail: string }

/**
 * The value `JSON.parse` gives, or a refusal with one sentence. `JSON.parse`
 * decides whether the text is JSON; the walk that follows only looks for
 * repeated member names, so it can assume the grammar holds.
 */
export function parseStrictJson(text: string): StrictJsonResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, detail: 'the text is not JSON' }
  }
  let index = 0
  const skipWhitespace = (): void => { while (index < text.length && /[ \t\n\r]/.test(text[index]!)) index++ }
  // A string token, returned as the value its escapes spell, so "a" and "a" are one name.
  const readString = (): string => {
    const start = index++
    while (text[index] !== '"') index += text[index] === '\\' ? 2 : 1
    index++
    return JSON.parse(text.slice(start, index)) as string
  }
  const visit = (depth: number): string | undefined => {
    if (depth > MAX_DEPTH) return `the document nests deeper than ${MAX_DEPTH} levels`
    skipWhitespace()
    if (text[index] === '{') {
      index++
      skipWhitespace()
      const names = new Set<string>()
      while (text[index] !== '}') {
        const name = readString()
        if (names.has(name)) return `the member name ${JSON.stringify(name)} appears twice in one object`
        names.add(name)
        skipWhitespace()
        index++ // the colon
        const problem = visit(depth + 1)
        if (problem != null) return problem
        skipWhitespace()
        if (text[index] === ',') { index++; skipWhitespace() }
      }
      index++
    } else if (text[index] === '[') {
      index++
      skipWhitespace()
      while (text[index] !== ']') {
        const problem = visit(depth + 1)
        if (problem != null) return problem
        skipWhitespace()
        if (text[index] === ',') index++
      }
      index++
    } else if (text[index] === '"') {
      readString()
    } else {
      while (index < text.length && !/[ \t\n\r,\]}]/.test(text[index]!)) index++
    }
    return undefined
  }
  const problem = visit(0)
  return problem == null ? { ok: true, value } : { ok: false, detail: problem }
}
