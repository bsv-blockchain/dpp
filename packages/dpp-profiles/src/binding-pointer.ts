/** The value at a JSON Pointer (RFC 6901), or `undefined` where the document has none. Arrays are indexed by their decimal position. */
export function valueAt(document: unknown, pointer: string): unknown {
  let current: unknown = document
  for (const token of pointer.split('/').slice(1)) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(key)) return undefined
      current = current[Number(key)]
    } else if (current !== null && typeof current === 'object' && Object.hasOwn(current, key)) {
      current = (current as Record<string, unknown>)[key]
    } else {
      return undefined
    }
  }
  return current
}
