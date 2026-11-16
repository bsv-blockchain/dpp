import { describe, expect, it } from 'vitest'
import { parseStrictJson } from '../src/index.js'

// A signed payload is read once and its meaning must not depend on which of
// two same-named members a parser keeps, so the reader refuses the document.
describe('parseStrictJson', () => {
  it('reads what JSON.parse reads when no member name repeats', () => {
    const text = '{"a":1,"b":[true,null,{"c":"d\\u00e9"}],"e":{"a":-1.5e3}}'
    expect(parseStrictJson(text)).toEqual({ ok: true, value: JSON.parse(text) })
  })

  it('refuses text that is not JSON', () => {
    for (const text of ['', '{', '{"a":1,}', 'undefined', '{"a":1} trailing']) {
      const result = parseStrictJson(text)
      expect(result.ok, text).toBe(false)
      if (!result.ok) expect(result.detail).toMatch(/not JSON/)
    }
  })

  it('refuses a repeated member name at the top level', () => {
    const result = parseStrictJson('{"profile":"a","profile":"b"}')
    expect(result).toEqual({ ok: false, detail: 'the member name "profile" appears twice in one object' })
  })

  it('refuses a repeated member name at any depth, inside objects and arrays', () => {
    expect(parseStrictJson('{"product":{"id":"x","parts":[{"name":"a","name":"b"}]}}').ok).toBe(false)
    expect(parseStrictJson('[[{"k":1,"k":1}]]').ok).toBe(false)
  })

  it('compares member names after their escapes are read', () => {
    // "a" is "a": two spellings of one name are still one name.
    expect(parseStrictJson('{"a":1,"\\u0061":2}').ok).toBe(false)
  })

  it('accepts the same name in two different objects', () => {
    expect(parseStrictJson('{"a":{"id":1},"b":{"id":2},"c":[{"id":3},{"id":4}]}').ok).toBe(true)
  })

  it('is not confused by braces, quotes and commas inside strings', () => {
    const text = '{"a":"{\\"a\\":1,\\"a\\":2}","b":"],[","c":"\\\\"}'
    expect(parseStrictJson(text)).toEqual({ ok: true, value: JSON.parse(text) })
  })

  it('refuses nesting deeper than its limit instead of exhausting the stack', () => {
    const deep = '['.repeat(200) + ']'.repeat(200)
    const result = parseStrictJson(deep)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.detail).toMatch(/nest/)
  })
})
